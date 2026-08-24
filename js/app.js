/* ============================================================
   湘链智图 · 前端交互逻辑
   数据源：同源后端 /api/*（零依赖 Python 服务）
   ============================================================ */
'use strict';

const API = {
  overview: '/api/overview',
  nodes: '/api/nodes',
  routes: '/api/routes',
  industry: '/api/perspectives/industry',
  logistics: '/api/perspectives/logistics',
  sales: '/api/perspectives/sales',
  optimize: '/api/optimize-route',
  predict: '/api/predict-demand',
  mapGeo: '/assets/hunan.json',
};

const CHART_COLORS = ['#10b981', '#06b6d4', '#34d399', '#0ea5e9', '#f59e0b'];
const TYPE_META = {
  hub:    { label: '物流枢纽',   color: '#10b981', size: 17 },
  city:   { label: '城市配送中心', color: '#06b6d4', size: 12 },
  county: { label: '县域服务站',  color: '#f59e0b', size: 8 },
};

/* ---------------- 工具函数 ---------------- */
async function getJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
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
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' err' : '');
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2600);
}

function countUp(el, target, decimals) {
  const dur = 1100, start = performance.now();
  function tick(now) {
    const p = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = (target * eased).toFixed(decimals || 0);
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function makeChart(el) {
  const inst = echarts.init(el);
  window.addEventListener('resize', debounce(() => inst.resize(), 200));
  return inst;
}

function chartTheme() {
  const dark = document.documentElement.classList.contains('dark');
  return {
    textColor: dark ? '#9dbfb2' : '#48645a',
    splitLine: dark ? 'rgba(157,191,178,.15)' : 'rgba(6,95,70,.1)',
    tooltipBg: dark ? 'rgba(13,32,26,.92)' : '#ffffff',
    mapArea: dark ? 'rgba(16,185,129,.08)' : 'rgba(16,185,129,.14)',
    mapBorder: dark ? 'rgba(52,211,153,.5)' : 'rgba(5,150,105,.45)',
  };
}

const charts = {}; // 全局图表实例登记

/* ---------------- 首屏：KPI + 粒子背景 ---------------- */
function renderKpis(kpis) {
  const wrap = document.getElementById('kpiStrip');
  wrap.innerHTML = kpis.map((k, i) => `
    <div class="kpi-item">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value-row">
        <span class="kpi-value" data-target="${k.value}" data-dec="${k.value % 1 !== 0 ? 1 : 0}">0</span>
        <span class="kpi-unit">${k.unit}</span>
        ${k.delta ? `<span class="kpi-delta ${k.dir === 'down-good' ? 'delta-down-good' : 'delta-up'}">${k.delta}</span>` : ''}
      </div>
    </div>`).join('');
  wrap.querySelectorAll('.kpi-value').forEach(el => countUp(el, parseFloat(el.dataset.target), parseInt(el.dataset.dec)));
}

function initBgCanvas() {
  const canvas = document.getElementById('bgCanvas');
  const ctx = canvas.getContext('2d');
  let w, h, pts = [], rafId;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function resize() {
    w = canvas.width = canvas.offsetWidth;
    h = canvas.height = canvas.offsetHeight;
    pts = Array.from({ length: Math.min(70, w / 18) }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - .5) * .35, vy: (Math.random() - .5) * .35,
    }));
  }
  function frame() {
    ctx.clearRect(0, 0, w, h);
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
          ctx.strokeStyle = `rgba(16,185,129,${(1 - d / 16900) * 0.16})`;
          ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke();
        }
      }
      ctx.fillStyle = 'rgba(6,182,212,.4)';
      ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, 1.6, 0, 7); ctx.fill();
    }
    rafId = requestAnimationFrame(frame);
  }
  resize();
  window.addEventListener('resize', debounce(resize, 250));
  if (!reduced) frame();
  else frame(), cancelAnimationFrame(rafId); // 只画一帧
}

/* ---------------- 三端视角 ---------------- */
let currentPersp = 'industry';
const perspCache = {};

