# 湘链智图 · 真实数据与模型接入指南（生鲜冷链版）

> 当前 `backend/data/*.json` 为演示占位数据。参赛前请按本指南替换为团队真实测算结果。
> **字段结构就是前后端契约**——只改数值与条目、不改字段名，前端与 API 无需任何改动。
> 数据文件支持热加载：替换 JSON 后刷新页面即生效，无需重启服务。

## 一、目录结构

```
现代物流网页/
├── pages/index.html           # 前端入口（通常无需改动）
├── js/app.js                  # 前端交互（对接新 API 时才改动）
├── colors_and_type.css        # 冰川蓝×薄荷青主题样式
├── assets/hunan.json          # 湖南 GeoJSON（DataV.GeoAtlas，WGS-84）
└── backend/
    ├── app_stdlib.py          # 后端入口（两处 TODO 模型接入点）
    ├── INTEGRATION.md         # 本文件
    └── data/
        ├── overview.json      # 全省冷链 KPI 总览
        ├── cities.json        # 14 市州冷链家底 ★核心数据
        ├── products.json      # 生鲜品类冷链参数 ★核心数据
        └── analysis.json      # 数据洞察图表数据
```

> 旧版「三端协同」遗留数据（nodes/routes/perspectives 等）已不被后端读取，确认无用后可删除。

## 二、数据文件契约

### 1. cities.json — 市州冷链家底

```json
{
  "cities": [
    {
      "id": "CS",                      // 唯一标识，模拟器/详情接口引用
      "name": "长沙市",                 // 与 GeoJSON 市州名对应（见下方映射说明）
      "lng": 112.94, "lat": 28.23,     // 市州中心 WGS-84 坐标
      "coldStorageWanTons": 120,       // 冷库容量（万吨位），驱动地图着色与排行
      "freshOutputWanTons": 62,        // 生鲜年产量（万吨），驱动需求预测基线
      "coldVehicles": 4200,            // 冷藏车保有量（辆）
      "flowRate": 52,                  // 冷链流通率（%）
      "mainProducts": ["肉类加工", "乳品"]  // 主导生鲜品类（详情卡片标签展示）
    }
  ]
}
```

注意（地图着色与命名）：ECharts 按 GeoJSON 要素名精确匹配着色。GeoJSON 中湘西州为全称
「湘西土家族苗族自治州」。前端通过 `nameMap` 自动把要素全称对齐到数据表简称，因此
`name` 写全称或简称均可着色；含「湘西」的名称会自动归到「湘西州」。替换数据后以
「14 个市州在地图上全部有色阶」为准自行核对一遍。

### 2. products.json — 品类冷链参数

```json
{
  "products": [
    {
      "key": "aquatic",            // 模拟器引用键（前端自动生成品类按钮，加一行即多一个品类）
      "label": "水产类",
      "tempZone": "-18℃ 以下",     // 运输温区（展示用）
      "ratePerTonKm": 0.88,        // 干线运费率（元/吨公里）
      "handlingFee": 350,          // 单端冷库装卸费（元）
      "avgSpeedKmh": 56,           // 冷藏车均速（km/h）
      "lossBase": 0.018,           // 基础损耗率（全程占比，0.018 = 1.8%）
      "unitPriceYuan": 18000,      // 货值（元/吨），用于折算损耗金额
      "riskBase": 4,               // 温控断链基础风险（%）
      "reeferLoad": 0.35           // 制冷机组额外油耗比例
    }
  ]
}
```

### 3. overview.json / analysis.json

- `overview.json`：`kpis` 数组（label/value/unit/delta/dir），`dir` 取 `up` 或 `down-good`（下降为优时用后者）
- `analysis.json`：`categoryShare.data`（品类占比饼图）、`monthlyTrend`（逐月 avgTempC + lossRate）、`flowCompare`（各市州 flowRates + provinceAvg 均值线）

## 三、规划模型接入（改 backend/app_stdlib.py）

后端有两处带 `TODO(团队模型接入点)` 注释的函数，替换函数体即可：

### 接入点 1：`compute_simulate_coldchain(payload)`

输入：

```python
{
  "fromId": "CS",        # 起点 cities.json 的 id
  "toId": "YY",          # 终点 cities.json 的 id
  "product": "aquatic",  # products.json 的 key
  "tons": 15             # 货量（吨）；非数字/NaN/负值已在进入本函数前被拦截（返回 400）
}
```

