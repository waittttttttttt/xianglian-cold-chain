/* ============================================================
   湘链智图 · 生鲜冷链前端交互逻辑（框架版 v6）
   数据源：同源后端 /api/*（零依赖 Python 服务）
   数据契约：所有业务数据字段与 backend/data/*.json 一一对应，
   团队替换真实数据/模型后无需改动本文件。
   ------------------------------------------------------------
   v8 关键变更（主题：打破物流产业「两张皮」信息壁垒）：
   1. 图表生命周期统一收口 createChart()；innerHTML 全量 esc()；
   2. 主色冰川蓝 #0ea5e9 × 薄荷青 #14b8a6，琥珀仅预警；
   3. ★新增「多主体协同」板块：农户/冷库/承运商/市场四类节点叠加省图，
      货流实线 vs 信息流虚线（灰虚线=未联通，「两张皮」的具象化），
      图例可逐类开关主体，信息联通率 KPI 直接量化壁垒；
   4. ★新增「实时预警事件流」：让顶栏「温控监测中」名副其实，
      琥珀预警列表+处置建议+mini 地图琥珀涟漪（页面不可见时停轮询）；
   5. 模拟结果升级「冷链生命线」四环节点亮序列，断链环节琥珀闪烁；
   6. 地图 nameMap 自动对齐 GeoJSON 全称/简称（湘西州着色修复）。
   ============================================================ */
'use strict';

/* 本行能执行 = 主脚本解析成功，才允许启用入场动画（html.anim 门控）。
   老浏览器解析失败时本行不会生效，页面退化为无动画的静态可读模式。 */
document.documentElement.className += ' anim';

const API = {
  // 静态部署（GitHub Pages）时使用本地 JSON 文件
  overview: 'backend/data/overview.json',
  cities: 'backend/data/cities.json',
  products: 'backend/data/products.json',
  analysis: 'backend/data/analysis.json',
  cityDetail: 'backend/data/cities.json', // 静态模式下从cities里取，详见getCityDetail()
  simulate: 'backend/data/overview.json', // 静态模式下前端计算，详见simulateColdchain()
  predict: 'backend/data/products.json',  // 静态模式下前端计算，详见predictDemand()
  mapGeo: 'assets/hunan.json',
  mapCounty: 'assets/counties/', // + adcode + _full.json
  network: 'backend/data/network.json',
  events: 'backend/data/events.json',
  resources: 'backend/data/resources.json',
};

/* 冰川蓝 × 薄荷青 冷链主色板；琥珀不进通用色板——预警语义保留给 CSS .tag-warn */
const CHART_COLORS = ['#0ea5e9', '#14b8a6', '#38bdf8', '#2dd4bf', '#0369a1'];
const REDUCED_MOTION = window.matchMedia &&
  matchMedia('(prefers-reduced-motion: reduce)').matches;
/* 默认示范线路终点：按 id 显式指定，不再耦合 cities.json 的条目顺序 */
const DEFAULT_TO_CITY_ID = 'YY';
const FETCH_TIMEOUT_MS = 12000;
/* 市州 → 行政区划代码（adcode），与后端 COUNTY_ADCODES 保持一致；
   用于点击市州后下钻加载区县级边界（DataV.GeoAtlas，免密钥） */
const CITY_ADCODE = {
  CS: '430100', ZZ: '430200', XT: '430300', HY: '430400',
  SY: '430500', YY: '430600', CD: '430700', ZJJ: '430800',
  YIY: '430900', CZ: '431000', YZ: '431100', HH: '431200',
  LD: '431300', XX: '433100',
};

let citiesData = [];
let currentProduct = 'fruitveg';
let mapLevel = 'province';   // province=省域 choropleth；city=某市州区县视图
let activeCountyCity = null; // 下钻时记录当前市州对象

/* ---------------- 工具函数 ---------------- */

/* OWASP 规则 #1/#3：进入 HTML 正文与属性的不可信数据必须先转义 */
function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function getJSON(url, opts) {
  // 每次请求带超时：后端卡住时按钮不再永久 disabled
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const res = await fetch(url, Object.assign({}, opts || {},
      ctrl ? { signal: ctrl.signal } : {}));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new Error('服务响应超时，请确认后端已启动');
    }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function postJSON(url, body) {
  return getJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function toast(msg, isError) {
  let host = document.getElementById('toastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toastHost';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' err' : '');
  el.textContent = msg; // textContent 天然免转义
  host.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2600);
}