function renderPersp(key, data) {
  document.getElementById('perspTitle').textContent = data.title;
  document.getElementById('perspSubtitle').textContent = data.subtitle;
  document.getElementById('perspIntro').textContent = data.intro;

  document.getElementById('perspCards').innerHTML = (data.cards || []).map(c => `
    <div class="mini-card">
      <div class="mc-label">${c.label}</div>
      <div class="mc-row">
        <span class="mc-value">${c.value}</span><span class="mc-unit">${c.unit || ''}</span>
        ${c.delta ? `<span class="mc-delta">${c.delta}</span>` : ''}
      </div>
    </div>`).join('');

  const body = document.getElementById('perspBody');
  if (key === 'industry') renderIndustryBody(body, data);
  else if (key === 'logistics') renderLogisticsBody(body, data);
  else renderSalesBody(body, data);
  lucideSafe();
}

function lucideSafe() {} // 预留图标钩子

function renderIndustryBody(el, d) {
  el.innerHTML = `
    <div class="cluster-grid">
      ${d.clusters.map(c => `
        <div class="cluster-card">
          <div class="cc-head"><b>${c.name}</b><span class="cc-share">占比 ${c.share}%</span></div>
          <div class="cc-examples">${c.examples}</div>
          <ul class="cc-list cc-pain">${c.painPoints.map(p => `<li>${p}</li>`).join('')}</ul>
          <ul class="cc-list cc-sol">${c.solutions.map(s => `<li>${s}</li>`).join('')}</ul>
          <div class="cc-kpis">${Object.entries(c.kpis).map(([k, v]) => `<span>${KPI_LABEL[k] || k} <b>${v}</b></span>`).join('')}</div>
        </div>`).join('')}
    </div>
    <div class="dual-chart-grid">
      <div id="industryPie" class="chart"></div>
      <div id="industryLine" class="chart"></div>
    </div>`;
  const t = chartTheme();
  charts.industryPie = makeChart(document.getElementById('industryPie'));
  charts.industryPie.setOption({
    color: CHART_COLORS,
    title: { text: d.charts.sharePie.name, left: 'center', textStyle: { color: t.textColor, fontSize: 14 } },
    tooltip: { trigger: 'item', backgroundColor: t.tooltipBg, textStyle: { color: t.textColor } },
    legend: { bottom: 0, textStyle: { color: t.textColor } },
    series: [{
      type: 'pie', radius: ['42%', '68%'], center: ['50%', '52%'],
      itemStyle: { borderRadius: 8, borderColor: t.tooltipBg, borderWidth: 2 },
      label: { color: t.textColor }, data: d.charts.sharePie.data,
    }],
  });
  charts.industryLine = makeChart(document.getElementById('industryLine'));
  charts.industryLine.setOption(lineOption(d.charts.demandIndex, t));
}

const KPI_LABEL = {
  logisticsCostRatio: '物流成本占比(%)', onTimeRate: '准时率(%)',
  coldChainCoverage: '冷链覆盖率(%)', lossRate: '损耗率(%)',
  distributionLevels: '分销层级', peakCapacityUtil: '旺季运力利用(%)',
};

function lineOption(cfg, t) {
  return {
    color: CHART_COLORS,
    title: { text: cfg.name, left: 'center', textStyle: { color: t.textColor, fontSize: 14 } },
    tooltip: { trigger: 'axis', backgroundColor: t.tooltipBg, textStyle: { color: t.textColor } },
    legend: { bottom: 0, textStyle: { color: t.textColor } },
    grid: { left: 46, right: 20, top: 42, bottom: 40 },
    xAxis: { type: 'category', data: cfg.months, axisLabel: { color: t.textColor }, boundaryGap: false },
    yAxis: { type: 'value', axisLabel: { color: t.textColor }, splitLine: { lineStyle: { color: t.splitLine } } },
    series: cfg.series.map(s => ({
      name: s.name, type: 'line', smooth: true, data: s.data,
      areaStyle: { opacity: .08 }, symbolSize: 6,
    })),
  };
}

