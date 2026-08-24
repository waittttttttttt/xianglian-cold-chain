from flask import Flask, jsonify, request
from flask_cors import CORS
import json
import os
import sys

# Add project root to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from utils.data_loader import DataLoader
from models.route_optimizer import RouteOptimizer
from models.demand_predictor import DemandPredictor

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')

data_loader = DataLoader(DATA_DIR)
route_optimizer = RouteOptimizer()
demand_predictor = DemandPredictor()


@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'service': 'county-logistics-backend'})


@app.route('/api/overview', methods=['GET'])
def overview():
    """Core indicators overview"""
    return jsonify(data_loader.get_overview())


@app.route('/api/nodes', methods=['GET'])
def nodes():
    """Logistics nodes: county/town/village"""
    node_type = request.args.get('type', 'all')
    return jsonify(data_loader.get_nodes(node_type))


@app.route('/api/routes', methods=['GET'])
def routes():
    """Current distribution routes"""
    return jsonify(data_loader.get_routes())


@app.route('/api/industry-solutions', methods=['GET'])
def industry_solutions():
    """Differentiated logistics solutions by industry cluster"""
    return jsonify(data_loader.get_industry_solutions())


@app.route('/api/cost-comparison', methods=['GET'])
def cost_comparison():
    """Cost comparison: before vs after optimization"""
    return jsonify(data_loader.get_cost_comparison())


@app.route('/api/optimize-route', methods=['POST'])
def optimize_route():
    """Route optimization placeholder - replace with your algorithm"""
    payload = request.get_json() or {}
    start = payload.get('start', '县城配送中心')
    end = payload.get('end', '乡镇生鲜集散点')
    cargo_type = payload.get('cargoType', 'fresh-fruit')
    result = route_optimizer.optimize(start, end, cargo_type)
    return jsonify(result)


@app.route('/api/predict-demand', methods=['POST'])
def predict_demand():
    """Demand prediction placeholder - replace with your model"""
    payload = request.get_json() or {}
    region = payload.get('region', '示范县')
    season = payload.get('season', '夏季')
    result = demand_predictor.predict(region, season)
    return jsonify(result)


@app.route('/api/seasonal-flow', methods=['GET'])
def seasonal_flow():
    """Seasonal cargo flow data"""
    return jsonify(data_loader.get_seasonal_flow())


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)