function countUp(el, target, decimals) {
  const t = Number(target);
  if (!isFinite(t)) { el.textContent = '--'; return; } // 坏数据显示占位而不是 NaN
  if (REDUCED_MOTION) { el.textContent = t.toFixed(decimals || 0); return; }
  const dur = 1100, start = performance.now();
  function tick(now) {
    const p = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = (t * eased).toFixed(decimals || 0);
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function hidePageLoader() {
  const loader = document.getElementById('pageLoader');
  if (loader) loader.classList.add('hidden');
}

function setupScrollProgress() {
  const bar = document.getElementById('scrollProgress');
  if (!bar) return;
  const onScroll = () => {
    const doc = document.documentElement;
    const scrolled = doc.scrollTop / Math.max(doc.scrollHeight - doc.clientHeight, 1);
    bar.style.width = Math.min(100, Math.max(0, scrolled * 100)) + '%';
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* ripple 改为事件委托：后生成的品类按钮也有效，监听器从 N 个变 1 个 */
function bindRipple() {
  document.addEventListener('click', e => {
    const btn = e.target.closest('.btn');
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const size = Math.max(r.width, r.height);
    const span = document.createElement('span');
    span.className = 'ripple';
    span.style.left = (e.clientX - r.left - size / 2) + 'px';
    span.style.top = (e.clientY - r.top - size / 2) + 'px';
    span.style.width = span.style.height = size + 'px';
    btn.appendChild(span);
    setTimeout(() => span.remove(), 600);
  });
}

/* ---------------- 图表生命周期（唯一创建入口） ---------------- */

const charts = {};          // key -> echarts 实例
let resizeBound = false;
let analysisCache = null;   // 主题切换只换皮，不重复请求 /api/analysis
let lastSimRes = null;      // 记住最近一次模拟/预测结果，切主题后原样重绘
let lastPredRes = null;
let lastNetwork = null;     // 多主体协同网络缓存（切主题零请求重建）
let lastEvents = [];        // 最近一次事件流数据
let lastResources = null;   // 可共享资源池缓存
let resFilter = '';         // 资源表当前市州筛选（空=全部）
let eventTimer = 0;         // 事件轮询句柄
let eventVisBound = false;

function bindGlobalChartResize() {
  if (resizeBound) return;
  resizeBound = true;
  window.addEventListener('resize', debounce(() => {
    Object.keys(charts).forEach(k => {
      const c = charts[k];
      if (c && !c.isDisposed()) c.resize();
    });
  }, 200), { passive: true });
}

/* 创建或复用图表实例；事件绑定跟随创建，重建后不丢 */
function createChart(key, el, optionFactory, onClick) {
  if (typeof echarts === 'undefined' || !el) return null;
  if (charts[key] && !charts[key].isDisposed()) {
    if (optionFactory) charts[key].setOption(optionFactory(), true); // notMerge 整体换肤
    return charts[key];
  }
  const inst = echarts.init(el);
  charts[key] = inst;
  if (onClick) inst.on('click', onClick); // ★ 点击等交互事件随实例重建自动恢复
  bindGlobalChartResize();                // ★ 全局 resize 只注册一次
  if (optionFactory) inst.setOption(optionFactory());
  return inst;
}

function disposeAllCharts() {
  Object.keys(charts).forEach(k => {
    const c = charts[k];
    if (c && !c.isDisposed()) c.dispose();
  });
  for (const k in charts) delete charts[k];
}

function chartTheme() {
  const dark = document.documentElement.classList.contains('dark');
  return {
    textColor: dark ? '#a8c2d8' : '#40566d',
    splitLine: dark ? 'rgba(168,194,216,.16)' : 'rgba(2,95,140,.10)',
    tooltipBg: dark ? 'rgba(10,25,41,.92)' : '#ffffff',
    mapArea: dark ? 'rgba(14,165,233,.09)' : 'rgba(14,165,233,.11)',
    mapBorder: dark ? 'rgba(56,189,248,.45)' : 'rgba(2,132,199,.45)',
    emphasisArea: '#0ea5e9',
    selectArea: '#14b8a6',
    /* choropleth 单色相明度梯度：暗色从深海军蓝提亮，浅色从淡冰蓝加深 */
    ramp: dark
      ? ['#082f49', '#0c4a6e', '#075985', '#0284c7', '#0ea5e9', '#7dd3fc']
      : ['#e0f2fe', '#bae6fd', '#7dd3fc', '#38bdf8', '#0ea5e9', '#0369a1'],
  };
}

/* ---------------- 首屏：KPI + 粒子背景 ---------------- */
function renderKpis(kpis) {
  const wrap = document.getElementById('kpiStrip');
  wrap.innerHTML = (kpis || []).map(k => `
    <div class="kpi-item">
      <div class="kpi-label">${esc(k.label)}</div>
      <div class="kpi-value-row">
        <span class="kpi-value" data-target="${esc(k.value)}" data-dec="${Number(k.value) % 1 !== 0 ? 1 : 0}">0</span>
        <span class="kpi-unit">${esc(k.unit)}</span>
        ${k.delta ? `<span class="kpi-delta ${k.dir === 'down-good' ? 'delta-down-good' : 'delta-up'}">${esc(k.delta)}</span>` : ''}
      </div>
    </div>`).join('');
  wrap.querySelectorAll('.kpi-value').forEach(el =>
    countUp(el, parseFloat(el.dataset.target), parseInt(el.dataset.dec)));
}

function initBgCanvas() {
  const canvas = document.getElementById('bgCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, pts = [], rafId = 0, running = false;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    w = canvas.offsetWidth; h = canvas.offsetHeight;
    canvas.width = w * dpr; canvas.height = h * dpr; // HiDPI：物理分辨率放大
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);          // 逻辑坐标保持 CSS 像素
    pts = Array.from({ length: Math.min(70, w / 18) }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - .5) * .35, vy: (Math.random() - .5) * .35,
    }));
  }
  function drawGrid() {
    ctx.save();
    ctx.strokeStyle = 'rgba(14,165,233,.06)';
    ctx.lineWidth = 1;
    const step = Math.max(36, Math.floor(w / 38));
    for (let x = 0; x <= w; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y <= h; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.restore();
  }
  function frame() {
    ctx.clearRect(0, 0, w, h);
    drawGrid();
    for (const p of pts) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
    }
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
        const d = dx * dx + dy * dy;
        if (d < 130 * 130) {
          ctx.strokeStyle = `rgba(14,165,233,${(1 - d / 16900) * 0.16})`;
          ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke();
        }
      }
      ctx.fillStyle = 'rgba(20,184,166,.45)';
      ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, 1.8, 0, 7); ctx.fill();
    }
    if (running) rafId = requestAnimationFrame(frame);
  }
  resize();
  window.addEventListener('resize', debounce(resize, 250));
  if (REDUCED_MOTION) { running = false; frame(); return; } // 只画一帧
  /* hero 滚出视口即暂停粒子循环，回到视口自动恢复——后台不空烧 CPU */
  new IntersectionObserver(([en]) => {
    if (en.isIntersecting && !running) { running = true; rafId = requestAnimationFrame(frame); }
    else if (!en.isIntersecting && running) { running = false; cancelAnimationFrame(rafId); }
  }).observe(canvas);
}

/* ---------------- 市州冷链地图 ---------------- */
function cityNameOf(geoName) {
  // GeoJSON 中的「湘西土家族苗族自治州」等全名与数据表简称对齐
  if (geoName.indexOf('湘西') >= 0) return '湘西州';
  return geoName;
}

function cityByName(name) {
  if (!name) return undefined;
  // 先精确匹配，再退回前缀匹配——避免「岳阳市」误吞「岳阳楼区」类新条目
  return citiesData.find(c => c.name === name) ||
         citiesData.find(c => name.indexOf(c.name.replace('市', '')) === 0);
}

/* 由已注册 GeoJSON 反推「要素全称 → 数据简称」映射：
   团队替换 cities.json 后名称写法变化，地图仍能正确着色（ECharts nameMap 通道） */
function geoNameMap() {
  const map = {};
  if (typeof echarts === 'undefined' || !echarts.getMap) return map;
  const reg = echarts.getMap('hunan');
  if (!reg || !reg.geoJson || !reg.geoJson.features) return map;
  reg.geoJson.features.forEach(f => {
    const geoName = f.properties && f.properties.name;
    if (!geoName) return;
    const c = cityByName(cityNameOf(geoName));
    if (c && c.name !== geoName) map[geoName] = c.name;
  });
  return map;
}

function onMapClick(p) {
  const c = cityByName(cityNameOf(p.name));
  if (!c) return;
  if (mapLevel === 'province') {
    // 单击＝查看详情卡；下钻区县改由详情卡内按钮显式触发，
    // 避免「想看详情却被跳进区县视图」的失控感
    openCityDetail(c.id);
  }
}

function hunanMapOption() {
  const t = chartTheme();
  return {
    backgroundColor: 'transparent',
    tooltip: {
      backgroundColor: t.tooltipBg, textStyle: { color: t.textColor },
      formatter: p => {
        const c = cityByName(cityNameOf(p.name));
        if (!c) return esc(p.name);
        return `<b>${esc(c.name)}</b><br/>冷库容量：${esc(c.coldStorageWanTons)} 万吨位<br/>
                生鲜年产量：${esc(c.freshOutputWanTons)} 万吨<br/>
                冷藏车：${esc(c.coldVehicles)} 辆 · 流通率 ${esc(c.flowRate)}%<br/>
                主导品类：${esc((c.mainProducts || []).join('、'))}<br/>
                <span style="color:${t.textColor}">点击查看详情</span>`;
      },
    },
    visualMap: {
      type: 'continuous', min: 0,
      max: Math.max.apply(null, citiesData.map(c => Number(c.coldStorageWanTons) || 0).concat([1])),
      left: 18, bottom: 18, text: ['冷库容量高', '低'],
      calculable: true,
      inRange: { color: t.ramp },
      textStyle: { color: t.textColor, fontSize: 11 },
    },
    series: [{
      type: 'map', map: 'hunan', roam: true, zoom: 1.12,
      scaleLimit: { min: .7, max: 3 },
      selectedMode: 'single',
      nameMap: geoNameMap(), // ★ GeoJSON 全称 ↔ 数据简称 自动对齐，湘西州正常着色
      itemStyle: {
        areaColor: t.mapArea, borderColor: t.mapBorder, borderWidth: 1.1,
        shadowColor: 'rgba(14,165,233,.26)', shadowBlur: 14,
      },
      emphasis: {
        label: { show: true, color: t.textColor, fontSize: 11 },
        itemStyle: { areaColor: t.emphasisArea },
      },
      select: { label: { show: false }, itemStyle: { areaColor: t.selectArea } },
      data: citiesData.map(c => ({
        name: c.name, value: c.coldStorageWanTons,
        cid: c.id, tip: `${esc(c.freshOutputWanTons)} 万吨`,
      })),
    }],
  };
}