function renderLogisticsBody(el, d) {
  el.innerHTML = `
    <h4 class="card-title">三级网络体系</h4>
    <div class="level-flow">
      ${d.levels.map(l => `
        <div class="level-box">
          <h5>${l.level}</h5><div class="level-desc">${l.desc}</div>
          <div class="level-nodes">${l.nodes.map(n => `<span class="node-chip">${n}</span>`).join('')}</div>
        </div>`).join('')}
    </div>
    <div class="dual-chart-grid">
      <div id="corridorBar" class="chart"></div>
      <div id="fleetBar" class="chart"></div>
    </div>`;
  const t = chartTheme();
  charts.corridorBar = makeChart(document.getElementById('corridorBar'));
  charts.corridorBar.setOption({
    color: [CHART_COLORS[0], CHART_COLORS[1]],
    title: { text: '走廊成本与满载率对比', left: 'center', textStyle: { color: t.textColor, fontSize: 14 } },
    tooltip: { trigger: 'axis', backgroundColor: t.tooltipBg, textStyle: { color: t.textColor } },
    legend: { bottom: 0, textStyle: { color: t.textColor } },
    grid: { left: 46, right: 46, top: 42, bottom: 44 },
    xAxis: { type: 'category', data: d.charts.corridorCost.names, axisLabel: { color: t.textColor, interval: 0, rotate: 22 } },
    yAxis: [
      { type: 'value', name: '元/吨公里', axisLabel: { color: t.textColor }, splitLine: { lineStyle: { color: t.splitLine } } },
      { type: 'value', name: '%', max: 100, axisLabel: { color: t.textColor }, splitLine: { show: false } },
    ],
    series: [
      { name: '成本(元/吨公里)', type: 'bar', barWidth: 16, data: d.charts.corridorCost.costPerTonKm, itemStyle: { borderRadius: [6, 6, 0, 0] } },
      { name: '满载率(%)', type: 'line', yAxisIndex: 1, smooth: true, data: d.charts.corridorCost.loadFactor },
    ],
  });
  charts.fleetBar = makeChart(document.getElementById('fleetBar'));
  charts.fleetBar.setOption({
    title: { text: '车队规模与利用率', left: 'center', textStyle: { color: t.textColor, fontSize: 14 } },
    tooltip: Object.assign({ backgroundColor: t.tooltipBg, textStyle: { color: t.textColor } }),
    grid: { left: 90, right: 36, top: 42, bottom: 24 },
    xAxis: { type: 'value', axisLabel: { color: t.textColor }, splitLine: { lineStyle: { color: t.splitLine } } },
    yAxis: { type: 'category', data: d.charts.fleetUsage.names, axisLabel: { color: t.textColor } },
    series: [{
      type: 'bar', data: d.fleet.map(f => ({ value: f.count, usage: f.usage })),
      barWidth: 14, itemStyle: { borderRadius: [0, 6, 6, 0], color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: '#06b6d4' }, { offset: 1, color: '#10b981' }]) },
      label: { show: true, position: 'right', formatter: p => `${p.value} 辆 · 利用率${p.data.usage}%`, color: t.textColor, fontSize: 11 },
    }],
  });
}

function renderSalesBody(el, d) {
  el.innerHTML = `
    <div class="dual-chart-grid" style="margin-top:0">
      <div id="salesPie" class="chart"></div>
      <div id="salesLine" class="chart"></div>
    </div>
    <h4 class="card-title" style="margin-top:18px">履约时效承诺（SLA）</h4>
    <table class="sla-table">
      <thead><tr><th>层级</th><th>时效目标</th><th>实际达成</th></tr></thead>
      <tbody>${d.orderProfile.sla.map(s => `
        <tr><td>${s.tier}</td><td>${s.target}</td><td><span class="tag tag-green">${s.actual}</span></td></tr>`).join('')}
      </tbody>
    </table>
    <div class="svc-chips">${d.consumerServices.map(s => `<span class="svc-chip">${s}</span>`).join('')}</div>`;
  const t = chartTheme();
  charts.salesPie = makeChart(document.getElementById('salesPie'));
  charts.salesPie.setOption({
    color: [...CHART_COLORS, '#f97316'],
    title: { text: d.charts.channelShare.name, left: 'center', textStyle: { color: t.textColor, fontSize: 14 } },
    tooltip: { trigger: 'item', formatter: '{b}: {c}% ', backgroundColor: t.tooltipBg, textStyle: { color: t.textColor } },
    legend: { bottom: 0, textStyle: { color: t.textColor } },
    series: [{
      type: 'pie', roseType: 'radius', radius: ['18%', '62%'], center: ['50%', '50%'],
      itemStyle: { borderRadius: 6 }, label: { color: t.textColor, fontSize: 11 },
      data: d.charts.channelShare.data,
    }],
  });
  charts.salesLine = makeChart(document.getElementById('salesLine'));
  charts.salesLine.setOption(lineOption(d.charts.monthlyFlow, t));
}

