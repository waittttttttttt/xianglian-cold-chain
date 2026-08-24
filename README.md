# 湘链智图 · 湖南省物流规划数字平台

> 第十一届湖南省大学生现代物流设计竞赛 参赛作品演示
> 产业端 × 物流端 × 销售端 —— 三端协同的省域智慧物流规划交互平台

## 一、项目定位

围绕湖南省域物流体系，从三个视角展示并模拟物流规划决策：

| 视角 | 内容 |
|------|------|
| 产业端 | 先进制造 / 特色农业 / 文旅消费三大产业集群的物流需求、痛点与优化方案 |
| 物流端 | 「枢纽 + 城市 + 县域」三级网络、6 条干线走廊、车队运力与成本分析 |
| 销售端 | 渠道结构（电商/直播/商超等）、履约时效 SLA、月度订单流量 |

交互能力：湖南全省地图节点可视化（可筛选/缩放）、干线飞线动画、路径优化实时计算、区域需求预测。

## 二、技术架构

```
┌─────────────── 浏览器前端 ───────────────┐
│ pages/index.html      页面结构            │
│ js/app.js             交互逻辑 + ECharts   │
│ colors_and_type.css   主题（清新蓝绿科技风）│
│ assets/hunan.json     湖南省地图 GeoJSON   │
│ assets/vendor/*       echarts 本地依赖    │
└────────────── 同源 HTTP ──────────────┘
┌─────────────── Python 后端 ──────────────┐
│ backend/app_stdlib.py 零依赖 HTTP 服务    │
│ backend/data/*.json   三端数据 + 节点/走廊 │
│ backend/models/       规划模型（待接入）   │
└──────────────────────────────────────┘
```

**零依赖**：后端仅用 Python 标准库，无需 pip install 任何东西；前后端同源部署，没有跨域问题。Python 3.6+ 均可运行。

## 三、本地运行

```bash
cd 现代物流网页/backend
python app_stdlib.py
# 打开 http://localhost:5000/
```

换端口：`set PORT=8000 && python app_stdlib.py`（PowerShell：`$env:PORT=8000; python app_stdlib.py`）

## 四、API 一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/overview` | 全省 KPI 总览 |
| GET | `/api/nodes?type=hub\|city\|county` | 物流节点（19 个，含经纬度） |
| GET | `/api/routes` | 干线走廊 + 县域接驳线 |
| GET | `/api/perspectives/industry` | 产业端视角数据 |
| GET | `/api/perspectives/logistics` | 物流端视角数据 |
| GET | `/api/perspectives/sales` | 销售端视角数据 |
| POST | `/api/optimize-route` | 路径优化 `{startId,endId,cargoType,tons}` |
| POST | `/api/predict-demand` | 需求预测 `{region,season}` |

## 五、如何替换真实数据（重要）

当前 `backend/data/*.json` 为**演示占位数据**，替换时保持字段结构不变即可，前端无需改动：

1. **节点数据** → 改 `nodes.json`（id/name/type/city/lng/lat/throughput）
2. **走廊规划** → 改 `routes.json`（stops 引用 nodes 的 id）
3. **三端指标/图表** → 改 `industry_perspectives.json` / `logistics_perspectives.json` / `sales_perspectives.json`
4. **规划模型代码** → 放入 `backend/models/`，在 `app_stdlib.py` 的 `compute_optimize_route()` 与 `compute_predict_demand()` 两处调用真实模型（函数已留好输入输出契约），或新增 API 路径后在 `js/app.js` 的 `runOptimize()/runPredict()` 对接
5. 改完重启 `python app_stdlib.py` 即生效（数据有缓存）

## 六、部署上线（免费方案）

推荐 **Render**（免费 750 小时/月，支持 Python 原生服务）：

1. 把本项目推送到 GitHub：
   ```bash
   git init   # 已初始化可跳过
   git add .
   git commit -m "feat: 湘链智图 v2 - 三端协同湖南省物流规划平台"
   git remote add origin https://github.com/<你的用户名>/hunan-logistics-platform.git
   git push -u origin main
   ```
2. 在 [render.com](https://render.com) 新建 **Web Service**，连接该仓库
3. 配置：Build Command 留空；Start Command 填 `python app_stdlib.py`；实例类型 Free
4. Render 会注入 `PORT` 环境变量，代码已自动适配
5. 部署完成后获得 `https://xxx.onrender.com` 公网地址（免费实例闲置 15 分钟会休眠，首次访问需等待约 30-60 秒唤醒）

备选：Vercel/Netlify 仅适合纯静态；Railway 有免费额度但需绑卡；比赛现场演示建议本地运行最稳定。

## 七、目录结构

```
现代物流网页/
├── .design                    # 画布元数据
├── colors_and_type.css        # 全站主题样式
├── README.md
├── assets/
│   ├── hunan.json             # 湖南省地图 GeoJSON（DataV.GeoAtlas）
│   └── vendor/                # ECharts 等本地依赖
├── pages/index.html           # 单页应用入口
├── js/app.js                  # 全部交互逻辑
└── backend/
    ├── app_stdlib.py          # 零依赖后端入口
    ├── data/*.json            # 演示数据（可整体替换）
    ├── models/                # 规划模型预留位
    └── utils/
```

---
页面数值均为演示占位数据，正式参赛版本将接入团队真实测算模型。