function storageRankOption() {
  const list = [...citiesData].sort((a, b) => a.coldStorageWanTons - b.coldStorageWanTons);
  const t = chartTheme();
  return {
    tooltip: {
      trigger: 'axis', backgroundColor: t.tooltipBg, textStyle: { color: t.textColor },
      formatter: p => `${esc(p.name)}<br/>冷库容量：<b>${esc(p.value)}</b> 万吨位`,
    },
    grid: { left: 64, right: 44, top: 8, bottom: 22 },
    xAxis: { type: 'value', axisLabel: { color: t.textColor }, splitLine: { lineStyle: { color: t.splitLine } } },
    yAxis: {
      type: 'category', data: list.map(c => c.name.replace('市', '').replace('土家族苗族自治州', '湘西')),
      axisLabel: { color: t.textColor, fontSize: 11 },
    },
    series: [{
      type: 'bar', barWidth: 12,
      data: list.map(c => c.coldStorageWanTons),
      itemStyle: {
        borderRadius: [0, 6, 6, 0],
        color: new echarts.graphic.LinearGradient(0, 0, 1, 0,
          [{ offset: 0, color: '#0ea5e9' }, { offset: 1, color: '#14b8a6' }]),
      },
      label: { show: true, position: 'right', color: t.textColor, fontSize: 11 },
    }],
  };
}

async function ensureAnalysis(skipFetch) {
  if (!analysisCache) {
    if (skipFetch) return; // 主题切换路径：缓存缺失就保持现状，不发网络请求
    try {
      analysisCache = await getJSON(API.analysis);
    } catch (e) {
      ['categoryPie', 'trendLine', 'flowBar'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<p class="error-state">洞察图表加载失败：' + esc(e.message) + '</p>';
      });
      return;
    }
  }
  renderAnalysisCharts(analysisCache);
}

async function initHunanMap(geoReady) {
  const mapEl = document.getElementById('hunanMap');
  if (typeof echarts === 'undefined' || !geoReady) {
    mapEl.innerHTML = '<p class="error-state" style="padding-top:180px">地图组件未能加载，请检查 assets/vendor/echarts.min.js 是否完整</p>';
    return;
  }
  try {
    createChart('hunanMap', mapEl, hunanMapOption, onMapClick);
    const rankEl = document.getElementById('storageRankChart');
    if (rankEl) createChart('storageRank', rankEl, storageRankOption);
    await ensureAnalysis(false);
  } catch (e) {
    mapEl.innerHTML =
      '<p class="error-state" style="padding-top:180px">地图加载失败：' + esc(e.message) + '</p>';
  }
}

/* ---------------- 县域下钻视图 ---------------- */

/* 区县视图：无冷链数据契约，用统一底色 + 名称标签呈现行政细节；
   悬停高亮沿用品牌色，视觉上仍是同一张地图的延续而非换引擎 */
function countyMapOption(c) {
  const t = chartTheme();
  const short = c.name.replace('市', '').replace('土家族苗族自治州', '州');
  return {
    backgroundColor: 'transparent',
    tooltip: {
      backgroundColor: t.tooltipBg, textStyle: { color: t.textColor },
      formatter: p => '<b>' + esc(p.name) + '</b> · ' + esc(short) + '（区县）',
    },
    series: [{
      type: 'map', map: 'county-' + c.id, roam: true,
      scaleLimit: { min: .6, max: 5 },
      label: { show: true, color: t.textColor, fontSize: 11 },
      labelLayout: { hideOverlap: true }, // 区县密集时自动隐藏重叠标签，保证可读
      itemStyle: { areaColor: t.mapArea, borderColor: t.mapBorder, borderWidth: 1 },
      emphasis: {
        label: { show: true, color: '#fff', fontSize: 11 },
        itemStyle: { areaColor: t.emphasisArea },
      },
      select: { label: { show: false }, itemStyle: { areaColor: t.selectArea } },
      data: [],
    }],
  };
}

async function drillToCounty(c) {
  const adcode = CITY_ADCODE[c.id];
  if (!adcode || typeof echarts === 'undefined' || !echarts.getMap('hunan')) return;
  const mapEl = document.getElementById('hunanMap');
  mapEl.innerHTML = '<div class="skeleton chart-skeleton"></div>'; // 区县边界在线首取可能耗时数秒，给明确加载态
  try {
    const gj = await getJSON(API.mapCounty + adcode + '_full.json');
    echarts.registerMap('county-' + c.id, gj);
    mapLevel = 'city';
    activeCountyCity = c;
    renderMapCrumb(true);
    createChart('hunanMap', mapEl, () => countyMapOption(c));
  } catch (e) {
    // 失败退回省域视图，不让用户停在骨架屏上
    createChart('hunanMap', mapEl, hunanMapOption, onMapClick);
    toast('县域地图加载失败（每个市州首次需联网）：' + e.message, true);
  }
}

function backToProvince() {
  mapLevel = 'province';
  activeCountyCity = null;
  renderMapCrumb();
  createChart('hunanMap', document.getElementById('hunanMap'), hunanMapOption, onMapClick);
}

function renderMapCrumb() {
  const back = document.getElementById('crumbBack');
  const now = document.getElementById('crumbNow');
  if (!back || !now) return;
  if (mapLevel === 'city' && activeCountyCity) {
    back.style.display = '';
    now.textContent = activeCountyCity.name + ' · 区县视图';
    now.setAttribute('aria-current', 'true');
  } else {
    back.style.display = 'none';
    now.textContent = '省域视图 · 点击市州下钻';
    now.removeAttribute('aria-current');
  }
}

/* ---------------- 市州详情卡片 ---------------- */
async function openCityDetail(cid) {
  const box = document.getElementById('cityDetailBody');
  box.innerHTML = '<p class="hint"><span class="loading-spinner"></span> 加载中…</p>';
  try {
    // 静态模式：从 citiesData 里找对应城市，组装成详情格式
    const city = citiesData.find(c => c.id === cid);
    if (!city) throw new Error('未找到该城市数据');
    // 按冷库容量排序算排名
    const sorted = [...citiesData].sort((a, b) => b.coldStorageWanTons - a.coldStorageWanTons);
    const rank = sorted.findIndex(c => c.id === cid) + 1;
    const d = {
      city: city,
      storageRank: rank,
      cityCount: citiesData.length,
      productBreakdown: city.productBreakdown || [],
      capacityTrend: city.capacityTrend || [],
      logisticsRoutes: city.logisticsRoutes || [],
    };
    renderCityDetail(d);
  } catch (e) {
    box.innerHTML = '<p class="error-state">详情加载失败：' + esc(e.message) + '</p>';
  }
}