function switchPersp(key) {
  currentPersp = key;
  document.querySelectorAll('.persp-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.persp === key));
  const panel = document.getElementById('perspPanel');
  panel.style.animation = 'none'; void panel.offsetWidth; panel.style.animation = '';

  if (perspCache[key]) { renderPersp(key, perspCache[key]); return; }
  document.getElementById('perspBody').innerHTML =
    '<p style="text-align:center;color:var(--text-3);padding:30px"><span class="loading-spinner"></span>&nbsp; 加载中…</p>';
  getJSON(API[key]).then(data => {
    perspCache[key] = data;
    renderPersp(key, data);
  }).catch(e => {
    document.getElementById('perspBody').innerHTML =
      `<p class="error-state">加载失败：${e.message}</p>`;
    toast('三端数据加载失败', true);
  });
}

/* ---------------- 地图：湖南全省网络 ---------------- */
let nodesData = [], routesData = [];

function nodeValue(n) { return Math.max(n.throughput / 2600, 0.12) * 100; }

function buildMapSeries(nodes, routes, filter) {
  const filtered = filter === 'all' ? nodes : nodes.filter(n => n.type === filter);
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  const lines = routes
    .filter(r => r.level === 'trunk')
    .map(r => ({
      coords: r.stops.filter(id => byId[id]).map(id => [byId[id].lng, byId[id].lat]),
      value: r.volumeTons, name: r.name,
    }));
  return [
    {
      type: 'lines', coordinateSystem: 'geo', zlevel: 2,
      effect: { show: true, period: 5, trailLength: .55, symbol: 'arrow', symbolSize: 7, color: '#34d399' },
      lineStyle: { color: '#06b6d4', width: 1.6, opacity: .35, curveness: .25 },
      data: lines,
    },
    ...['hub', 'city', 'county'].map(type => {
      if (filter !== 'all' && filter !== type) return null;
      return {
        name: type, type: 'effectScatter', coordinateSystem: 'geo', zlevel: 3,
        rippleEffect: { brushType: 'stroke', scale: 2.6 },
        symbolSize: val => TYPE_META[type].size * (val[2] / 100) ** .5 + (type === 'hub' ? 6 : 2),
        itemStyle: { color: TYPE_META[type].color, shadowBlur: 12, shadowColor: TYPE_META[type].color },
        label: {
          show: type === 'hub', position: 'right', fontSize: 10.5,
          color: chartTheme().textColor, formatter: p => p.name,
        },
        data: filtered.filter(n => n.type === type)
          .map(n => ({ name: n.name, city: n.city, throughput: n.throughput, nid: n.id, industries: n.industries, value: [n.lng, n.lat, nodeValue(n)] })),
      };
    }).filter(Boolean),
  ];
}

function hunanMapOption(nodes, routes, filter) {
  const t = chartTheme();
  return {
    backgroundColor: 'transparent',
    tooltip: {
      backgroundColor: t.tooltipBg, textStyle: { color: t.textColor },
      formatter: p => {
        if (!p.data || !p.data.throughput) return p.name;
        return `<b>${p.name}</b><br/>类型：${TYPE_META[p.seriesName] ? TYPE_META[p.seriesName].label : ''}<br/>
                城市：${p.data.city}<br/>年吞吐：${p.data.throughput} 万吨<br/>
                产业：${(p.data.industries || []).join('、')}`;
      },
    },
    geo: {
      map: 'hunan', roam: true, zoom: 1.12, scaleLimit: { min: .7, max: 3 },
      itemStyle: {
        areaColor: t.mapArea, borderColor: t.mapBorder, borderWidth: 1.2,
        shadowColor: 'rgba(6,182,212,.35)', shadowBlur: 16,
      },
      emphasis: {
        label: { show: false },
        itemStyle: { areaColor: 'rgba(16,185,129,.32)' },
      },
    },
    series: buildMapSeries(nodes, routes, filter),
  };
}

async function initHunanMap() {
  try {
    const geojson = await getJSON(API.mapGeo);
    echarts.registerMap('hunan', geojson);
    const [, nodesRes, routesRes] = await Promise.all([
      Promise.resolve(),
      getJSON(API.nodes), getJSON(API.routes),
    ]);
    nodesData = nodesRes.nodes;
    routesData = routesRes.routes;

    charts.hunanMap = makeChart(document.getElementById('hunanMap'));
    charts.hunanMap.on('click', p => {
      if (p.data && p.data.nid) {
        toast(`${p.name} · 年吞吐 ${p.data.throughput} 万吨`);
      }
    });
    charts.hunanMap.setOption(hunanMapOption(nodesData, routesData, 'all'));

    renderCorridorChart(routesData);
    renderNodeTypeStats(nodesData);
    renderRouteTable(routesData, nodesData);
  } catch (e) {
    document.getElementById('hunanMap').innerHTML =
      `<p class="error-state" style="padding-top:180px">地图加载失败：${e.message}</p>`;
  }
}

function refreshMapFilter(filter) {
  if (!charts.hunanMap) return;
  charts.hunanMap.setOption(hunanMapOption(nodesData, routesData, filter));
}

function renderCorridorChart(routes) {
  const list = routes.filter(r => r.level === 'trunk')
    .sort((a, b) => a.volumeTons - b.volumeTons);
  const t = chartTheme();
  charts.corridorRank = makeChart(document.getElementById('corridorChart'));
  charts.corridorRank.setOption({
    tooltip: { trigger: 'axis', backgroundColor: t.tooltipBg, textStyle: { color: t.textColor } },
    grid: { left: 108, right: 42, top: 12, bottom: 26 },
    xAxis: { type: 'value', axisLabel: { color: t.textColor }, splitLine: { lineStyle: { color: t.splitLine } } },
    yAxis: {
      type: 'category', data: list.map(r => r.name.replace(/（.*）/, '')),
      axisLabel: { color: t.textColor, fontSize: 11 },
    },
    series: [{
      type: 'bar', barWidth: 13,
      data: list.map(r => r.volumeTons),
      itemStyle: {
        borderRadius: [0, 7, 7, 0],
        color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: '#06b6d4' }, { offset: 1, color: '#10b981' }]),
      },
      label: { show: true, position: 'right', color: t.textColor, fontSize: 11 },
    }],
  });
}

