#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""湘链智图 · 湖南省物流规划数字平台 —— 零依赖后端
仅使用 Python 标准库：python app_stdlib.py 即可运行（默认端口 5000，可用环境变量 PORT 覆盖）。
同时提供 JSON API 与静态页面服务（前后端同源，无跨域问题）。
"""
import json
import math
import os
import socketserver
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse


class ThreadingHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
    """多线程 HTTP 服务：单个连接卡住不会阻塞其他请求（兼容 Python 3.6）。"""
    daemon_threads = True
    allow_reuse_address = True

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
PAGES_DIR = os.path.normpath(os.path.join(BASE_DIR, '..', 'pages'))
JS_DIR = os.path.normpath(os.path.join(BASE_DIR, '..', 'js'))
ASSETS_DIR = os.path.normpath(os.path.join(BASE_DIR, '..', 'assets'))

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

_CACHE = {}


def cached(filename):
    """读取 data 目录下的 JSON（带缓存）。"""
    if filename not in _CACHE:
        with open(os.path.join(DATA_DIR, filename), 'r', encoding='utf-8') as f:
            _CACHE[filename] = json.load(f)
    return _CACHE[filename]


def haversine_km(a, b):
    """球面距离（公里），用于路径估算。"""
    radius = 6371.0
    lat1, lon1, lat2, lon2 = map(math.radians, [a['lat'], a['lng'], b['lat'], b['lng']])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(h))


# ---------------- 业务模拟计算（后续可替换为真实规划模型） ----------------

CARGO_TYPES = {
    'general': {'label': '普货整车', 'ratePerTonKm': 0.42, 'lossRate': 0.006},
    'cold': {'label': '冷链（2-8°C）', 'ratePerTonKm': 0.85, 'lossRate': 0.018},
    'express': {'label': '时效快运', 'ratePerTonKm': 0.55, 'lossRate': 0.004},
    'heavy': {'label': '大宗重货', 'ratePerTonKm': 0.30, 'lossRate': 0.002},
}

SEASON_FACTOR = {
    '春季': [0.88, 0.84, 0.96, 1.02, 1.08, 1.12],
    '夏季': [1.10, 1.14, 1.20, 1.26, 1.22, 1.16],
    '秋季': [1.06, 1.10, 1.14, 1.04, 0.98, 0.94],
    '冬季': [0.92, 0.90, 0.94, 1.00, 1.08, 1.12],
}


def nearest_hub(node, nodes_by_id):
    if node['type'] == 'hub':
        return node
    same_city = [n for n in nodes_by_id.values() if n['type'] == 'hub' and n['city'] == node['city']]
    pools = same_city or [n for n in nodes_by_id.values() if n['type'] == 'hub']
    return min(pools, key=lambda h: haversine_km(h, node))


def compute_optimize_route(payload):
    nodes = {n['id']: n for n in cached('nodes.json')['nodes']}
    start_id = payload.get('startId', 'CS_HUB')
    end_id = payload.get('endId', 'CZ_HUB')
    cargo_key = payload.get('cargoType', 'general')
    if start_id not in nodes or end_id not in nodes:
        return {'error': '起点或终点节点不存在'}
    cargo = CARGO_TYPES.get(cargo_key, CARGO_TYPES['general'])
    start, end = nodes[start_id], nodes[end_id]

    hub_start = nearest_hub(start, nodes)
    hub_end = nearest_hub(end, nodes)
    path = [start['id']]
    if hub_start['id'] != start['id']:
        path.append(hub_start['id'])
    if hub_end['id'] != hub_start['id']:
        path.append(hub_end['id'])
    if end['id'] != path[-1]:
        path.append(end['id'])

    detour = 1.25  # 实际路网绕行系数
    distance = sum(haversine_km(nodes[path[i]], nodes[path[i + 1]]) for i in range(len(path) - 1)) * detour
    tons = float(payload.get('tons', 10) or 10)
    cost = round(distance * cargo['ratePerTonKm'] * max(tons, 1))
    hours = round(distance / 62 + 0.6 * (len(path) - 2), 1)

    return {
        'pathIds': path,
        'pathNames': [nodes[pid]['name'] for pid in path],
        'pathCoords': [[nodes[pid]['lng'], nodes[pid]['lat']] for pid in path],
        'distanceKm': round(distance, 1),
        'estimatedHours': hours,
        'cargoLabel': cargo['label'],
        'tons': tons,
        'costYuan': cost,
        'costPerTon': round(cost / max(tons, 1), 1),
        'lossRate': cargo['lossRate'],
        'note': '演示结果：基于球面距离与费率参数估算，正式版将接入团队规划模型输出。',
    }


def compute_predict_demand(payload):
    nodes = cached('nodes.json')['nodes']
    region = payload.get('region', '')
    season = payload.get('season', '夏季')
    matched = None
    for n in nodes:
        if n['name'] == region or n['city'] == region:
            matched = n
            break
    if matched is None:
        matched = nodes[0]
        region = matched['name']
    factors = SEASON_FACTOR.get(season, SEASON_FACTOR['夏季'])
    base = matched['throughput'] / 12.0  # 万吨/年 → 月均
    monthly = [round(base * f, 1) for f in factors]
    peak = sorted(range(6), key=lambda i: -monthly[i])[:3]
    month_names = ['下月', '+2月', '+3月', '+4月', '+5月', '+6月']
    return {
        'region': region,
        'season': season,
        'predictedMonthlyWanTons': monthly,
        'monthLabels': month_names,
        'totalHalfYearWanTons': round(sum(monthly), 1),
        'peakMonths': [month_names[i] for i in sorted(peak)],
        'recommendedVehicles': max(4, int(matched['throughput'] / 260)),
        'confidence': 0.87,
        'note': '演示结果：按节点吞吐量与季节系数测算，正式版将替换为团队需求预测模型。',
    }


# ---------------- HTTP 服务 ----------------

class Handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):  # 静默访问日志
        pass

    def _headers(self, code=200, ctype='application/json; charset=utf-8'):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def _send_json(self, obj, code=200):
        self._headers(code)
        self.wfile.write(json.dumps(obj, ensure_ascii=False).encode('utf-8'))

    def _read_body(self):
        length = int(self.headers.get('Content-Length', 0) or 0)
        if length:
            return json.loads(self.rfile.read(length).decode('utf-8'))
        return {}

    def do_OPTIONS(self):
        self._headers()

    # ---- GET：API + 静态资源 ----
    def do_GET(self):
        parsed = urlparse(self.path)
        path, query = parsed.path, parsed.query

        try:
            if path == '/api/health':
                self._send_json({'status': 'ok', 'service': 'hunan-logistics-platform'})
            elif path == '/api/overview':
                self._send_json(cached('overview.json'))
            elif path == '/api/nodes':
                data = cached('nodes.json')
                key = ''
                if 'type=' in query:
                    key = query.split('type=')[1].split('&')[0]
                if key:
                    data = {'nodes': [n for n in data['nodes'] if n['type'] == key]}
                self._send_json(data)
            elif path == '/api/routes':
                self._send_json(cached('routes.json'))
            elif path in ('/api/perspectives/industry', '/api/industry'):
                self._send_json(cached('industry_perspectives.json'))
            elif path in ('/api/perspectives/logistics', '/api/logistics'):
                self._send_json(cached('logistics_perspectives.json'))
            elif path in ('/api/perspectives/sales', '/api/sales'):
                self._send_json(cached('sales_perspectives.json'))
            elif path in ('/assets/hunan.json', '/api/map-geo'):
                self.serve_file(os.path.join(ASSETS_DIR, 'hunan.json'))
            else:
                self.serve_static(path)
        except Exception as exc:  # noqa: BLE001
            self._send_json({'error': str(exc)}, 500)

    # ---- POST：交互计算 ----
    def do_POST(self):
        path = urlparse(self.path).path
        payload = self._read_body()
        try:
            if path == '/api/optimize-route':
                self._send_json(compute_optimize_route(payload))
            elif path == '/api/predict-demand':
                self._send_json(compute_predict_demand(payload))
            else:
                self._send_json({'error': 'unknown endpoint'}, 404)
        except Exception as exc:  # noqa: BLE001
            self._send_json({'error': str(exc)}, 500)

    # ---- 静态文件 ----
    def serve_static(self, path):
        if path == '/':
            self.serve_file(os.path.join(PAGES_DIR, 'index.html'))
            return
        rel = path.lstrip('/').replace('/', os.sep)
        if rel.startswith('js' + os.sep):
            root, rel_path = JS_DIR, os.path.basename(rel)
        elif rel.startswith('assets' + os.sep):
            root, rel_path = ASSETS_DIR, os.path.relpath(rel, 'assets')
        elif rel.startswith('pages' + os.sep):
            root, rel_path = PAGES_DIR, os.path.basename(rel)
        else:
            # 依次在 pages/ 与项目根目录中查找
            candidates = [os.path.normpath(os.path.join(PAGES_DIR, rel)),
                          os.path.normpath(os.path.join(BASE_DIR, '..', rel))]
            for cand in candidates:
                if os.path.isfile(cand):
                    self.serve_file(cand)
                    return
            self.serve_file(candidates[-1])
            return
        self.serve_file(os.path.normpath(os.path.join(root, rel_path)))

    def serve_file(self, file_path):
        if not os.path.isfile(file_path):
            self._send_json({'error': 'not found'}, 404)
            return
        ext = os.path.splitext(file_path)[1].lower()
        with open(file_path, 'rb') as f:
            content = f.read()
        self._headers(200, MIME.get(ext, 'application/octet-stream'))
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        self.wfile.write(content)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print('=' * 52)
    print(' 湘链智图 · 湖南省物流规划数字平台 后端已启动')
    print(' 本机访问:  http://localhost:%d/' % port)
    print(' 健康检查:  http://localhost:%d/api/health' % port)
    print(' （多线程模式，关闭本窗口即停止服务）')
    print('=' * 52)
    ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()