输出（必须包含以下字段，前端按字段名渲染）：

```python
{
  "fromId": "CS", "toId": "YY",
  "fromName": "长沙市", "toName": "岳阳市",
  "productKey": "aquatic",
  "productLabel": "水产类",
  "tempZone": "-18℃ 以下",
  "tons": 15,
  "distanceKm": 158.8,          # 运输距离
  "estimatedHours": 4.0,        # 门到门时效
  "costYuan": 2796,             # 总成本（元）
  "costPerTon": 186.4,          # 单位成本（元/吨）
  "fuelLiters": 64.3,           # 燃油消耗
  "co2Kg": 170.4,               # 碳排放
  "tempRiskPct": 7.2,           # 温控断链风险（%）
  "tempPassRate": 92.8,         # 温控达标率（%）
  "lossTons": 0.23,             # 预估损耗（吨）
  "lossValueYuan": 4140,        # 损耗货值（元）
  "lossRateEffPct": 1.53,
  "pathCoords": [[112.94, 28.23], [113.13, 29.36]],  # 地图画线坐标
  "note": "模型说明文字"
}
```

### 接入点 2：`compute_predict_demand(payload)`

输入：

```python
{
  "cityId": "CD",     # cities.json 的 id（也兼容传市州名）
  "season": "夏季"    # 春季 | 夏季 | 秋季 | 冬季
}
```

输出（必须包含）：

```python
{
  "cityId": "CD",
  "cityName": "常德市",
  "season": "夏季",
  "predictedMonthlyWanTons": [6.5, 6.8, 7.3, 7.6, 7.1, 6.7],
  "monthLabels": ["下月", "+2月", "+3月", "+4月", "+5月", "+6月"],
  "totalHalfYearWanTons": 42.0,
  "peakMonths": ["+3月", "+4月", "+5月"],
  "recommendedVehicles": 112,
  "confidence": 0.86,
  "note": "模型说明文字"
}
```

### 错误返回约定（两个接入点通用）

- 业务校验失败（如市州不存在、品类未知）：直接返回 `{'error': '中文原因'}`，
  框架按 HTTP 200 下发，前端 toast 会原样展示该文案；
- 返回值中的数值必须是有限数字（NaN/Infinity 会触发框架保护并返回 500）；
- 未捕获异常不会泄露给页面——页面只见通用错误文案，堆栈留在后端控制台。

### 最小改动示例

假设团队模型写在 `backend/models/coldchain_model.py`：

```python
# app_stdlib.py 顶部加入
import sys
sys.path.insert(0, os.path.join(BASE_DIR, 'models'))
from coldchain_model import simulate as team_simulate
from coldchain_model import predict as team_predict

# 替换两个函数体（保持函数名不变）
def compute_simulate_coldchain(payload):
    return team_simulate(payload)

def compute_predict_demand(payload):
    return team_predict(payload)
```

第三方库（numpy/pandas 等）可自由使用——只有 `app_stdlib.py` 本身保持零依赖约定即可。

## 四、新增自定义 API

1. 在 `Handler.do_GET` / `do_POST` 中添加分支并返回 JSON；
2. 在 `js/app.js` 的 `API` 对象中登记路径后即可在前端调用。

```python
elif path == '/api/scenario':
    self._send_json(run_scenario_model(payload))
```

## 五、调试与验证

每次修改后：

1. 改数据（data/*.json）：保存后刷新页面即生效（热加载，无需重启）
2. 改代码（app_stdlib.py / app.js 等）：重启后端 `Ctrl+C` → `python backend/app_stdlib.py`
3. 健康检查：`http://127.0.0.1:5000/api/health`
4. 数据检查：浏览器直接访问 `/api/cities`、`/api/products` 看 JSON 是否合法
5. 模型检查：POST `/api/simulate-coldchain` 验证返回字段完整性

## 六、注意事项

- **不要删除或重命名 `data/` 下四个 JSON 文件**，否则对应 API 会 500
- **所有数值保持原始精度**，前端统一格式化显示；数值字段必须是数字类型而非字符串
  （启动期自检会点检 cities/products 的关键数值字段，字符串数字会拒绝启动）
- **坐标系统一 WGS-84 经纬度**，与 `assets/hunan.json` 一致
- 若某市州地图不着色，优先核对该市州 `name` 与 GeoJSON 要素名的对应关系（见第二节说明）