function renderCityDetail(d) {
  const c = d.city;
  const box = document.getElementById('cityDetailBody');
  box.innerHTML = `
    <div class="cd-head">
      <span class="cd-name">${esc(c.name)}</span>
      <span class="tag tag-cyan">冷库容量第 ${esc(d.storageRank)}/${esc(d.cityCount)} 位</span>
    </div>
    <div class="res-grid">
      <div class="res-cell"><div class="rc-label">冷库容量</div>
        <div class="rc-value">${esc(c.coldStorageWanTons)}<small style="font-size:11px;color:var(--text-3)"> 万吨位</small></div></div>
      <div class="res-cell"><div class="rc-label">生鲜年产量</div>
        <div class="rc-value">${esc(c.freshOutputWanTons)}<small style="font-size:11px;color:var(--text-3)"> 万吨</small></div></div>
      <div class="res-cell"><div class="rc-label">冷藏车</div>
        <div class="rc-value">${esc(c.coldVehicles)}<small style="font-size:11px;color:var(--text-3)"> 辆</small></div></div>
      <div class="res-cell"><div class="rc-label">冷链流通率</div>
        <div class="rc-value">${esc(c.flowRate)}%</div></div>
    </div>
    <div class="cd-util">
      <div class="cd-util-label">冷库利用率（演示口径）<b>${esc(d.capacityUtilization)}%</b> · 占全省容量 ${esc(d.storageSharePct)}%</div>
      <div class="util-bar"><i style="width:${esc(d.capacityUtilization)}%"></i></div>
    </div>
    <div class="svc-chips">${(c.mainProducts || []).map(p => `<span class="svc-chip">${esc(p)}</span>`).join('')}</div>
    <p class="sim-note">${esc(d.note)}</p>
    <button type="button" class="btn btn-ghost btn-block" style="margin-top:12px" data-drill="${esc(c.id)}">🔍 下钻查看${esc(c.name.replace('市', '').replace('土家族苗族自治州', '州'))}区县</button>`;
}

/* ---------------- 数据洞察图表 ---------------- */
function renderAnalysisCharts(a) {
  const t = chartTheme();

  createChart('categoryPie', document.getElementById('categoryPie'), () => ({
    color: CHART_COLORS,
    title: { text: a.categoryShare.name, left: 'center', textStyle: { color: t.textColor, fontSize: 13.5 } },
    tooltip: { trigger: 'item', backgroundColor: t.tooltipBg, textStyle: { color: t.textColor }, formatter: '{b}: {c}%' },
    legend: { bottom: 0, textStyle: { color: t.textColor } },
    series: [{
      type: 'pie', radius: ['40%', '66%'], center: ['50%', '50%'],
      itemStyle: { borderRadius: 8, borderColor: t.tooltipBg, borderWidth: 2 },
      label: { color: t.textColor, fontSize: 11, formatter: '{b}\n{c}%' },
      data: a.categoryShare.data,
    }],
  }));

  createChart('trendLine', document.getElementById('trendLine'), () => ({
    color: ['#38bdf8', '#14b8a6'], // 损耗率退出琥珀——琥珀只留给断链预警
    title: { text: '月均气温 × 综合损耗率（夏季断链风险）', left: 'center', textStyle: { color: t.textColor, fontSize: 13.5 } },
    tooltip: { trigger: 'axis', backgroundColor: t.tooltipBg, textStyle: { color: t.textColor } },
    legend: { bottom: 0, textStyle: { color: t.textColor } },
    grid: { left: 42, right: 46, top: 44, bottom: 42 },
    xAxis: { type: 'category', data: a.monthlyTrend.months, axisLabel: { color: t.textColor }, boundaryGap: false },
    yAxis: [
      { type: 'value', name: '℃', axisLabel: { color: t.textColor }, splitLine: { lineStyle: { color: t.splitLine } } },
      { type: 'value', name: '%', min: 5, max: 12, axisLabel: { color: t.textColor }, splitLine: { show: false } },
    ],
    series: [
      { name: '月均气温(℃)', type: 'line', smooth: true, data: a.monthlyTrend.avgTempC, areaStyle: { opacity: .1 }, symbolSize: 5 },
      { name: '综合损耗率(%)', type: 'line', yAxisIndex: 1, smooth: true, data: a.monthlyTrend.lossRate, lineStyle: { width: 3 }, symbolSize: 6 },
    ],
  }));

  const fc = a.flowCompare;
  createChart('flowBar', document.getElementById('flowBar'), () => ({
    color: ['#0ea5e9'],
    tooltip: {
      trigger: 'axis', backgroundColor: t.tooltipBg, textStyle: { color: t.textColor },
      formatter: p => `${esc(p[0].name)}<br/>冷链流通率：<b>${esc(p[0].value)}%</b>${p[0].value < fc.provinceAvg ? '（低于全省均值）' : ''}`,
    },
    grid: { left: 44, right: 20, top: 26, bottom: 30 },
    xAxis: { type: 'category', data: fc.cities, axisLabel: { color: t.textColor, interval: 0, rotate: 32 } },
    yAxis: { type: 'value', max: 60, axisLabel: { color: t.textColor }, splitLine: { lineStyle: { color: t.splitLine } } },
    series: [{
      type: 'bar', barWidth: 18,
      data: fc.flowRates.map(v => ({ value: v, itemStyle: v < fc.provinceAvg ? { color: '#bae6fd', opacity: .8 } : {} })),
      itemStyle: { borderRadius: [7, 7, 0, 0] },
      markLine: {
        silent: true, symbol: 'none',
        lineStyle: { color: '#7b90a5', type: 'dashed' }, // 均值参考线是中性信息，不占用预警琥珀
        data: [{ yAxis: fc.provinceAvg, label: { formatter: '全省均值 ' + fc.provinceAvg + '%', color: '#7b90a5' } }],
      },
    }],
  }));
}

/* ---------------- 智能模拟 ---------------- */
function segVal(segId) {
  const active = document.querySelector(`#${segId} button.active`);
  return active ? active.dataset.v : undefined;
}

function bindSeg(segId) {
  document.querySelectorAll(`#${segId} button`).forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll(`#${segId} button`).forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-checked', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-checked', 'true');
    }));
}

function fillCitySelect(selId) {
  const sel = document.getElementById(selId);
  sel.innerHTML = citiesData.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
}

/* 按 id 显式选中，解除对数据条目顺序的依赖 */
function setSelectValue(selId, val) {
  const sel = document.getElementById(selId);
  if (sel && sel.querySelector(`option[value="${val}"]`)) sel.value = val;
}

function renderProductSeg(products) {
  const seg = document.getElementById('productSeg');
  seg.innerHTML = products.map((p, i) =>
    `<button type="button" role="radio" aria-checked="${i === products.length - 1}" data-v="${esc(p.key)}" title="${esc(p.tempZone)}" class="${i === products.length - 1 ? 'active' : ''}">${esc(p.label)}</button>`).join('');
  currentProduct = products[products.length - 1].key; // 默认果蔬类（占比最高）
  bindSeg('productSeg');
}

function resultGrid(items, extraHtml, note) {
  return `
    <div class="res-grid">${items.map(i => `
      <div class="res-cell"><div class="rc-label">${esc(i.label)}</div>
      <div class="rc-value">${esc(i.value)}<small style="font-size:11px;color:var(--text-3)"> ${esc(i.unit || '')}</small></div></div>`).join('')}
    </div>${extraHtml || ''}${note ? `<p class="sim-note">${esc(note)}</p>` : ''}`;
}

