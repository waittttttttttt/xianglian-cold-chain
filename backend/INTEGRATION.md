# 湘链智图 · 真实数据与模型接入指南

> 当前 `backend/data/*.json` 为演示占位数据。参赛前请按本指南替换为团队真实测算结果。

## 一、目录结构（v2）

```
现代物流网页/
├── pages/index.html           # 前端入口（通常无需改动）
├── js/app.js                  # 前端交互（对接新 API 时才改动）
├── colors_and_type.css        # 主题样式
├── assets/hunan.json          # 湖南 GeoJSON
└── backend/
    ├── app_stdlib.py          # 后端入口（已预留模型调用位置）
    ├── INTEGRATION.md         # 本文件
    └── data/
        ├── overview.json      # 全省 KPI 总览
        ├── nodes.json         # 物流节点
        ├── routes.json        # 运输走廊
        ├── industry_perspectives.json
        ├── logistics_perspectives.json
        └── sales_perspectives.json
```

> v1 遗留的 `backend/models/`、`backend/utils/`、`backend/app.py`、`backend/requirements.txt` 已清理，避免混淆。

## 二、数据替换（无需改代码）

### 1. nodes.json — 物流节点

必须保留字段：

```json
{
  "nodes": [
    {
      "id": "CS_HUB",
      "name": "长沙金霞枢纽",
      "type": "hub",
      "city": "长沙市",
      "lng": 112.98,
      "lat": 28.25,
      "throughput": 1250,
      "industries": ["先进制造", "电子信息"]
    }
  ]
}
```

- `id`：唯一标识，routes.json 中引用
- `type`：仅允许 `hub`（枢纽）、`city`（城市中心）、`county`（县域站点）
- `throughput`：年吞吐量，单位 **万吨/年**，直接影响需求预测模型

### 2. routes.json — 运输走廊

```json
{
  "routes": [
    {
      "id": "R01",
      "name": "长沙—岳阳—常德干线",
      "level": "trunk",
      "mode": "公铁联运",
      "stops": ["CS_HUB", "YY_CITY", "CD_CITY"],
      "volumeTons": 320
    }
  ]
}
```

- `level`：`trunk`（干线）或 `feeder`（接驳）
- `stops`：引用 nodes.json 中的 `id`

### 3. overview.json — 全省 KPI

```json
{
  "kpis": [
    {"label": "全省社会物流总额", "value": 12.8, "unit": "万亿元", "delta": "+6.2%", "dir": "up"},
    {"label": "物流总费用/GDP", "value": 13.5, "unit": "%", "delta": "-0.4%", "dir": "down-good"}
  ],
  "description": "围绕湖南省域物流体系……"
}
```

### 4. *_perspectives.json — 三端视角

保持现有 JSON 结构不变，仅替换数值与文案。前端按字段名渲染。

## 三、规划模型接入（改 backend/app_stdlib.py）

### 推荐做法

1. 把你的路径优化算法、需求预测模型写成独立 `.py` 文件（可用 numpy/pulp/scipy 等任意库）。
2. 在 `app_stdlib.py` 顶部 `import` 你的模型模块。
3. 修改 `compute_optimize_route(payload)` 与 `compute_predict_demand(payload)`，在函数开头调用真实模型，并返回前端需要的字段。

### 函数输入输出契约

#### `compute_optimize_route(payload)`

输入：

```python
{
  "startId": "CS_HUB",      # nodes.json 中的节点 id
  "endId": "CZ_HUB",        # 终点节点 id
  "cargoType": "cold",      # general | cold | express | heavy
  "tons": 10                # 货量（吨）
}
```

输出（必须包含）：

```python
{
  "pathIds": ["CS_HUB", "HY_HUB", "CZ_HUB"],
  "pathNames": ["长沙金霞枢纽", "怀化陆港枢纽", "郴州湘南枢纽"],
  "pathCoords": [[112.98, 28.25], [109.98, 27.55], [113.03, 25.78]],
  "distanceKm": 483.5,
  "estimatedHours": 9.2,
  "cargoLabel": "冷链（2-8°C）",
  "tons": 10,
  "costYuan": 4932,
  "costPerTon": 493.2,
  "lossRate": 0.018,
  "note": "模型说明文字"
}
```

#### `compute_predict_demand(payload)`

输入：

```python
{
  "region": "长沙市",       # 节点名称或城市名
  "season": "夏季"          # 春季 | 夏季 | 秋季 | 冬季
}
```

输出（必须包含）：

```python
{
  "region": "长沙市",
  "season": "夏季",
  "predictedMonthlyWanTons": [119.2, 123.5, 130.0, 136.5, 132.2, 125.7],
  "monthLabels": ["下月", "+2月", "+3月", "+4月", "+5月", "+6月"],
  "totalHalfYearWanTons": 765.1,
  "peakMonths": ["+3月", "+4月", "+5月"],
  "recommendedVehicles": 48,
  "confidence": 0.87,
  "note": "模型说明文字"
}
```

### 最小改动示例

假设你写好了 `backend/models/route_optimizer.py` 与 `backend/models/demand_model.py`：

```python
# 在 app_stdlib.py 顶部加入
import sys
sys.path.insert(0, os.path.join(BASE_DIR, 'models'))
from route_optimizer import optimize_route
from demand_model import predict_demand

# 替换 compute_optimize_route 函数体
return optimize_route(nodes, payload)

# 替换 compute_predict_demand 函数体
return predict_demand(nodes, season_factor, payload)
```

## 四、新增自定义 API

若需要新增接口（例如 `/api/what-if-scenario`）：

1. 在 `Handler.do_GET` 或 `do_POST` 中添加分支。
2. 返回 JSON。
3. 在 `js/app.js` 的 `API` 对象中新增路径，并在需要的地方调用。

示例：

```python
elif path == '/api/scenario':
    self._send_json(run_scenario_model(payload))
```

```javascript
const API = {
  // ...
  scenario: '/api/scenario',
};
```

## 五、调试与验证

每次修改后：

1. 重启后端：`Ctrl+C` 停止旧进程，再运行 `python backend/app_stdlib.py`
2. 检查健康：`http://localhost:5000/api/health`
3. 检查 JSON 语法：浏览器直接访问 `/api/nodes`、`/api/routes` 等
4. 检查模型输出：用 Postman 或 `curl` 调用 `/api/optimize-route`

## 六、注意事项

- **不要删除或重命名 `data/` 下的 JSON 文件**，否则 API 会 500
- **所有数值保持原始精度**，前端统一格式化显示
- **坐标系使用 WGS-84（经纬度）**，与 `assets/hunan.json` 保持一致
- 若引入 pip 依赖，请在 README 或本文件中补充安装命令；当前 `app_stdlib.py` 仍保持零依赖，便于本地演示
