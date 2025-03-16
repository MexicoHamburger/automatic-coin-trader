import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.metrics import accuracy_score, confusion_matrix
from sklearn.model_selection import train_test_split

# ----- (1) RSI 계산 함수 ----- #
def compute_rsi(series, period=14):
    """
    단순 RSI 계산 함수 (지수 이동평균 아님).
    series: 가격 시계열 (pd.Series)
    period: RSI 기간
    """
    delta = series.diff()
    # 상승분, 하락분
    gain = delta.where(delta > 0, 0.0)
    loss = -delta.where(delta < 0, 0.0)

    # 평균값 (단순 or 지수 이동평균 선택 가능)
    avg_gain = gain.rolling(window=period).mean()
    avg_loss = loss.rolling(window=period).mean()

    # 0으로 나누어지는 것 방지
    rs = avg_gain / (avg_loss + 1e-9)
    rsi = 100 - (100 / (1 + rs))
    return rsi

# ----- (2) 3분봉 CSV 읽기 (예시) ----- #
# 여러분이 가진 데이터에 맞춰 파일경로/컬럼명을 수정하세요.
df = pd.read_csv('responses/3min_candle_1year.csv', parse_dates=['candle_date_time_kst'])

# 2-1. 시간 오름차순 정렬
df.sort_values('candle_date_time_kst', inplace=True)

# ----- (3) 특징 생성 ----- #
# [직전 5봉]의 가격, 거래량, 간단한 지표
# 예: opening_price, high_price, low_price, trade_price, candle_acc_trade_volume
# RSI(짧게, period=6 정도)도 하나 넣어본다.

# 간단히 전체 종가에 대한 rsi 생성
df['rsi'] = compute_rsi(df['trade_price'], period=6)

# 3-1. 직전 N(=5)개 봉의 피처를 하나로 합치기
N = 5  # 직전 5봉
feature_list = []
for i in range(1, N+1):
    # shift(i): i만큼 이전 데이터
    df[f'open_shift_{i}'] = df['opening_price'].shift(i)
    df[f'high_shift_{i}'] = df['high_price'].shift(i)
    df[f'low_shift_{i}'] = df['low_price'].shift(i)
    df[f'close_shift_{i}'] = df['trade_price'].shift(i)
    df[f'vol_shift_{i}'] = df['candle_acc_trade_volume'].shift(i)
    feature_list += [
        f'open_shift_{i}',
        f'high_shift_{i}',
        f'low_shift_{i}',
        f'close_shift_{i}',
        f'vol_shift_{i}'
    ]

# 3-2. RSI 값도 직전 1봉 정도만 넣어본다 (너무 많이 넣으면 과적합 위험)
df['rsi_shift_1'] = df['rsi'].shift(1)
feature_list.append('rsi_shift_1')

# ----- (4) 라벨 정의 ----- #
# 예시: "현재 봉 종가 > 직전 봉 종가" 이면 label=1, 아니면 0
df['prev_close'] = df['trade_price'].shift(1)
df['label'] = (df['trade_price'] > df['prev_close']).astype(int)

# NaN(초기 몇개, 지표 계산 등)은 제거
df.dropna(inplace=True)

# ----- (5) 데이터 분할 (훈련/검증/테스트) ----- #
# 시계열이므로 단순 예시: 앞에서 70%는 train, 다음 15% val, 마지막 15% test
total_len = len(df)
train_end = int(total_len * 0.70)
valid_end = int(total_len * 0.85)

df_train = df.iloc[:train_end]
df_val   = df.iloc[train_end:valid_end]
df_test  = df.iloc[valid_end:]

X_train = df_train[feature_list]
y_train = df_train['label']
X_val   = df_val[feature_list]
y_val   = df_val['label']
X_test  = df_test[feature_list]
y_test  = df_test['label']

# ----- (6) XGBoost 분류 모델 학습 ----- #
model = xgb.XGBClassifier(
    n_estimators=200,
    max_depth=4,
    learning_rate=0.01,
    random_state=42,
    use_label_encoder=False,
    eval_metric='logloss'
)

# 학습
model.fit(
    X_train, y_train,
    eval_set=[(X_val, y_val)],
    verbose=True
)

# ----- (7) 예측 및 성능 확인 ----- #
pred_test = model.predict(X_test)
acc_test = accuracy_score(y_test, pred_test)
cm_test = confusion_matrix(y_test, pred_test)

print("Test Accuracy:", acc_test)
print("Confusion Matrix:\n", cm_test)

# 모델의 feature importance 확인 (참고용)
import matplotlib.pyplot as plt

xgb.plot_importance(model, max_num_features=15)
plt.show()

# ----- (추가) 추론 시 예시 ----- #
# 새로운 실시간 봉 데이터(직전 5봉 포함)를 만약 real_df 라고 한다면:
# real_df 에도 동일한 방식으로 shift 컬럼과 rsi_shift_1 등을 만든 후
# features = real_df[feature_list].tail(1)  # 가장 최근 1개
# pred = model.predict(features)
# print("최근 봉 상승 예측?" , pred[0])  # 1이면 상승, 0이면 하락
