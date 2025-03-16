import pandas as pd
import numpy as np

# --- (1) ta 라이브러리: 모든 지표 자동 생성 함수 사용
import ta  # pip install ta

# --- (2) 머신러닝 라이브러리
import xgboost as xgb
from sklearn.metrics import accuracy_score, confusion_matrix
from sklearn.model_selection import train_test_split

# ----- CSV 파일 로드 & 전처리 ----- #
df = pd.read_csv(
    '../responses/3min_candle_1year.csv', 
    parse_dates=['candle_date_time_kst']
)

# 시간 오름차순 정렬
df.sort_values('candle_date_time_kst', inplace=True)

# ----- (3) ta 라이브러리를 이용해 "모든" 지표 생성 ----- #
# ta.add_all_ta_features(
#     df, 
#     open='opening_price', 
#     high='high_price', 
#     low='low_price', 
#     close='trade_price', 
#     volume='candle_acc_trade_volume',
#     fillna=True
# )
#
# 위 함수는 OHLCV 기반의 거의 모든 지표를 df에 컬럼으로 추가합니다.
# 다만, 데이터가 많지 않은 경우 컬럼이 너무 많아질 수 있으므로 주의.

df = ta.add_all_ta_features(
    df,
    open='opening_price',
    high='high_price',
    low='low_price',
    close='trade_price',
    volume='candle_acc_trade_volume',
    fillna=True
)

# df에 지표가 대거 추가되었을 것입니다.
# 예: 'volume_adi', 'volume_obv', 'volume_cmf', 'volume_fi', 'volatility_bbm', ...
#     'trend_macd', 'trend_macd_signal', 'momentum_rsi', 'momentum_stoch_rsi', etc.

# ----- (4) 라벨 정의: "현재 봉 종가 > 직전 봉 종가" 이면 1, 아니면 0 ----- #
df['prev_close'] = df['trade_price'].shift(1)
df['label'] = (df['trade_price'] > df['prev_close']).astype(int)

# 라벨 계산에 필요한 행(맨 앞 1행)에 NaN이 있을 수 있으므로 제거
df.dropna(subset=['prev_close'], inplace=True)

# ----- (5) Feature 컬럼 선정 ----- #
# ta.add_all_ta_features() 로 생성된 컬럼 중, 
# 'candle_date_time_kst', 'timestamp', 'prev_close', 'label' 등은 제외.
exclude_cols = [
    'candle_date_time_kst', 'timestamp', 'candle_acc_trade_price',
    'prev_close', 'label', 'market', 'candle_date_time_utc'
]
# 원본 OHLCV도 제외하거나 포함하는 것은 자유이지만, 여기서는 포함해 봄
# 필요 없는 컬럼은 여기서 제외하면 됩니다.
features = [col for col in df.columns if col not in exclude_cols]

X = df[features]
y = df['label']

print("All features:", features)
print("Number of features:", len(features))

# ----- (6) 시계열 분할 (Train / Validation / Test) ----- #
total_len = len(df)
train_end = int(total_len * 0.7)
valid_end = int(total_len * 0.85)

X_train = X.iloc[:train_end]
y_train = y.iloc[:train_end]

X_val = X.iloc[train_end:valid_end]
y_val = y.iloc[train_end:valid_end]

X_test = X.iloc[valid_end:]
y_test = y.iloc[valid_end:]

# ----- (7) XGBoost 분류 모델 학습 ----- #
# 일부 구버전 XGBoost에서는 early_stopping_rounds 등이 없으므로 제거
model = xgb.XGBClassifier(
    n_estimators=300,
    max_depth=6,
    learning_rate=0.01,
    random_state=42,
    use_label_encoder=False,       # 필요시
    eval_metric='logloss'          # 경고 제거용
)

# fit
# (eval_set 파라미터를 주면 검증 세트 손실 추적 가능)
# 구버전이면 early_stopping_rounds를 빼주세요.
model.fit(
    X_train, y_train,
    eval_set=[(X_val, y_val)],
    # early_stopping_rounds=20,  # xgboost 버전에 따라 제거
    verbose=True
)

# ----- (8) 예측 및 성능 확인 ----- #
pred_test = model.predict(X_test)
acc_test = accuracy_score(y_test, pred_test)
cm_test = confusion_matrix(y_test, pred_test)

print("Test Accuracy:", acc_test)
print("Confusion Matrix:\n", cm_test)

# (옵션) Feature Importance 시각화
import matplotlib.pyplot as plt
xgb.plot_importance(model, max_num_features=15)
plt.show()