async function runSimulate() {
  const btn = document.getElementById('runSimulate');
  const box = document.getElementById('simResult');
  btn.disabled = true;
  box.innerHTML = '<p class="hint"><span class="loading-spinner"></span> 正在模拟冷链运输…</p>';
  try {
    // 静态模式：前端简单计算运输模拟
    const fromId = document.getElementById('simFrom').value;
    const toId = document.getElementById('simTo').value;
    const tons = parseInt(document.getElementById('simTons').value, 10) || 10;
    const fromCity = citiesData.find(c => c.id === fromId) || { name: '起点', lngLat: [111, 27] };
    const toCity = citiesData.find(c => c.id === toId) || { name: '终点', lngLat: [113, 28] };
    const productMap = { fruitveg: { label: '果蔬', tempZone: '0~4℃', rate: 0.05, costFactor: 1 }, meat: { label: '肉类', tempZone: '-18℃以下', rate: 0.03, costFactor: 1.5 }, aquatic: { label: '水产', tempZone: '-20℃', rate: 0.06, costFactor: 1.8 }, egg: { label: '禽蛋', tempZone: '0~5℃', rate: 0.02, costFactor: 0.8 }, milk: { label: '乳品', tempZone: '2~6℃', rate: 0.04, costFactor: 1.2 } };
    const p = productMap[currentProduct] || productMap.fruitveg;
    // 简单计算距离（经纬度近似）
    const dx = (toCity.lngLat?.[0] || 113) - (fromCity.lngLat?.[0] || 111);
    const dy = (toCity.lngLat?.[1] || 28) - (fromCity.lngLat?.[1] || 27);
    const distanceKm = Math.round(Math.sqrt(dx*dx + dy*dy) * 100);
    const estimatedHours = Math.round(distanceKm / 60 * 10) / 10;
    const costPerTon = Math.round(150 + distanceKm * 1.2 * p.costFactor);
    const costYuan = costPerTon * tons;
    const lossTons = Math.round(tons * p.rate * 100) / 100;
    const lossValueYuan = Math.round(lossTons * 8000);
    const co2Kg = Math.round(distanceKm * tons * 0.15);
    const tempPassRate = 95 - Math.round(estimatedHours * 0.3);
    const tempRiskPct = Math.max(5, 100 - tempPassRate);
    const res = {
      fromName: fromCity.name, toName: toCity.name,
      distanceKm, estimatedHours, costYuan, costPerTon,
      lossTons, lossValueYuan, co2Kg,
      tempPassRate, tempRiskPct,
      productLabel: p.label, tempZone: p.tempZone,
      note: '静态演示模式：基于距离和品类参数的简化估算',
      pathCoords: [fromCity.lngLat || [111, 27], toCity.lngLat || [113, 28]],
    };
    lastSimRes = res;
    const riskTag = res.tempRiskPct > 15
      ? '<span class="tag tag-warn">⚠ 断链风险偏高</span>'
      : '<span class="tag tag-green">✓ 温控达标率 ' + esc(res.tempPassRate) + '%</span>';
    box.innerHTML = resultGrid(
      [
        { label: '运输距离', value: res.distanceKm, unit: 'km' },
        { label: '预计时效', value: res.estimatedHours, unit: 'h' },
        { label: '总成本', value: res.costYuan, unit: '元' },
        { label: '单位成本', value: res.costPerTon, unit: '元/吨' },
        { label: '预估损耗', value: res.lossTons, unit: '吨' },
        { label: '碳排放', value: res.co2Kg, unit: 'kg' },
      ],
      `<div class="lifeline">
         <span class="lf-node">产地 · ${esc(res.fromName)}</span><span class="lf-arrow">❄</span>
         <span class="lf-node">冷库预冷</span><span class="lf-arrow">❄</span>
         <span class="lf-node${res.tempRiskPct > 15 ? ' lf-break' : ''}">干线运输 ${esc(res.estimatedHours)}h</span><span class="lf-arrow">❄</span>
         <span class="lf-node">销地 · ${esc(res.toName)}</span>
       </div>
       <div class="path-steps">
         <span class="tag tag-cyan">${esc(res.productLabel)} · ${esc(res.tempZone)}</span>
         ${riskTag}
       </div>`,
      `损耗货值约 ${esc(res.lossValueYuan)} 元 · ${res.note}`
    );
    drawRouteMap(res);
    lightUpPath(document.querySelectorAll('#simResult .lf-node'));
    toast('冷链模拟完成');
  } catch (e) {
    box.innerHTML = '<p class="error-state">模拟失败：' + esc(e.message) + '</p>';
  } finally { btn.disabled = false; }
}

function routeMapOption(res) {
  const t = chartTheme();
  return {
    backgroundColor: 'transparent',
    visualMap: { show: false },
    geo: {
      map: 'hunan', roam: true, zoom: 1.05,
      itemStyle: { areaColor: t.mapArea, borderColor: t.mapBorder, borderWidth: 1 },
      emphasis: { label: { show: false } },
    },
    series: [{
      type: 'lines', coordinateSystem: 'geo', zlevel: 2,
      effect: { show: true, period: 4, trailLength: .55, symbol: 'arrow', symbolSize: 8, color: '#38bdf8' },
      lineStyle: { color: '#14b8a6', width: 3, opacity: .75, curveness: .18 },
      data: [{ coords: res.pathCoords }],
    }, {
      type: 'effectScatter', coordinateSystem: 'geo', zlevel: 3,
      rippleEffect: { brushType: 'stroke', scale: 3 },
      symbolSize: 13, itemStyle: { color: '#0ea5e9' },
      data: res.pathCoords.map((c, i) => ({
        name: i === 0 ? res.fromName : res.toName,
        value: [c[0], c[1], i === 0 ? 80 : 60],
      })),
      label: {
        show: true, position: 'right', fontSize: 11, color: t.textColor,
        formatter: p => p.name,
      },
    }],
  };
}

