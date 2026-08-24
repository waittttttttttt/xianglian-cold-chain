import json
import os


class DataLoader:
    def __init__(self, data_dir):
        self.data_dir = data_dir

    def _load_json(self, filename):
        path = os.path.join(self.data_dir, filename)
        if not os.path.exists(path):
            return {}
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)

    def get_overview(self):
        return self._load_json('overview.json')

    def get_nodes(self, node_type='all'):
        data = self._load_json('nodes.json')
        if node_type == 'all':
            return data
        return [n for n in data.get('nodes', []) if n.get('type') == node_type]

    def get_routes(self):
        return self._load_json('routes.json')

    def get_industry_solutions(self):
        return self._load_json('industry_solutions.json')

    def get_cost_comparison(self):
        return self._load_json('cost_comparison.json')

    def get_seasonal_flow(self):
        return self._load_json('seasonal_flow.json')