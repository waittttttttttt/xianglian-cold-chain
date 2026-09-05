#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""湘链智图 · 湖南省市州生鲜冷链运输数字平台 —— 零依赖后端框架

仅用 Python 标准库：python app_stdlib.py 即可运行（默认端口 5000，PORT 环境变量可覆盖）。
同时提供 JSON API 与静态页面服务（前后端同源，无跨域问题）。

框架约定（重要）：
1. backend/data/*.json 为演示占位数据，字段结构就是前后端契约，替换数据不改代码；
   数据文件支持热加载（按修改时间自动失效缓存），替换数据后无需重启服务；
2. 团队真实测算模型请接入 compute_simulate_coldchain() 与 compute_predict_demand()，
   输入输出字段契约见 INTEGRATION.md，两处均有 TODO 标记。
"""
import calendar
import json
import math
import os
import socketserver
import sys
from datetime import datetime
from email.utils import formatdate, parsedate_tz
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import urllib.request  # 县域边界仅首次在线下载，随后走本地缓存（断网可演示）


class ThreadingHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
    """多线程 HTTP 服务：单个连接卡住不会阻塞其他请求（兼容 Python 3.6）。"""
    daemon_threads = True
    allow_reuse_address = True


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
PROJECT_ROOT = os.path.normpath(os.path.join(BASE_DIR, '..'))
PAGES_DIR = os.path.join(PROJECT_ROOT, 'pages')
JS_DIR = os.path.join(PROJECT_ROOT, 'js')
ASSETS_DIR = os.path.join(PROJECT_ROOT, 'assets')

MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
}

# 内联雪花 favicon：消除每次刷新一条 /favicon.ico 404 噪音。
# 底色用品牌渐变，与页面 logo 的容器语言保持同源（渐变即链路的品牌隐喻）
FAVICON_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
    '<defs><linearGradient id="fg" x1="0" y1="0" x2="1" y2="1">'
    '<stop offset="0" stop-color="#0ea5e9"/><stop offset="1" stop-color="#14b8a6"/>'
    '</linearGradient></defs>'
    '<rect width="64" height="64" rx="14" fill="url(#fg)"/>'
    '<g stroke="#ffffff" stroke-width="4" stroke-linecap="round">'
    '<path d="M32 12v40M15 21l34 22M49 21L15 43"/>'
    '<path d="M32 19l-6-5m6 5l6-5M23 26l-8-3m8 3l-2-8M41 26l8-3m-8 3l2-8"/>'
    '</g></svg>'
)


class BadRequest(ValueError):
    """客户端可控的请求错误：message 是面向用户的中文原因，可安全下发给前端。"""


_CACHE = {}


def cached(filename):
    """读取 data 目录下的 JSON，按文件修改时间自动失效缓存。
    团队批量替换真实数据后刷新页面即生效，无需重启服务。"""
    path = os.path.join(DATA_DIR, filename)
    mtime = os.stat(path).st_mtime
    hit = _CACHE.get(filename)
    if hit is None or hit[0] != mtime:
        with open(path, 'r', encoding='utf-8') as f:
            hit = (mtime, json.load(f))
        # GIL 下字典赋值原子；并发竞态最坏情况是重复读盘一次，属良性
        _CACHE[filename] = hit
    return hit[1]


def haversine_km(a, b):
    """两地球面距离（公里），输入含 lat/lng 字段。"""
    radius = 6371.0
    lat1, lon1, lat2, lon2 = map(math.radians, [a['lat'], a['lng'], b['lat'], b['lng']])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(h))


# ---------------- 冷链运输模拟参数（演示值，可在 products.json 中按品类覆盖） ----------------

DETOUR_FACTOR = 1.25        # 实际路网绕行系数：球面距离 × 1.25 ≈ 公里数
HANDLING_HOURS = 1.2        # 两端装卸、预冷交接合计时长
DIESEL_PRICE = 7.6          # 元/升（演示价）
CO2_PER_LITER = 2.65        # 柴油碳排放系数 kg/L
BASE_FUEL_PER_KM = 0.30     # 冷藏车基础油耗 L/km（约 30L/100km）

SEASON_FACTOR = {
    '春季': [0.88, 0.84, 0.96, 1.02, 1.08, 1.12],
    '夏季': [1.10, 1.16, 1.24, 1.28, 1.20, 1.14],
    '秋季': [1.06, 1.10, 1.14, 1.04, 0.98, 0.94],
    '冬季': [0.92, 0.90, 0.95, 1.00, 1.08, 1.14],
}


# ---------------- 县域下钻：市州 → 区县边界 ----------------

# 与 js/app.js 中 CITY_ADCODE 保持一致；数据源同 assets/hunan.json（DataV.GeoAtlas，免密钥）
COUNTY_ADCODES = {
    'CS': '430100', 'ZZ': '430200', 'XT': '430300', 'HY': '430400',
    'SY': '430500', 'YY': '430600', 'CD': '430700', 'ZJJ': '430800',
    'YIY': '430900', 'CZ': '431000', 'YZ': '431100', 'HH': '431200',
    'LD': '431300', 'XX': '433100',
}
COUNTY_CACHE_DIR = os.path.join(ASSETS_DIR, 'counties')


def load_county_geojson(adcode):
    """读取市州区县级 GeoJSON：优先本地缓存 assets/counties/{adcode}_full.json，
    未命中才在线下载一次并落盘——首次联网后即可完全断网演示。"""
    if adcode not in set(COUNTY_ADCODES.values()):
        return None
    os.makedirs(COUNTY_CACHE_DIR, exist_ok=True)
    path = os.path.join(COUNTY_CACHE_DIR, '%s_full.json' % adcode)
    if os.path.isfile(path):
        with open(path, 'r', encoding='utf-8') as f:
            return f.read()
    url = 'https://geo.datav.aliyun.com/areas_v3/bound/%s_full.json' % adcode
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            raw = resp.read()
        json.loads(raw.decode('utf-8'))  # 合法性校验通过才落盘，防止半截文件进缓存
        tmp = path + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(raw)
        os.replace(tmp, path)
        return raw.decode('utf-8')
    except Exception:
        return None


def sanitize_payload(payload):
    """在进入模型接入点之前做入参消毒：非数字/NaN/Inf/负值在这里拦截并给出中文原因，
    避免非法 JSON 与负吨位流入 compute_* 函数（TODO 函数体保持团队可整体替换，
    因此校验放在函数外而不是函数体内）。"""
    if payload.get('tons') is not None:
        try:
            tons = float(payload['tons'])
        except (TypeError, ValueError):
            raise BadRequest('货量必须是数字')
        if not math.isfinite(tons):
            raise BadRequest('货量必须是有限数字')
        if tons <= 0:
            raise BadRequest('货量必须大于 0')
        payload['tons'] = min(tons, 100000)
    return payload


def compute_simulate_coldchain(payload):
    """冷链运输模拟：给定起点市州、终点市州、品类与吨量，估算成本/时效/温控/损耗/碳排放。

    TODO(团队模型接入点)：将本函数体替换为团队真实测算模型的调用，
    保持输入输出字段不变即可，前端无需任何改动（契约见 INTEGRATION.md 第四节）。
    """
    cities = dict((c['id'], c) for c in cached('cities.json')['cities'])
    products = dict((p['key'], p) for p in cached('products.json')['products'])

    from_id = payload.get('fromId', 'CS')
    to_id = payload.get('toId', 'CD')
    product_key = payload.get('product', 'fruitveg')
    if from_id not in cities or to_id not in cities:
        return {'error': '起点或终点市州不存在'}
    if from_id == to_id:
        return {'error': '起点与终点为同一市州'}
    product = products.get(product_key)
    if product is None:
        return {'error': '未知品类：%s' % product_key}

    a, b = cities[from_id], cities[to_id]
    tons = float(payload.get('tons', 10) or 10)

    distance = haversine_km(a, b) * DETOUR_FACTOR
    speed = product.get('avgSpeedKmh', 58)
    hours = round(distance / speed + HANDLING_HOURS, 1)

    # 成本 = 干线运费(元/吨公里×吨×公里) + 两端冷库装卸费；燃油仅用于能耗/排放展示
    cost = distance * product['ratePerTonKm'] * max(tons, 0.5) + product['handlingFee'] * 2
    fuel = distance * BASE_FUEL_PER_KM * (1.0 + product.get('reeferLoad', 0.25))

    # 温控断链风险随距离上升：风险% = 品类基础风险 + 距离斜率（封顶 35%）
    temp_risk = min(35.0, product.get('riskBase', 2) + distance * 0.02)
    loss_rate_eff = product['lossBase'] * (0.75 + 0.55 * min(distance / 800.0, 1.0))
    loss_tons = round(tons * loss_rate_eff, 2)

    return {
        'fromId': from_id, 'toId': to_id,
        'fromName': a['name'], 'toName': b['name'],
        'productKey': product_key,
        'productLabel': product['label'],
        'tempZone': product['tempZone'],
        'tons': tons,
        'distanceKm': round(distance, 1),
        'estimatedHours': hours,
        'costYuan': round(cost),
        'costPerTon': round(cost / max(tons, 0.5), 1),
        'fuelLiters': round(fuel, 1),
        'co2Kg': round(fuel * CO2_PER_LITER, 1),
        'tempRiskPct': round(temp_risk, 1),
        'tempPassRate': round(100 - temp_risk, 1),
        'lossTons': loss_tons,
        'lossValueYuan': round(loss_tons * product['unitPriceYuan']),
        'lossRateEffPct': round(loss_rate_eff * 100, 2),
        'pathCoords': [[a['lng'], a['lat']], [b['lng'], b['lat']]],
        'note': '演示结果：基于品类费率与球面距离估算，正式版将由团队测算模型输出。',
    }


def compute_predict_demand(payload):
    """需求预测：给定市州与季节场景，输出未来 6 个月生鲜冷链运输需求曲线。

    TODO(团队模型接入点)：替换为团队需求预测模型（回归/时序均可），
    保持输入输出字段不变即可。
    """
    cities = cached('cities.json')['cities']
    city_id = payload.get('cityId', '')
    season = payload.get('season', '夏季')
    matched = None
    for c in cities:
        if c['id'] == city_id or c['name'] == city_id:
            matched = c
            break
    if matched is None:
        matched = cities[0]
        city_id = matched['id']

    factors = SEASON_FACTOR.get(season, SEASON_FACTOR['夏季'])
    base = matched['freshOutputWanTons'] / 12.0  # 年产量 → 月均运输需求（万吨）
    monthly = [round(base * f, 1) for f in factors]
    month_labels = ['下月', '+2月', '+3月', '+4月', '+5月', '+6月']
    peak_idx = sorted(range(6), key=lambda i: -monthly[i])[:3]

    return {
        'cityId': matched['id'],
        'cityName': matched['name'],
        'season': season,
        'monthLabels': month_labels,
        'predictedMonthlyWanTons': monthly,
        'totalHalfYearWanTons': round(sum(monthly), 1),
        'peakMonths': [month_labels[i] for i in sorted(peak_idx)],
        'recommendedVehicles': max(4, int(matched['coldVehicles'] * 0.08)),
        'confidence': 0.86,
        'note': '演示结果：按市州生鲜产量与季节系数测算，正式版将替换为团队预测模型。',
    }


def compute_city_detail(city_id):
    """市州详情：冷链家底 + 同比排名 + 主导品类。供地图点击联动展示。"""
    cities = cached('cities.json')['cities']
    city = None
    for c in cities:
        if c['id'] == city_id or c['name'] == city_id:
            city = c
            break
    if city is None:
        return {'error': '市州不存在：%s' % city_id}

    by_storage = sorted(cities, key=lambda x: -x['coldStorageWanTons'])
    rank = by_storage.index(city) + 1
    total_storage = sum(c['coldStorageWanTons'] for c in cities)
    if total_storage <= 0:
        # 除零防护：14 市州容量全填 0 时不再抛 ZeroDivisionError 中断演示
        return {'error': '冷库容量数据异常：全省容量合计为 0'}

    # 冷库利用率由流通率与容量相对水平推算（占位口径，待团队真实产能数据替换）
    utilization = min(96, int(40 + city['flowRate'] * 0.8))

    return {
        'city': city,
        'storageRank': rank,
        'cityCount': len(cities),
        'storageSharePct': round(city['coldStorageWanTons'] / total_storage * 100, 1),
        'capacityUtilization': utilization,
        'note': '利用率为演示口径，正式版接入各市州冷库实际周转数据。',
    }


# ---------------- HTTP 服务 ----------------

class Handler(BaseHTTPRequestHandler):

    # 所有响应都经 _respond() 出口、必带 Content-Length，因此可安全启用 keep-alive
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        # 访问日志输出到控制台：远程排查浏览器到服务端的链路断点时必需
        try:
            print('[%s] %s - %s' % (datetime.now().strftime('%Y-%m-%dT%H:%M:%S'),
                                    self.client_address[0], fmt % args))
        except Exception:
            pass

    def _respond(self, code, ctype, body, cache=None, last_mod=None):
        """唯一发送出口：先定 Content-Length 再 end_headers。
        旧实现先 end_headers 又补发头，导致头被拼进响应体开头，
        浏览器把 'Content-Length: ...' 当 JS/JSON 解析——白屏根因。"""
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        if cache:
            self.send_header('Cache-Control', cache)
        if last_mod:
            self.send_header('Last-Modified', last_mod)
        # nosniff：防止浏览器把 JSON 错误响应嗅探成 HTML/JS 执行
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _send_json(self, obj, code=200):
        # allow_nan=False：宁可返回可控的 500，也绝不向浏览器输出非法 JSON 字面量 NaN
        body = json.dumps(obj, ensure_ascii=False, allow_nan=False)
        self._respond(code, 'application/json; charset=utf-8', body)

    def _read_body(self):
        """读取并解析 JSON 请求体；一切畸形输入转成 BadRequest(400)，
        而不是挂死线程或以 500 泄露内部细节。"""
        raw_len = self.headers.get('Content-Length')
        try:
            length = int(raw_len) if raw_len else 0
        except (TypeError, ValueError):
            raise BadRequest('Content-Length 非法')
        # 负长度会让 rfile.read() 退化为「读到连接关闭」，
        # 在 HTTP/1.1 keep-alive 连接上永远等不到数据 = 挂死一个工作线程
        if length < 0 or length > 1048576:
            raise BadRequest('请求体大小越界')
        raw = self.rfile.read(length) if length else b''
        if not raw:
            return {}
        try:
            payload = json.loads(raw.decode('utf-8'))
        except (ValueError, UnicodeDecodeError):
            raise BadRequest('请求体不是合法 JSON')
        if not isinstance(payload, dict):
            raise BadRequest('请求体必须是 JSON 对象')
        return payload

    def do_OPTIONS(self):
        # keep-alive 下预检也必须带准确的空体长度，否则浏览器挂起
        self._respond(200, 'text/plain; charset=utf-8', b'')

    # ---- GET：API + 静态资源 ----
    def do_GET(self):
        parsed = urlparse(self.path)
        path, query = parsed.path, parsed.query

        # 安全第一道闸：拒绝一切父目录跳转段（纵深防御的第二道在 serve_static/_safe_join）
        if '..' in path.split('/') or '..' in path.split('\\'):
            self._send_json({'error': 'not found'}, 404)
            return

        try:
            if path == '/api/health':
                self._send_json({'status': 'ok', 'service': 'hunan-coldchain-platform'})
            elif path == '/api/overview':
                self._send_json(cached('overview.json'))
            elif path == '/api/cities':
                self._send_json(cached('cities.json'))
            elif path == '/api/products':
                self._send_json(cached('products.json'))
            elif path == '/api/analysis':
                self._send_json(cached('analysis.json'))
            elif path == '/api/city-detail':
                qs = parse_qs(query)
                cid = (qs.get('id') or [''])[0]
                self._send_json(compute_city_detail(cid))
            elif path in ('/assets/hunan.json', '/api/map-geo'):
                self.serve_file(os.path.join(ASSETS_DIR, 'hunan.json'))
            elif path == '/api/map-county':
                qs = parse_qs(query)
                adcode = (qs.get('adcode') or [''])[0]
                body = load_county_geojson(adcode) if adcode.isdigit() else None
                if body is None:
                    self._send_json({'error': '县域边界获取失败（每个市州首次需联网加载一次，之后走本地缓存）'}, 404)
                else:
                    self._respond(200, 'application/json; charset=utf-8', body,
                                  cache='max-age=86400')
            elif path == '/api/network':
                self._send_json(cached('network.json'))
            elif path == '/api/resources':
                self._send_json(cached('resources.json'))
            elif path == '/api/events':
                qs = parse_qs(query)
                try:
                    limit = int((qs.get('limit') or ['30'])[0])
                except ValueError:
                    limit = 30
                events = cached('events.json').get('events', [])
                self._send_json({'events': events[:max(1, min(limit, 100))]})
            elif path in ('/favicon.ico', '/favicon.svg'):
                self._respond(200, 'image/svg+xml', FAVICON_SVG, cache='max-age=86400')
            else:
                self.serve_static(path)
        except Exception:  # noqa: BLE001
            import traceback
            traceback.print_exc()  # 完整堆栈只留在控制台，不外泄给页面
            self._send_json({'error': '服务内部错误，请查看后端控制台'}, 500)

    # ---- POST：交互计算 ----
    def do_POST(self):
        path = urlparse(self.path).path
        # 先匹配路由再读请求体：未知端点直接 404，不消耗读取
        if path == '/api/simulate-coldchain':
            handler = compute_simulate_coldchain
        elif path == '/api/predict-demand':
            handler = compute_predict_demand
        else:
            self._send_json({'error': 'unknown endpoint'}, 404)
            return
        try:
            result = handler(sanitize_payload(self._read_body()))
            self._send_json(result)
        except BadRequest as exc:
            # 客户端可控错误：400 + 中文原因，前端 toast 可直接展示
            self._send_json({'error': str(exc)}, 400)
        except Exception:  # noqa: BLE001
            # 与 do_GET 相同的安全口径：细节堆栈只进控制台，页面拿通用文案
            import traceback
            traceback.print_exc()
            self._send_json({'error': '服务内部错误，请查看后端控制台'}, 500)

    # ---- 静态文件 ----
    def serve_static(self, path):
        if path == '/':
            # 根路径跳转到登录页
            self.send_response(302)
            self.send_header('Location', '/login.html')
            self.end_headers()
            return
        rel = path.lstrip('/')
        # 安全第二道闸：URL 出现反斜杠或父目录段一律 404。
        # 只按 '/' 切分会漏掉 Windows 反斜杠穿越（GET /\..\..\Windows\win.ini，
        # bpo-26657 同源漏洞），所以反斜杠本身也直接拒绝。
        if '\\' in rel or '..' in rel.replace('\\', '/').split('/'):
            self._send_json({'error': 'not found'}, 404)
            return
        top = rel.split('/', 1)[0]
        rest = rel[len(top) + 1:] if len(rel) > len(top) else ''
        if top == 'js':
            candidate = _safe_join(JS_DIR, os.path.basename(rest))
        elif top == 'pages':
            candidate = _safe_join(PAGES_DIR, os.path.basename(rest))
        elif top == 'assets':
            candidate = _safe_join(ASSETS_DIR, rest)
        else:
            # 根级兜底（如 robots.txt）：依次限定在 pages/ 与项目根内查找
            candidate = _safe_join(PAGES_DIR, rel)
            if not (candidate and os.path.isfile(candidate)):
                candidate = _safe_join(PROJECT_ROOT, rel)
        if candidate and os.path.isfile(candidate):
            self.serve_file(candidate)
        else:
            self._send_json({'error': 'not found'}, 404)

    def serve_file(self, file_path):
        # 安全最终闸：realpath 解析符号链接与 .. 之后，断言结果仍在项目根内
        real = os.path.realpath(file_path)
        root_real = os.path.realpath(PROJECT_ROOT)
        if real != root_real and not real.startswith(root_real + os.sep):
            self._send_json({'error': 'not found'}, 404)
            return
        if not os.path.isfile(real):
            self._send_json({'error': 'not found'}, 404)
            return
        ext = os.path.splitext(real)[1].lower()
        stat = os.stat(real)
        last_mod = formatdate(stat.st_mtime, usegmt=True)
        # 第三方库内容不变 → 浏览器本地长缓存；自有文件 → 协商缓存（改完刷新即生效）
        cache = ('max-age=86400' if os.sep + 'vendor' + os.sep in real else 'no-cache')
        ims = self.headers.get('If-Modified-Since')
        if (ims and cache == 'no-cache' and
                int(calendar.timegm(parsedate_tz(ims))) >= int(stat.st_mtime)):
            # 304 无响应体，浏览器直接用本地副本
            self._respond(304, 'text/plain; charset=utf-8', b'',
                          cache=cache, last_mod=last_mod)
            return
        with open(real, 'rb') as f:
            content = f.read()
        self._respond(200, MIME.get(ext, 'application/octet-stream'), content,
                      cache=cache, last_mod=last_mod)


def _safe_join(root, relative):
    """归一化后断言结果仍位于 root 之下，越界返回 None。
    同时防御 ../ 与 ..\\（Windows）、绝对路径与盘符注入（werkzeug safe_join 同型思路）。"""
    if not relative or relative.startswith(('\\', '/')) \
            or ':' in relative.split(os.sep)[0]:
        return None
    resolved = os.path.abspath(os.path.join(root, relative))
    root_abs = os.path.abspath(root)
    if resolved != root_abs and not resolved.startswith(root_abs + os.sep):
        return None
    return resolved


REQUIRED_DATA_FILES = ['overview.json', 'cities.json', 'products.json', 'analysis.json']

# 演示公式会「硬取」这些字段（item['field'] 直取），缺一必炸，启动期全部点检；
# avgSpeedKmh/riskBase/reeferLoad 走 .get(默认值)，故意不列——保留数据作者的宽松度
CITY_NUMERIC_FIELDS = ['lng', 'lat', 'coldStorageWanTons', 'freshOutputWanTons',
                       'coldVehicles', 'flowRate']
PRODUCT_NUMERIC_FIELDS = ['ratePerTonKm', 'handlingFee', 'lossBase', 'unitPriceYuan']


def _assert_numeric(items, fields, label):
    """字段级类型点检：字符串数字（如 "4,200"）在启动期就拦下，
    而不是等演示中途点击模拟/详情才 500——这正是本函数的设计意图。"""
    for i, item in enumerate(items):
        for field in fields:
            value = item.get(field)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError('%s[%d].%s 不是数值（当前为 %r）'
                                 % (label, i, field, value))


def preload_and_validate():
    """启动期预加载并校验全部数据文件：坏一个就在启动时报错，
    而不是等演示中途点击对应板块才炸；顺便预热缓存让首次点击零延迟。"""
    ok = True
    for name in REQUIRED_DATA_FILES:
        try:
            data = cached(name)  # 解析失败会在此抛异常，即完成 JSON 合法性校验
            if name == 'cities.json':
                if not data.get('cities'):
                    raise ValueError('cities 数组为空')
                _assert_numeric(data['cities'], CITY_NUMERIC_FIELDS, 'cities')
            if name == 'products.json':
                if not data.get('products'):
                    raise ValueError('products 数组为空')
                _assert_numeric(data['products'], PRODUCT_NUMERIC_FIELDS, 'products')
            print('  [OK]   data/%s' % name)
        except Exception as exc:
            ok = False
            print('  [FAIL] data/%s -> %s' % (name, exc))
    try:
        with open(os.path.join(ASSETS_DIR, 'hunan.json'), 'rb') as f:
            json.loads(f.read().decode('utf-8'))
        print('  [OK]   assets/hunan.json')
    except Exception as exc:
        ok = False
        print('  [FAIL] assets/hunan.json -> %s' % exc)
    if not ok:
        print('数据文件缺失或损坏，拒绝启动（请先修复再演示）')
        sys.exit(1)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '5000'))
    # 云平台（Render 等）只注入 PORT 不注入 HOST → 必须绑 0.0.0.0 外部健康检查才通；
    # 本地未设 PORT 时维持仅本机访问，不扩大攻击面
    host = os.environ.get('HOST') or ('0.0.0.0' if os.environ.get('PORT') else '127.0.0.1')
    preload_and_validate()
    print('=' * 52)
    print(' 湘链智图 · 生鲜冷链运输数字平台 后端已启动')
    print(' 本机访问:  http://127.0.0.1:%d/ （请勿使用 localhost：本机解析为 IPv6 会导致白屏）' % port)
    print(' 健康检查:  http://127.0.0.1:%d/api/health' % port)
    if host == '127.0.0.1':
        print(' （仅本机可访问；需手机投屏请 set HOST=0.0.0.0 后重启）')
    print(' （多线程模式，关闭本窗口即停止服务；替换 data/*.json 后刷新页面即可生效）')
    print('=' * 52)
    ThreadingHTTPServer((host, port), Handler).serve_forever()