function drawRouteMap(res) {
  if (typeof echarts === 'undefined' || !echarts.getMap('hunan')) return;
  const panel = document.getElementById('routeMapPanel');
  panel.style.display = '';
  document.getElementById('routePathName').textContent =
    `${res.fromName} ❄→ ${res.toName}`; // textContent 免转义
  createChart('routeMap', document.getElementById('routeMap'), () => routeMapOption(res));
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function runPredict() {
  const btn = document.getElementById('runPredict');
  const box = document.getElementById('predResult');
  btn.disabled = true;
  box.innerHTML = '<p class="hint"><span class="loading-spinner"></span> 模型推理中…</p>';
  try {
    // 静态模式：前端简单预测
    const cityId = document.getElementById('predCity').value;
    const seasonIdx = segVal('seasonSeg');
    const city = citiesData.find(c => c.id === cityId) || { name: '某市', freshOutputWanTons: 300 };
    const baseOutput = city.freshOutputWanTons || 300;
    const monthLabels = ['1月', '2月', '3月', '4月', '5月', '6月'];
    // 季节性因子：夏秋季高，冬春季低
    const seasonFactors = [0.85, 0.9, 1.0, 1.15, 1.25, 1.2];
    const startMonth = seasonIdx * 2;
    const predicted = monthLabels.map((_, i) => {
      const factor = seasonFactors[(startMonth + i) % 6] * (0.95 + Math.random() * 0.1);
      return Math.round(baseOutput / 12 * factor * 10) / 10;
    });
    const totalHalf = Math.round(predicted.reduce((a, b) => a + b, 0) * 10) / 10;
    const peakMonths = predicted.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v).slice(0, 2).map(o => monthLabels[o.i]);
    const recommendedVehicles = Math.round(totalHalf / 50);
    const res = {
      cityName: city.name,
      monthLabels,
      predictedMonthlyWanTons: predicted,
      totalHalfYearWanTons: totalHalf,
      peakMonths,
      recommendedVehicles,
      confidence: 0.82,
      note: '静态演示模式：基于产量基数和季节因子的简化趋势预测',
    };
    lastPredRes = res;
    const items = res.predictedMonthlyWanTons.slice(0, 3)
      .map((v, i) => ({ label: res.monthLabels[i] + '需求', value: v, unit: '万吨' }));
    items.push({ label: '半年总量', value: res.totalHalfYearWanTons, unit: '万吨' });
    box.innerHTML = resultGrid(items,
      `<div class="path-steps">
        <span class="tag tag-cyan">高峰期：${esc(res.peakMonths.join('、'))}</span>
        <span class="tag tag-green">建议冷藏车：${esc(res.recommendedVehicles)} 辆</span>
      </div>`,
      `${res.cityName} · 置信度 ${(res.confidence * 100).toFixed(0)}% · ${res.note}`);
    drawPredictChart(res);
    toast('需求预测完成');
  } catch (e) {
    box.innerHTML = '<p class="error-state">预测失败：' + esc(e.message) + '</p>';
  } finally { btn.disabled = false; }
}

function drawPredictChart(res) {
  let holder = document.getElementById('predChartBox');
  if (!holder) {
    holder = document.createElement('div');
    holder.id = 'predChartBox';
    holder.className = 'glass-panel reveal visible';
    holder.style.marginTop = '18px';
    holder.innerHTML = '<h4 class="card-title">半年冷链需求预测曲线 <span class="unit">(万吨/月)</span></h4><div id="predChart" class="chart"></div>';
    document.querySelector('.sim-grid').after(holder);
  }
  createChart('predChart', document.getElementById('predChart'), () => {
    const t = chartTheme();
    return {
      color: CHART_COLORS,
      tooltip: { trigger: 'axis', backgroundColor: t.tooltipBg, textStyle: { color: t.textColor } },
      grid: { left: 50, right: 24, top: 30, bottom: 34 },
      xAxis: { type: 'category', data: res.monthLabels, axisLabel: { color: t.textColor } },
      yAxis: { type: 'value', axisLabel: { color: t.textColor }, splitLine: { lineStyle: { color: t.splitLine } } },
      series: [{
        name: res.cityName, type: 'line', smooth: true, symbolSize: 8,
        data: res.predictedMonthlyWanTons,
        areaStyle: { opacity: .12 },
        lineStyle: { width: 3 },
      }],
    };
  });
}

/* ---------------- 多主体协同（打破「两张皮」的核心表达） ---------------- */

/* 四类主体：形状+色双编码，颜色取自品牌渐变的四个停靠点（青端=产地侧，蓝端=销地侧） */
const NODE_STYLE = {
  farmer:    { symbol: 'circle',    color: '#14b8a6', label: '农户合作社' },
  coldstore: { symbol: 'rect',      color: '#0d9488', label: '冷库节点' },
  carrier:   { symbol: 'triangle',  color: '#0ea5e9', label: '承运商' },
  market:    { symbol: 'diamond',   color: '#38bdf8', label: '销地市场' },
};

function cityCoordOf(cityId) {
  const c = citiesData.find(x => x.id === cityId);
  return c ? [c.lng, c.lat] : null;
}

function networkOption(net) {
  const t = chartTheme();
  const idx = {};
  net.nodes.forEach(n => { idx[n.id] = n; });
  const goods = [], infoOk = [], infoGap = [];
  net.links.forEach(l => {
    const a = idx[l.from], b = idx[l.to];
    if (!a || !b) return;
    const coords = [[a.lng, a.lat], [b.lng, b.lat]];
    if (l.kind === 'goods') goods.push({ coords });
    else if (l.linked === false) infoGap.push({ coords });
    else infoOk.push({ coords });
  });
  return {
    backgroundColor: 'transparent',
    legend: {
      top: 6, left: 'center',
      data: Object.keys(NODE_STYLE).map(k => NODE_STYLE[k].label),
      textStyle: { color: t.textColor },
    },
    tooltip: {
      backgroundColor: t.tooltipBg, textStyle: { color: t.textColor },
      formatter: p => {
        if (p.seriesType === 'scatter') return '<b>' + esc(p.name) + '</b>';
        if (p.seriesName === '货流') return '货流实线：冷链货物实际流通';
        if (p.seriesName === '信息流·已联通') return '信息流虚线：双方系统已互通';
        return '灰虚线＝信息断点：<b>这就是「两张皮」</b>';
      },
    },
    geo: {
      map: 'hunan', roam: true, zoom: 1.05,
      itemStyle: { areaColor: t.mapArea, borderColor: t.mapBorder, borderWidth: 1 },
      emphasis: { label: { show: false } },
    },
    series: [
      { name: '货流', type: 'lines', coordinateSystem: 'geo', zlevel: 2,
        lineStyle: { color: '#14b8a6', width: 2.5, opacity: .75, curveness: .15 },
        effect: { show: !REDUCED_MOTION, period: 4, trailLength: .5, symbol: 'arrow', symbolSize: 7, color: '#38bdf8' },
        data: goods },
      { name: '信息流·已联通', type: 'lines', coordinateSystem: 'geo', zlevel: 2,
        lineStyle: { color: '#38bdf8', width: 1.2, type: 'dashed', opacity: .55 }, data: infoOk },
      { name: '信息流·断点', type: 'lines', coordinateSystem: 'geo', zlevel: 2, silent: true,
        lineStyle: { color: '#94a3b8', width: 1.2, type: 'dashed', opacity: .45 }, data: infoGap },
    ].concat(Object.keys(NODE_STYLE).map(k => ({
      name: NODE_STYLE[k].label, type: 'scatter', coordinateSystem: 'geo', zlevel: 3,
      symbol: NODE_STYLE[k].symbol,
      symbolSize: d => 9 + Math.sqrt(Number(d[2]) || 1),
      itemStyle: { color: NODE_STYLE[k].color, opacity: .92 },
      data: net.nodes.filter(n => n.type === k)
        .map(n => ({ name: n.name, value: [n.lng, n.lat, n.scale] })),
    }))),
  };
}

/* 信息联通率 = 已联通信息链 / 全部信息链——「两张皮」的量化指标 */
function renderNetworkKpis() {
  if (!lastNetwork) return;
  const infos = lastNetwork.links.filter(l => l.kind === 'info');
  const linked = infos.filter(l => l.linked !== false).length;
  const pct = infos.length ? Math.round(linked / infos.length * 100) : 0;
  const ring = document.getElementById('linkRing');
  const num = document.getElementById('linkRingNum');
  const txt = document.getElementById('linkStatText');
  if (ring) ring.style.setProperty('--pct', String(pct));
  if (num) num.textContent = pct + '%';
  if (txt) {
    txt.textContent = '入网主体 ' + lastNetwork.nodes.length +
      ' 家 · 信息链 ' + linked + '/' + infos.length + ' 条已贯通';
  }
}

