class DemandPredictor:
    """Demand prediction placeholder.
    Replace this with your actual model (e.g., XGBoost, ARIMA, LSTM).
    """
    def predict(self, region, season):
        base = {'春季': 120, '夏季': 180, '秋季': 220, '冬季': 90}
        seasonal = base.get(season, 120)
        return {
            'region': region,
            'season': season,
            'predictedDemandTons': seasonal * 1.15,
            'peakMonths': ['6月', '7月', '8月'] if season == '夏季' else ['9月', '10月', '11月'],
            'recommendedVehicles': 6 if seasonal > 150 else 4,
            'confidence': 0.86,
            'note': '此为演示结果，请替换为真实模型输出'
        }