import os
import time
import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.metrics import accuracy_score
from datetime import datetime
import ta
from sklearn.metrics import accuracy_score, confusion_matrix
from sklearn.model_selection import train_test_split

########################################
# 설정
########################################
CSV_FILE_PATH = '../responses/3min_candle_1year.csv'  # Node.js 코드에서 저장 중인 CSV 경로
CHECK_INTERVAL = 30  # 초 단위: CSV 변경 확인 주기(예: 30초에 한 번)
PREDICTION_LOG_PATH = 'prediction_results.log'  # 예측 결과 로그 파일

########################################
# 전역 변수
########################################
last_file_size = 0  # 가장 최근 확인 시점의 파일 크기
model = None         # 학습된 모델(초기 None)

# 누적 맞춤/틀림 횟수 (새로 추가)
correct_count = 0
incorrect_count = 0

# (예) 'YYYY-MM-DD HH:MM:SS' 형태의 문자열 -> 예측 레이블(상승1/하락0)
# 다음 봉이 시작될 시각(혹은 현재 봉 시각)을 key로 저장
predictions_dict = {}  # { '2025-01-25 10:03:00': 1, ... }

########################################
# 간단한 모델 학습 함수 (예시)
########################################

def train_model_from_csv(csv_path):
    # ----- CSV 파일 로드 & 전처리 ----- #
    df = pd.read_csv(
        '../responses/3min_candle_1year.csv', 
        parse_dates=['candle_date_time_kst']
    )

    # 시간 오름차순 정렬
    df.sort_values('candle_date_time_kst', inplace=True)

    # ----- (3) ta 라이브러리를 이용해 "모든" 지표 생성 ----- #
    df = ta.add_all_ta_features(
        df,
        open='opening_price',
        high='high_price',
        low='low_price',
        close='trade_price',
        volume='candle_acc_trade_volume',
        fillna=True
    )
    df['prev_close'] = df['trade_price'].shift(1)
    df['label'] = (df['trade_price'] > df['prev_close']).astype(int)
    df.dropna(subset=['prev_close'], inplace=True)
    
    output_file = "../responses/processed_3min_candle_1year.csv"  # 저장할 파일 경로
    df.to_csv(output_file, index=False, encoding='utf-8')
    print(f"Processed DataFrame saved to {output_file}")
    
    # 사용하지 않을 컬럼들
    exclude_cols = [
        'candle_date_time_kst', 'timestamp', 'candle_acc_trade_price',
        'prev_close', 'label', 'market', 'candle_date_time_utc', 'unit'
    ]
    features = [col for col in df.columns if col not in exclude_cols]

    X = df[features]
    y = df['label']

    total_len = len(df)
    train_end = int(total_len * 0.7)
    valid_end = int(total_len * 0.85)

    X_train = X.iloc[:train_end]
    y_train = y.iloc[:train_end]
    X_val   = X.iloc[train_end:valid_end]
    y_val   = y.iloc[train_end:valid_end]
    X_test  = X.iloc[valid_end:]
    y_test  = y.iloc[valid_end:]

    model_xgb = xgb.XGBClassifier(
        n_estimators=300,
        max_depth=6,
        learning_rate=0.01,
        random_state=42,
        use_label_encoder=False,
        eval_metric='logloss'
    )

    model_xgb.fit(
        X_train, y_train,
        eval_set=[(X_val, y_val)],
        verbose=True
    )

    pred_test = model_xgb.predict(X_test)
    acc_test = accuracy_score(y_test, pred_test)
    cm_test = confusion_matrix(y_test, pred_test)

    print("Test Accuracy:", acc_test)
    print("Confusion Matrix:\n", cm_test)

    return model_xgb, df

########################################
# 다음 캔들 상승/하락 예측
########################################
def predict_next_candle(model, df):
    # 가장 최근 행 (마지막 봉) 추출
    last_row = df.iloc[-1]
    exclude_cols = ['market','candle_date_time_utc','candle_date_time_kst',
                    'timestamp','candle_acc_trade_price','prev_close','label','unit']
    features = [c for c in df.columns if c not in exclude_cols]

    X_last = last_row[features].values.reshape(1, -1)
    pred = model.predict(X_last)
    pred_label = int(pred[0])  # 0 or 1
    return pred_label

########################################
# 로그 기록 함수
########################################
def write_log(message):
    with open(PREDICTION_LOG_PATH, 'a', encoding='utf-8') as f:
        f.write(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | {message}\n")

########################################
# 실제 결과와 예측 비교 & 로그
########################################
def check_prediction_accuracy(df):
    global correct_count
    global incorrect_count

    for predicted_time_str, predicted_label in list(predictions_dict.items()):
        predicted_time = pd.to_datetime(predicted_time_str)

        # 현재 봉이 predicted_time, 다음 봉이 predicted_time + 1
        row_index = df.index[df['candle_date_time_kst'] == predicted_time]
        if len(row_index) == 0:
            # 아직 df에 해당 시각이 없으면 건너뜀
            continue

        idx = row_index[0]
        next_idx = idx + 1
        if next_idx >= len(df):
            # 다음 봉이 아직 생성 안됨
            continue

        actual_label = df.iloc[next_idx]['label']
        correctness = (predicted_label == actual_label)

        # 맞춤/틀림 카운트 갱신
        if correctness:
            correct_count += 1
        else:
            incorrect_count += 1

        log_msg = (
            f"Prediction time={predicted_time_str}, "
            f"Predicted={predicted_label}, Actual={actual_label}, "
            f"Correct={correctness}, "
            f"TotalCorrect={correct_count}, TotalWrong={incorrect_count}"
        )
        write_log(log_msg)

        # 이미 평가 완료 -> dict에서 제거
        del predictions_dict[predicted_time_str]

########################################
# 메인 루프
########################################
def main_loop():
    global last_file_size
    global model

    while True:
        if os.path.exists(CSV_FILE_PATH):
            current_file_size = os.path.getsize(CSV_FILE_PATH)

            if current_file_size > last_file_size:
                write_log("Detected new data in CSV. Retraining model...")

                # 모델 재학습
                model, df_all = train_model_from_csv(CSV_FILE_PATH)
                write_log("Model re-trained.")

                # 가장 최신 봉을 기준으로 "다음 캔들" 예측
                pred_label = predict_next_candle(model, df_all)
                last_kst = df_all.iloc[-1]['candle_date_time_kst']
                predictions_dict[str(last_kst)] = pred_label

                log_msg = f"Predicted next candle after {last_kst} as label={pred_label}"
                write_log(log_msg)

                # 이전에 예측해둔 것들 중, "이제 실제로 결과가 들어왔는지" 확인
                check_prediction_accuracy(df_all)

                # 파일 사이즈 갱신
                last_file_size = current_file_size

            else:
                # 파일 변화 없음 -> 기존 예측 검증만 시도
                pass

        time.sleep(CHECK_INTERVAL)

        # 매 루프마다 (혹은 일정 조건) df를 다시 로드하여, 
        # 이미 예측해둔 봉(next candle)이 들어왔는지 재검사
        if model is not None and len(predictions_dict) > 0:
            df_check = pd.read_csv(CSV_FILE_PATH)
            df_check['candle_date_time_kst'] = pd.to_datetime(df_check['candle_date_time_kst'])
            df_check.sort_values('candle_date_time_kst', inplace=True)
            check_prediction_accuracy(df_check)


if __name__ == "__main__":
    write_log("Starting CSV monitoring + model pipeline...")
    main_loop()