function renderNodeTypeStats(nodes) {
  const counts = {};
  nodes.forEach(n => counts[n.type] = (counts[n.type] || 0) + 1);
  document.getElementById('nodeTypeList').innerHTML = Object.entries(TYPE_META)
    .map(([type, meta]) => `
      <li><span class="nt-dot" style="background:${meta.color}"></span>${meta.label}
        <span class="nt-count">${counts[type] || 0} 个</span></li>`).join('');
}

function renderRouteTable(routes, nodes) {
  const byId = Object.fromEntries(nodes.map(n => [n.id, n.name]));
  document.getElementById('routeTableBody').innerHTML = routes.map(r => `
    <tr>
      <td>${r.name}</td>
      <td><span class="lvl-badge lvl-${r.level}">${r.level === 'trunk' ? '干线' : '接驳'}</span></td>
      <td>${r.mode}</td>
      <td style="font-size:12px;color:var(--text-3)">${r.stops.map(id => byId[id]).filter(Boolean).join(' → ')}</td>
      <td><b>${r.volumeTons}</b></td>
    </tr>`).join('');
}

/* ---------------- 智能模拟 ---------------- */
function segVal(segId) {
  const active = document.querySelector(`#${segId} button.active`);
  return active ? active.dataset.v : undefined;
}
function bindSeg(segId) {
  document.querySelectorAll(`#${segId} button`).forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll(`#${segId} button`).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }));
}

function fillSelect(selId, nodes) {
  const sel = document.getElementById(selId);
  sel.innerHTML = nodes.map(n =>
    `<option value="${n.id}">${n.name}（${n.city}）</option>`).join('');
  if (selId === 'predRegion') {
    const cities = [...new Set(nodes.map(n => n.city))];
    cities.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = `◉ 全市：${c}`;
      sel.insertBefore(opt, sel.firstChild);
    });
  }
}

function resultGrid(items, stepsHtml, note) {
  return `
    <div class="res-grid">${items.map(i => `
      <div class="res-cell"><div class="rc-label">${i.label}</div>
      <div class="rc-value">${i.value}<small style="font-size:11px;color:var(--text-3)"> ${i.unit || ''}</small></div></div>`).join('')}
    </div>${stepsHtml || ''}${note ? `<p class="sim-note">${note}</p>` : ''}`;
}