async function ensureNetwork() {
  const el = document.getElementById('networkMap');
  if (!el || typeof echarts === 'undefined' || !echarts.getMap('hunan')) return;
  if (!lastNetwork) {
    try { lastNetwork = await getJSON(API.network); }
    catch (e) {
      el.innerHTML = '<p class="error-state">协同网络加载失败：' + esc(e.message) + '</p>';
      return;
    }
  }
  createChart('networkMap', el, () => networkOption(lastNetwork));
  renderNetworkKpis();
}

/* ---------------- 实时预警事件流 ---------------- */

function startEventFeed() {
  if (!document.getElementById('eventList')) return;
  if (!eventVisBound) {
    eventVisBound = true;
    // 页面不可见即停轮询：演示机挂后台不空烧请求
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopEventPolling();
      else if (document.getElementById('eventList')) restartEventPolling();
    });
  }
  restartEventPolling();
}

function restartEventPolling() {
  stopEventPolling();
  pollEvents();
  eventTimer = setInterval(pollEvents, 30000);
}

function stopEventPolling() {
  if (eventTimer) clearInterval(eventTimer);
  eventTimer = 0;
}

async function pollEvents() {
  try {
    const d = await getJSON(API.events);
    lastEvents = d.events || [];
    renderEventFeed(lastEvents);
    renderEventMiniMap(lastEvents);
  } catch (e) { /* 静默降级：列表保留上次内容 */ }
}

function renderEventFeed(events) {
  const ul = document.getElementById('eventList');
  if (!ul) return;
  ul.innerHTML = events.map(ev =>
    '<li class="ev-item">' +
      '<span class="tag ' + (ev.severity === 'warn' ? 'tag-warn' : 'tag-cyan') + '">' +
        esc(String(ev.timeISO).slice(11, 16)) + '</span>' +
      '<div class="ev-body"><p class="ev-msg">' + esc(ev.message) + '</p>' +
      '<p class="ev-advice">▸ 处置建议：' + esc(ev.advice || '持续跟踪') + '</p></div>' +
    '</li>').join('');
  const cnt = document.getElementById('eventCount');
  if (cnt) {
    cnt.textContent = '近 24h 预警 ' + events.filter(e => e.severity === 'warn').length + ' 起';
  }
}

/* mini 地图：在预警事件的起讫市州中点打琥珀涟漪（REDUCED_MOTION 时静点） */
function renderEventMiniMap(events) {
  const el = document.getElementById('eventMiniMap');
  if (!el || typeof echarts === 'undefined' || !echarts.getMap('hunan')) return;
  const warns = events.filter(e => e.severity === 'warn');
  createChart('eventMap', el, () => {
    const t = chartTheme();
    const pts = [];
    warns.forEach(e => {
      const a = cityCoordOf(e.fromCityId), b = cityCoordOf(e.toCityId);
      if (a && b) {
        pts.push({
          name: e.message,
          value: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 60],
        });
      }
    });
    return {
      backgroundColor: 'transparent',
      tooltip: { backgroundColor: t.tooltipBg, textStyle: { color: t.textColor }, formatter: p => esc(p.name) },
      geo: {
        map: 'hunan', roam: false, zoom: 1.02,
        itemStyle: { areaColor: t.mapArea, borderColor: t.mapBorder, borderWidth: 1 },
        emphasis: { label: { show: false } },
      },
      series: [{
        type: 'effectScatter', coordinateSystem: 'geo', zlevel: 2,
        rippleEffect: { brushType: 'stroke', scale: 3.2 },
        symbolSize: 11, itemStyle: { color: '#f59e0b' }, // 琥珀只出现在预警语义
        data: pts,
      }],
    };
  });
}

/* ---------------- 冷链生命线点亮序列（模拟结果的叙事收尾） ---------------- */

function lightUpPath(nodes) {
  nodes.forEach((el, i) => {
    if (REDUCED_MOTION) el.classList.add('lit');
    else setTimeout(() => el.classList.add('lit'), 350 * i);
  });
}

/* ---------------- 可共享资源池（冷库余容 / 闲置运力 / 参考运价） ---------------- */

const RES_TYPE_LABEL = { coldstore: '冷库', carrier: '承运商', farmer: '农户', market: '销地市场' };
const RES_TYPE_COLOR = { coldstore: '#0d9488', carrier: '#0ea5e9', farmer: '#14b8a6', market: '#38bdf8' };

async function loadResources() {
  if (!document.getElementById('resRows')) return;
  if (!lastResources) {
    try { lastResources = await getJSON(API.resources); }
    catch (e) {
      document.getElementById('resSummary').textContent = '资源池加载失败：' + e.message;
      return;
    }
  }
  const sel = document.getElementById('resCity');
  if (sel && !sel.options.length) {
    sel.innerHTML = '<option value="">全部市州</option>' +
      citiesData.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    sel.value = resFilter;
    sel.addEventListener('change', () => {
      resFilter = sel.value;
      renderResourceTable();
    });
  }
  renderResourceTable();
}

function resourceCapacityCell(r) {
  if (r.type === 'coldstore') {
    const free = Math.max(0, +(r.capacityWanTons - r.usedWanTons).toFixed(1));
    return '剩余容量 <b>' + esc(free) + '</b> / ' + esc(r.capacityWanTons) + ' 万吨位';
  }
  if (r.type === 'carrier') return '可用冷藏车 <b>' + esc(r.vehiclesIdle) + '</b> / ' + esc(r.vehiclesTotal) + ' 辆';
  if (r.type === 'farmer') return '当季可供 <b>' + esc(r.seasonalSupplyTons) + '</b> 吨（' + esc(r.product || '') + '）';
  return '日吞吐 <b>' + esc(r.dailyThroughputTons) + '</b> 吨';
}

function resourcePriceCell(r) {
  if (r.type === 'coldstore') return esc(r.priceYuanPerTonDay) + ' 元/吨·天';
  if (r.type === 'carrier') return esc(r.ratePerTonKm) + ' 元/吨·km';
  return '—';
}

