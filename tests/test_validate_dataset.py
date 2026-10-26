import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('validator', Path(__file__).parents[1] / 'scripts/validate_dataset.py')
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class DatasetValidationTests(unittest.TestCase):
    def test_checkpoints_detect_axis_errors_missing_values_and_corruption(self):
        with tempfile.TemporaryDirectory() as name:
            directory = Path(name)
            raw = bytes([0, 254, 255, 127, 0, 254, 127, 0, 254, 255, 127, 0])
            (directory / 'v.raw').write_bytes(raw)
            metadata = {
                'synthetic': True, 'dimensions': {'x': 3, 'y': 2, 'z': 2},
                'bounds': {'x': {'min': 10, 'max': 16}, 'y': {'min': 20, 'max': 24}, 'z': {'min': -4, 'max': 0}},
                'variables': [{'id': 7, 'name': 'Measurement', 'file': 'v.raw', 'sha256': hashlib.sha256(raw).hexdigest(),
                               'dtype': 'uint8', 'type': 'continuous', 'range': {'min': 0, 'max': 10},
                               'encodingRange': {'min': 0, 'max': 254 / 255}, 'noDataValue': 255}]
            }
            (directory / 'metadata.json').write_text(json.dumps(metadata))
            reference = {'checks': [
                {'variable': 7, 'indices': [1, 0, 0], 'coordinates': [13, 21, -3], 'value': 10},
                {'variable': 7, 'indices': [2, 0, 0], 'coordinates': [15, 21, -3], 'missing': True},
                {'variable': 7, 'indices': [0, 0, 1], 'coordinates': [11, 21, -1], 'value': 5}
            ]}
            self.assertEqual(validator.validate_dataset(directory, reference)['checked'], 3)
            reference['checks'][0]['indices'] = [0, 1, 0]
            with self.assertRaisesRegex(ValueError, 'coordinates do not match'):
                validator.validate_dataset(directory, reference)
            reference['checks'][0]['indices'] = [1, 0, 0]
            reference['checks'][0]['value'] = 0
            with self.assertRaisesRegex(ValueError, 'expected 0'):
                validator.validate_dataset(directory, reference)
            (directory / 'v.raw').write_bytes(bytes([1]) + raw[1:])
            with self.assertRaisesRegex(ValueError, 'checksum'):
                validator.validate_dataset(directory, reference)
            (directory / 'v.raw').write_bytes(raw[:-1])
            with self.assertRaisesRegex(ValueError, 'byte count'):
                validator.validate_dataset(directory, reference)