async function runOptimize() {
  const btn = document.getElementById('runOptimize');
  const box = document.getElementById('optResult');
  btn.disabled = true;
  box.innerHTML = '<p class="hint"><span class="loading-spinner"></span> 正在计算最优路径…</p>';
  try {
    const res = await postJSON(API.optimize, {
      startId: document.getElementById('optStart').value,
      endId: document.getElementById('optEnd').value,
      cargoType: segVal('cargoSeg'),
      tons: parseInt(document.getElementById('optTons').value, 10),
    });
    if (res.error) throw new Error(res.error);
    box.innerHTML = resultGrid(
      [
        { label: '总距离', value: res.distanceKm, unit: 'km' },
        { label: '预计时长', value: res.estimatedHours, unit: 'h' },
        { label: '总成本', value: res.costYuan, unit: '元' },
        { label: '单位成本', value: res.costPerTon, unit: '元/吨' },
      ],
      `<div class="path-steps">${res.pathNames.map((s, i) =>
        `${i ? '<span class="path-arrow">→</span>' : ''}<span class="path-step">${s}</span>`).join('')}</div>`,
      `${res.cargoLabel} · 损耗率 ${(res.lossRate * 100).toFixed(1)}% · ${res.note}`
    );
    drawRouteMap(res.pathCoords, res.pathNames);
    toast('路径计算完成');
  } catch (e) {
    box.innerHTML = `<p class="error-state">计算失败：${e.message}</p>`;
  } finally { btn.disabled = false; }
}

function drawRouteMap(coords, names) {
  const panel = document.getElementById('routeMapPanel');
  panel.style.display = '';
  document.getElementById('routePathName').textContent = names.join(' → ');
  if (!charts.routeMap) {
    charts.routeMap = makeChart(document.getElementById('routeMap'));
  }
  const t = chartTheme();
  charts.routeMap.clear();
  echarts.registerMap('hunan', echarts.getMap('hunan') ? echarts.getMap('hunan').geoJson : 'hunan');
  charts.routeMap.setOption({
    backgroundColor: 'transparent',
    geo: {
      map: 'hunan', roam: true, zoom: 1.05,
      itemStyle: { areaColor: t.mapArea, borderColor: t.mapBorder, borderWidth: 1 },
      emphasis: { label: { show: false } },
    },
    series: [{
      type: 'lines', coordinateSystem: 'geo', zlevel: 2,
      effect: { show: true, period: 4.5, trailLength: .6, symbol: 'arrow', symbolSize: 8, color: '#34d399' },
      lineStyle: { color: '#10b981', width: 3, opacity: .75, curveness: .2 },
      data: [{ coords }],
    }, {
      type: 'effectScatter', coordinateSystem: 'geo', zlevel: 3,
      rippleEffect: { brushType: 'stroke', scale: 3 },
      symbolSize: 13, itemStyle: { color: '#f59e0b' },
      data: coords.map((c, i) => ({ name: names[i], value: [c[0], c[1], i === 0 ? 80 : i === coords.length - 1 ? 60 : 40] })),
      label: {
        show: true, position: 'right', fontSize: 11, color: t.textColor,
        formatter: p => p.name,
      },
    }],
  });
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function runPredict() {
  const btn = document.getElementById('runPredict');
  const box = document.getElementById('predResult');
  btn.disabled = true;
  box.innerHTML = '<p class="hint"><span class="loading-spinner"></span> 模型推理中…</p>';
  try {
    const regionSel = document.getElementById('predRegion');
    const opt = regionSel.options[regionSel.selectedIndex];
    const res = await postJSON(API.predict, {
      region: opt.getAttribute('value'),
      season: segVal('seasonSeg'),
    });
    if (res.error) throw new Error(res.error);
    const items = res.predictedMonthlyWanTons.slice(0, 3)
      .map((v, i) => ({ label: res.monthLabels[i] + '预测量', value: v, unit: '万吨' }));
    items.push({ label: '半年总量', value: res.totalHalfYearWanTons, unit: '万吨' });
    box.innerHTML = resultGrid(items,
      `<div class="path-steps"><span class="tag tag-cyan">高峰期：${res.peakMonths.join('、')}</span>
       <span class="tag tag-green">建议运力：${res.recommendedVehicles} 辆</span></div>`,
      `置信度 ${(res.confidence * 100).toFixed(0)}% · ${res.note}`);
    drawPredictChart(res);
    toast('需求预测完成');
  } catch (e) {
    box.innerHTML = `<p class="error-state">预测失败：${e.message}</p>`;
  } finally { btn.disabled = false; }
}

function drawPredictChart(res) {
  let holder = document.getElementById('predChartBox');
  if (!holder) {
    holder = document.createElement('div');
    holder.id = 'predChartBox';
    holder.className = 'glass-panel reveal visible';
    holder.style.marginTop = '18px';
    holder.innerHTML = '<h4 class="card-title">半年需求预测曲线 <span class="unit">(万吨/月)</span></h4><div id="predChart" class="chart"></div>';
    document.querySelector('.sim-grid').after(holder);
  }
  if (!charts.predChart) charts.predChart = makeChart(document.getElementById('predChart'));
  const t = chartTheme();
  charts.predChart.setOption({
    color: CHART_COLORS,
    tooltip: { trigger: 'axis', backgroundColor: t.tooltipBg, textStyle: { color: t.textColor } },
    grid: { left: 50, right: 24, top: 30, bottom: 34 },
    xAxis: { type: 'category', data: res.monthLabels, axisLabel: { color: t.textColor } },
    yAxis: { type: 'value', axisLabel: { color: t.textColor }, splitLine: { lineStyle: { color: t.splitLine } } },
    series: [{
      name: res.region, type: 'line', smooth: true, symbolSize: 8,
      data: res.predictedMonthlyWanTons,
      areaStyle: { opacity: .12 },
      lineStyle: { width: 3 },
    }],
  });
}

/* ---------------- 明暗主题 ---------------- */
function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem('xlzj-theme', dark ? 'dark' : 'light');
  Object.values(charts).forEach(c => c && c.dispose && c.dispose());
  for (const k in charts) delete charts[k];
  initChartsAfterTheme();
}

