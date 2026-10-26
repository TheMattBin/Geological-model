"""Read-only checks of converted volumes against independently supplied checkpoints."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct


def validate_dataset(directory: Path, reference: dict) -> dict:
    directory = directory.resolve()
    metadata = json.loads((directory / 'metadata.json').read_text())
    dimensions = [metadata['dimensions'][axis] for axis in 'xyz']
    if any(type(n) is not int or n < 1 for n in dimensions):
        raise ValueError('Dimensions must be positive integers')
    checks = reference.get('checks')
    if not isinstance(checks, list) or not checks:
        raise ValueError('Provide at least one independently verified checkpoint')
    variables = {v['id']: v for v in metadata['variables']}
    paths = {}
    for variable in variables.values():
        path = (directory / variable['file']).resolve()
        if not path.is_relative_to(directory):
            raise ValueError('Variable file must be inside the dataset directory')
        if variable['dtype'] not in ('uint8', 'float32'):
            raise ValueError('Unsupported dtype')
        expected = math.prod(dimensions) * (4 if variable['dtype'] == 'float32' else 1)
        if path.stat().st_size != expected:
            raise ValueError(f"{variable['name']}: incorrect raw byte count")
        with path.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        if variable.get('sha256') != digest:
            raise ValueError(f"{variable['name']}: missing or incorrect checksum; reconvert the dataset")
        paths[variable['id']] = path
    results = []
    for number, check in enumerate(checks, 1):
        variable = variables[check['variable']]
        indices = check['indices']
        if (not isinstance(indices, list) or len(indices) != 3
                or any(type(n) is not int or not 0 <= n < dimensions[i] for i, n in enumerate(indices))):
            raise ValueError(f'Checkpoint {number}: indices must be in-bounds [x, y, z]')
        coordinates = [
            metadata['bounds'][axis]['min'] + (indices[i] + 0.5) / dimensions[i]
            * (metadata['bounds'][axis]['max'] - metadata['bounds'][axis]['min'])
            for i, axis in enumerate('xyz')
        ]
        expected_coordinates = check['coordinates']
        if (len(expected_coordinates) != 3 or any(
                not math.isclose(actual, expected, rel_tol=0, abs_tol=1e-6)
                for actual, expected in zip(coordinates, expected_coordinates))):
            raise ValueError(f'Checkpoint {number}: physical cell-center coordinates do not match')
        x, y, z = indices
        offset = (z * dimensions[1] + y) * dimensions[0] + x
        fmt = '<f' if variable['dtype'] == 'float32' else 'B'
        size = struct.calcsize(fmt)
        with paths[variable['id']].open('rb') as stream:
            stream.seek(offset * size)
            raw = struct.unpack(fmt, stream.read(size))[0]
        sentinel = variable.get('noDataValue')
        if sentinel is not None and variable['dtype'] == 'float32':
            sentinel = struct.unpack('<f', struct.pack('<f', sentinel))[0]
        missing = not math.isfinite(raw) or raw == sentinel
        value = raw
        if not missing and variable['dtype'] == 'uint8' and variable['type'] == 'continuous':
            encoding = variable.get('encodingRange', {'min': 0, 'max': 1})
            limits = variable.get('range', {'min': 0, 'max': 1})
            fraction = max(0, min(1, (raw / 255 - encoding['min']) / (encoding['max'] - encoding['min'])))
            value = limits['min'] + fraction * (limits['max'] - limits['min'])
        if check.get('missing', False):
            if not missing:
                raise ValueError(f'Checkpoint {number}: expected missing data')
        else:
            tolerance = check.get('tolerance', 0)
            if not math.isfinite(tolerance) or tolerance < 0:
                raise ValueError(f'Checkpoint {number}: tolerance must be finite and nonnegative')
            if missing or not math.isclose(value, check['value'], rel_tol=0, abs_tol=tolerance):
                raise ValueError(f'Checkpoint {number}: expected {check["value"]}, got {None if missing else value}')
        results.append({'checkpoint': number, 'value': None if missing else value, 'coordinates': coordinates})
    return {'synthetic': metadata.get('synthetic', False), 'checked': len(results), 'results': results}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dataset', type=Path)
    parser.add_argument('reference', type=Path, help='JSON with independently verified checkpoints')
    args = parser.parse_args()
    try:
        print(json.dumps(validate_dataset(args.dataset, json.loads(args.reference.read_text())), indent=2))
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(1, f'Validation failed: {error}\n')