function renderResourceTable() {
  const rowsEl = document.getElementById('resRows');
  if (!rowsEl || !lastResources) return;
  const list = lastResources.resources.filter(r => !resFilter || r.cityId === resFilter);
  rowsEl.innerHTML = list.map(r => {
    const cityName = (citiesData.find(c => c.id === r.cityId) || {}).name || r.cityId;
    const color = RES_TYPE_COLOR[r.type] || '#94a3b8';
    return '<tr>' +
      '<td>' + esc(r.name) + '</td>' +
      '<td><span class="ent-tag" style="border-color:' + color + ';color:' + color + '">' +
        esc(RES_TYPE_LABEL[r.type] || r.type) + '</span></td>' +
      '<td>' + esc(cityName) + '</td>' +
      '<td>' + resourceCapacityCell(r) + '</td>' +
      '<td>' + resourcePriceCell(r) + '</td>' +
      '<td class="res-updated">' + esc(lastResources.updatedAt || '') + '</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="6"><p class="hint">该市州暂无挂牌资源</p></td></tr>';

  const cs = lastResources.resources.filter(r => r.type === 'coldstore');
  const carr = lastResources.resources.filter(r => r.type === 'carrier');
  const freeSum = cs.reduce((s, r) => s + Math.max(0, r.capacityWanTons - r.usedWanTons), 0);
  const idleSum = carr.reduce((s, r) => s + (r.vehiclesIdle || 0), 0);
  const sum = document.getElementById('resSummary');
  if (sum) {
    sum.innerHTML = '全省挂牌：冷库剩余容量合计 <b>' + esc(Math.round(freeSum * 10) / 10) +
      ' 万吨位</b> · 可用冷藏车合计 <b>' + esc(idleSum) + ' 辆</b> · 挂牌主体 <b>' +
      lastResources.resources.length + ' 家</b>（更新于 ' + esc(lastResources.updatedAt || '--') + '）';
  }
}

/* ---------------- 明暗主题切换（dispose 后按最近状态整体重建，零网络请求） ---------------- */
function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  try { localStorage.setItem('xlzj-theme', dark ? 'dark' : 'light'); }
  catch (e) { /* 存储被禁时跳过持久化，切换流程继续 */ }
  disposeAllCharts();
  rebuildCharts();
}

function rebuildCharts() {
  if (!citiesData.length || typeof echarts === 'undefined') return;
  const mapEl = document.getElementById('hunanMap');
  if (mapEl && !mapEl.querySelector('.error-state')) {
    // 主题切换按当前层级重建：省域 choropleth 或 区县视图
    if (mapLevel === 'city' && activeCountyCity &&
        echarts.getMap('county-' + activeCountyCity.id)) {
      createChart('hunanMap', mapEl, () => countyMapOption(activeCountyCity));
    } else {
      createChart('hunanMap', mapEl, hunanMapOption, onMapClick); // click 事件随实例重建
    }
  }
  const rankEl = document.getElementById('storageRankChart');
  if (rankEl && !rankEl.querySelector('.error-state')) {
    createChart('storageRank', rankEl, storageRankOption);
  }
  if (analysisCache) renderAnalysisCharts(analysisCache);
  if (lastNetwork && document.getElementById('networkMap') &&
      typeof echarts !== 'undefined' && echarts.getMap('hunan')) {
    createChart('networkMap', document.getElementById('networkMap'), () => networkOption(lastNetwork));
    renderNetworkKpis();
  }
  if (lastEvents.length && document.getElementById('eventMiniMap')) {
    renderEventMiniMap(lastEvents);
  }
  if (lastSimRes) drawRouteMap(lastSimRes);   // 结果图随最近数据复活，不再留白板
  if (lastPredRes) drawPredictChart(lastPredRes);
}

/* ---------------- 滚动显现 & 导航高亮 ---------------- */
function setupScrollFx() {
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        en.target.classList.add('visible');
        io.unobserve(en.target); // 已显现的元素不再重复观察
      }
    });
  }, { threshold: .1 });
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));

  const secs = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-links a');
  window.addEventListener('scroll', debounce(() => {
    let cur = '';
    secs.forEach(s => { if (scrollY >= s.offsetTop - 140) cur = s.id; });
    navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + cur));
  }, 80), { passive: true });
}

/* ---------------- 启动 ---------------- */
document.addEventListener('DOMContentLoaded', async () => {
  // 保险丝：无论后续接口是否卡住，加载层最多 4 秒强制关闭，页面永不无限转圈
  setTimeout(hidePageLoader, 4000);

  // 最先点亮内容：滚动显现必须在任何可能失败的逻辑之前绑定，否则内容保持透明
  try { setupScrollFx(); } catch (e) {
    // 兜底：观察器失败就直接显示全部内容
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
  }
  setupScrollProgress();

  // 主题初始化：优先用户上次选择，首次访问跟随系统偏好
  try {
    let stored = null;
    try { stored = localStorage.getItem('xlzj-theme'); } catch (e) { /* 存储被禁 */ }
    const preferDark = stored
      ? stored === 'dark'
      : (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', !!preferDark);
    document.getElementById('themeToggle').addEventListener('click', () =>
      applyTheme(!document.documentElement.classList.contains('dark')));
  } catch (e) { /* 非致命 */ }

  try { initBgCanvas(); } catch (e) { /* 背景动画失败不影响功能 */ }
  try { bindRipple(); } catch (e) { /* 非致命 */ }

  try {
    // 面包屑「返回全省」+ 详情卡「下钻」按钮（均为事件委托）
    document.getElementById('mapCrumb').addEventListener('click', e => {
      if (e.target.closest('[data-back]')) backToProvince();
    });
    document.getElementById('cityDetailBody').addEventListener('click', e => {
      const btn = e.target.closest('[data-drill]');
      if (!btn) return;
      const c = citiesData.find(x => x.id === btn.getAttribute('data-drill'));
      if (c && mapLevel === 'province') drillToCounty(c);
    });
  } catch (e) { /* 非致命 */ }

  try {
    bindSeg('seasonSeg');
    document.getElementById('simTons').addEventListener('input', e =>
      document.getElementById('tonsVal').textContent = e.target.value);
    document.getElementById('runSimulate').addEventListener('click', runSimulate);
    document.getElementById('runPredict').addEventListener('click', runPredict);
  } catch (e) { toast('模拟器初始化失败：' + e.message, true); }

  // 五个首屏请求互不依赖，一把并发——任一块失败不再拖慢其余块
  const [ovR, baseR, geoR] = await Promise.allSettled([
    getJSON(API.overview),
    Promise.all([getJSON(API.cities), getJSON(API.products)]),
    (typeof echarts !== 'undefined')
      ? getJSON(API.mapGeo).then(gj => { echarts.registerMap('hunan', gj); })
      : Promise.reject(new Error('echarts 未加载')),
  ]);

  if (ovR.status === 'fulfilled') {
    try {
      const overview = ovR.value;
      renderKpis(overview.kpis);
      document.getElementById('heroDesc').textContent = overview.description;
      const upd = document.getElementById('footUpdated');
      if (upd && overview.updated) upd.textContent = '· 数据版本 ' + overview.updated;
    } catch (e) { toast('总览渲染失败：' + e.message, true); }
  } else {
    const strip = document.getElementById('kpiStrip');
    if (strip) strip.innerHTML = '<p class="error-state">总览数据加载失败：' + esc(ovR.reason && ovR.reason.message || '') + '</p>';
    toast('总览数据加载失败：' + (ovR.reason && ovR.reason.message || ''), true);
  }

  if (baseR.status === 'fulfilled') {
    try {
      const [citiesRes, productsRes] = baseR.value;
      citiesData = citiesRes.cities;
      renderProductSeg(productsRes.products);
      fillCitySelect('simFrom');
      fillCitySelect('simTo');
      setSelectValue('simTo', DEFAULT_TO_CITY_ID); // 长沙→岳阳 示范线路按 id 选定
      fillCitySelect('predCity');
    } catch (e) { toast('基础数据渲染失败：' + e.message, true); }
  } else {
    toast('基础数据加载失败：' + (baseR.reason && baseR.reason.message || ''), true);
  }

  await initHunanMap(geoR.status === 'fulfilled');

  try { await ensureNetwork(); } catch (e) { /* 协同板块失败不阻断主流程 */ }
  try { await loadResources(); } catch (e) { /* 资源池失败不阻断主流程 */ }
  startEventFeed();

  hidePageLoader();
});