function initChartsAfterTheme() {
  if (nodesData.length && routesData.length) {
    charts.hunanMap = makeChart(document.getElementById('hunanMap'));
    charts.hunanMap.setOption(hunanMapOption(nodesData, routesData,
      document.querySelector('.chip.active')?.dataset.filter || 'all'));
    renderCorridorChart(routesData);
  }
  if (perspCache[currentPersp]) renderPersp(currentPersp, perspCache[currentPersp]);
}

/* ---------------- 滚动显现 & 导航高亮 ---------------- */
function setupScrollFx() {
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => { if (en.isIntersecting) en.target.classList.add('visible'); });
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
  // 主题恢复
  if (localStorage.getItem('xlzj-theme') === 'dark') {
    document.documentElement.classList.add('dark');
  }
  document.getElementById('themeToggle').addEventListener('click', () =>
    applyTheme(!document.documentElement.classList.contains('dark')));

  initBgCanvas();
  setupScrollFx();

  bindSeg('cargoSeg');
  bindSeg('seasonSeg');
  document.getElementById('optTons').addEventListener('input', e =>
    document.getElementById('tonsVal').textContent = e.target.value);
  document.getElementById('runOptimize').addEventListener('click', runOptimize);
  document.getElementById('runPredict').addEventListener('click', runPredict);

  // 图例筛选
  document.querySelectorAll('#mapToolbar .chip').forEach(chip =>
    chip.addEventListener('click', () => {
      document.querySelectorAll('#mapToolbar .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      refreshMapFilter(chip.dataset.filter);
    }));

  // 三端 tabs
  document.querySelectorAll('.persp-tab').forEach(btn =>
    btn.addEventListener('click', () => switchPersp(btn.dataset.persp)));

  // 首屏数据
  try {
    const overview = await getJSON(API.overview);
    renderKpis(overview.kpis);
    document.getElementById('heroDesc').textContent = overview.description;
  } catch (e) {
    toast('总览数据加载失败：' + e.message, true);
  }

  await initHunanMap();

  // 下拉框填充
  fillSelect('optStart', nodesData);
  fillSelect('optEnd', nodesData);
  fillSelect('predRegion', nodesData);

  // 默认打开产业端
  switchPersp('industry');
});
