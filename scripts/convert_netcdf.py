#!/usr/bin/env python3
"""
NetCDF to Web-friendly Binary Converter for Geological Voxel Data

Converts NetCDF voxel data to binary format (.raw) with JSON metadata
for use with Three.js 3D textures.

Usage:
    python convert_netcdf.py input.nc --output-dir ./public/data

Output:
    - lithology.raw: Binary uint8 array of lithology values
    - permeability.raw: Binary uint8 array of permeability values
    - metadata.json: Volume dimensions, bounds, and color mapping
"""

import argparse
import json
import os
import struct
from pathlib import Path

import numpy as np

# netCDF4 is only required for actual conversion, not sample generation
try:
    import netCDF4 as nc
    HAS_NETCDF = True
except ImportError:
    HAS_NETCDF = False


def load_netcdf(filepath: str) -> dict:
    """Load NetCDF file and extract voxel data."""
    if not HAS_NETCDF:
        raise ImportError("netCDF4 not installed. Install with: pip install netCDF4")

    aliases = {
        'x': {'x', 'easting'},
        'y': {'y', 'northing'},
        'z': {'z', 'elevation', 'depth'},
    }
    result = {'dimensions': {}, 'variables': {}, 'bounds': {}}
    with nc.Dataset(filepath, 'r') as dataset:
        for name, var in dataset.variables.items():
            if len(var.shape) < 3:
                continue
            if len(var.shape) != 3:
                raise ValueError(f'{name}: select a single 3D volume before conversion')
            axes = {}
            for axis, names in aliases.items():
                matches = [dim for dim in var.dimensions if dim.lower() in names]
                if len(matches) != 1:
                    raise ValueError(f'{name}: expected projected x/easting, y/northing, z/elevation/depth dimensions')
                axes[axis] = matches[0]
            order = [var.dimensions.index(axes[axis]) for axis in ('z', 'y', 'x')]
            values = np.ma.masked_invalid(np.ma.asarray(var[:], dtype=np.float64)).transpose(order)
            for index, axis in enumerate(('z', 'y', 'x')):
                dim = axes[axis]
                coordinate = dataset.variables.get(dim)
                centers = np.arange(values.shape[index], dtype=float)
                if coordinate is not None:
                    centers = np.asarray(coordinate[:], dtype=float)
                    units = getattr(coordinate, 'units', 'm').lower()
                    if units in ('km', 'kilometers', 'kilometres'):
                        centers *= 1000
                    elif units not in ('m', 'meters', 'metres', 'meter', 'metre'):
                        raise ValueError(f'{dim}: coordinates must use metres or kilometres')
                    if axis == 'z' and (dim.lower() == 'depth' or getattr(coordinate, 'positive', '').lower() == 'down'):
                        centers = -centers
                if centers.ndim != 1 or not np.isfinite(centers).all():
                    raise ValueError(f'{dim}: invalid coordinate values')
                if len(centers) > 1:
                    spacing = np.diff(centers)
                    if spacing[0] == 0 or not np.allclose(spacing, spacing[0], rtol=1e-4, atol=1e-8):
                        raise ValueError(f'{dim}: resample to a regular coordinate grid before conversion')
                    if spacing[0] < 0:
                        centers = centers[::-1]
                        values = np.flip(values, axis=index)
                    cell = abs(spacing[0])
                else:
                    cell = 1.0
                bounds = {'min': float(centers[0] - cell / 2), 'max': float(centers[-1] + cell / 2)}
                if axis in result['bounds'] and result['bounds'][axis] != bounds:
                    raise ValueError('All variables must share the same coordinate grid')
                result['bounds'][axis] = bounds
            if result['variables'] and values.shape != next(iter(result['variables'].values()))['shape']:
                raise ValueError('All variables must share the same voxel dimensions')
            result['variables'][name] = {
                'data': values,
                'shape': values.shape,
                'dtype': str(var.dtype),
                'units': getattr(var, 'units', None),
                'long_name': getattr(var, 'long_name', name),
            }
    return result


def normalize_to_uint8(data: np.ndarray) -> tuple[np.ndarray, float, float]:
    """Normalize finite data to [0, 254], reserving 255 for missing voxels."""
    values = np.ma.masked_invalid(np.ma.asarray(data, dtype=np.float64))
    if values.count() == 0:
        raise ValueError('Continuous variable contains no valid voxels')
    min_val, max_val = float(values.min()), float(values.max())
    normalized = np.ma.zeros(values.shape) if max_val == min_val else (values - min_val) / (max_val - min_val) * 254
    # Reserve 255 for missing voxels, preserving valid zero measurements.
    result = np.asarray(normalized.filled(0) if np.ma.isMaskedArray(normalized) else normalized, dtype=np.uint8)
    result[np.ma.getmaskarray(values)] = 255
    return result, min_val, max_val


def generate_lithology_colormap(num_classes: int) -> list[dict]:
    """Generate default colormap for lithology (discrete) values."""
    # Default geological colors
    default_colors = [
        {"label": "Clay", "color": [139, 90, 43, 255]},      # Brown
        {"label": "Sand", "color": [255, 223, 128, 255]},     # Yellow
        {"label": "Gravel", "color": [169, 169, 169, 255]},   # Gray
        {"label": "Silt", "color": [194, 178, 128, 255]},     # Tan
        {"label": "Rock", "color": [105, 105, 105, 255]},     # Dark gray
        {"label": "Limestone", "color": [230, 230, 250, 255]}, # Lavender
        {"label": "Granite", "color": [255, 182, 193, 255]},  # Pink
        {"label": "Sandstone", "color": [244, 164, 96, 255]}, # Sandy brown
        {"label": "Shale", "color": [112, 128, 144, 255]},    # Slate gray
        {"label": "Basite", "color": [47, 79, 79, 255]},      # Dark slate
    ]

    colormap = []
    for i in range(num_classes):
        if i < len(default_colors):
            entry = default_colors[i].copy()
        else:
            # Generate random color for additional classes
            np.random.seed(i)
            entry = {
                "label": f"Class {i}",
                "color": [int(np.random.randint(50, 255)) for _ in range(3)] + [255]
            }
        entry["value"] = i
        colormap.append(entry)

    return colormap


def generate_continuous_colormap() -> list[dict]:
    """Generate colormap for continuous data (e.g., permeability)."""
    return [
        {'position': 0.0, 'color': [68, 1, 84, 255]},
        {'position': 0.25, 'color': [59, 82, 139, 255]},
        {'position': 0.5, 'color': [33, 145, 140, 255]},
        {'position': 0.75, 'color': [94, 201, 98, 255]},
        {'position': 1.0, 'color': [253, 231, 37, 255]},
    ]


def save_binary(data: np.ndarray, filepath: str, dtype: str = 'uint8'):
    """Save numpy array as binary file."""
    if dtype == 'uint8':
        data = data.astype(np.uint8)
    elif dtype == 'float32':
        data = data.astype(np.float32)

    # Ensure C-contiguous array order (Z, Y, X for 3D textures)
    data = np.ascontiguousarray(data)

    with open(filepath, 'wb') as f:
        f.write(data.tobytes())

    print(f"Saved: {filepath} ({os.path.getsize(filepath) / 1024 / 1024:.2f} MB)")


def convert_netcdf(input_path: str, output_dir: str, lithology_var: str = None, permeability_var: str = None):
    """Main conversion function."""
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    # Load NetCDF data
    data = load_netcdf(input_path)

    if not data['variables']:
        raise ValueError('No 3D variables found in NetCDF file')

    # Auto-detect variable names if not provided
    var_names = list(data['variables'].keys())

    if lithology_var is None:
        for name in ['lithology', 'lith', 'rock_type', 'class']:
            if name in var_names:
                lithology_var = name
                break

    if permeability_var is None:
        for name in ['permeability', 'perm', 'k', 'conductivity']:
            if name in var_names:
                permeability_var = name
                break

    if not lithology_var and not permeability_var:
        raise ValueError('Specify --lithology-var or --permeability-var for unrecognized variables')
    for requested in (lithology_var, permeability_var):
        if requested and requested not in var_names:
            raise ValueError(f'Variable not found: {requested}')

    metadata = {
        'dimensions': {},
        'bounds': data['bounds'],
        'synthetic': False,
        'description': Path(input_path).name,
        'variables': [],
    }

    # Process lithology (discrete)
    if lithology_var and lithology_var in data['variables']:
        var_data = data['variables'][lithology_var]
        lith_data = var_data['data']

        # Get dimensions in Z, Y, X order
        shape = lith_data.shape
        metadata['dimensions'] = {
            'z': int(shape[0]),
            'y': int(shape[1]),
            'x': int(shape[2]),
        }

        valid = ~np.ma.getmaskarray(lith_data)
        unique_values = np.unique(lith_data.compressed())
        num_classes = len(unique_values)
        if num_classes == 0 or num_classes > 255 or not np.all(unique_values == np.floor(unique_values)):
            raise ValueError('Lithology requires 1–255 integer classes; 255 is reserved for missing data')
        encoded = np.full(lith_data.shape, 255, dtype=np.uint8)
        encoded[valid] = np.searchsorted(unique_values, lith_data.data[valid])
        lith_data = encoded
        colors = generate_lithology_colormap(num_classes)
        for color, original in zip(colors, unique_values):
            color['label'] = f'Class {int(original)}'
            color['sourceValue'] = int(original)

        save_binary(lith_data, output_path / 'lithology.raw', 'uint8')

        metadata['variables'].append({
            'id': 0,
            'name': 'Lithology',
            'file': 'lithology.raw',
            'dtype': 'uint8',
            'type': 'discrete',
            'numClasses': int(num_classes),
            'colormap': colors,
            'noDataValue': 255,
        })
        print(f"Processed lithology: {num_classes} classes")

    # Process permeability (continuous)
    if permeability_var and permeability_var in data['variables']:
        var_data = data['variables'][permeability_var]
        perm_data = var_data['data'].astype(np.float32)

        # Update dimensions if not set
        if not metadata['dimensions']:
            shape = perm_data.shape
            metadata['dimensions'] = {
                'z': int(shape[0]),
                'y': int(shape[1]),
                'x': int(shape[2]),
            }

        # Normalize to uint8 for texture
        perm_normalized, min_val, max_val = normalize_to_uint8(perm_data)
        save_binary(perm_normalized, output_path / 'permeability.raw', 'uint8')

        metadata['variables'].append({
            'id': 1,
            'name': 'Permeability',
            'file': 'permeability.raw',
            'dtype': 'uint8',
            'type': 'continuous',
            'unit': var_data.get('units', 'md'),
            'range': {'min': min_val, 'max': max_val},
            'encodingRange': {'min': 0, 'max': 254 / 255},
            'noDataValue': 255,
            'colormap': generate_continuous_colormap(),
        })
        print(f"Processed permeability: range [{min_val:.4f}, {max_val:.4f}]")

    # Save metadata
    metadata_path = output_path / 'metadata.json'
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"Saved: {metadata_path}")

    print("\nConversion complete!")
    print(f"Volume dimensions: {metadata['dimensions']}")


def create_sample_data(output_dir: str):
    """Create sample voxel data for testing (when no NetCDF is available)."""
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    dim_x, dim_y, dim_z = 64, 48, 40
    rng = np.random.default_rng(2026)
    z, y, x = np.meshgrid(
        np.linspace(0, 1, dim_z), np.linspace(0, 1, dim_y), np.linspace(0, 1, dim_x), indexing='ij'
    )
    # Undulating strata, displaced across an inclined fault plane.
    fault_plane = 0.48 + 0.22 * (z - 0.5) + 0.05 * np.sin(y * 2 * np.pi)
    displacement = np.where(x > fault_plane, 0.13, 0.0)
    stratigraphic_height = z + 0.09 * np.sin(x * 2 * np.pi) * np.cos(y * np.pi) + displacement
    lithology = np.clip(np.floor(stratigraphic_height * 4), 0, 3).astype(np.uint8)
    fault = np.abs(x - fault_plane) < 0.018
    lithology[fault] = 4
    save_binary(lithology, output_path / 'lithology.raw', 'uint8')

    # Correlated synthetic permeability: permeable sand and fractured fault zones.
    permeability = np.array([0.08, 0.8, 0.55, 0.18, 0.95])[lithology]
    permeability += 0.06 * np.sin(x * 3 * np.pi) * np.cos(y * 2 * np.pi)
    permeability += rng.normal(0, 0.015, lithology.shape)
    perm_uint8 = np.round(np.clip(permeability, 0, 1) * 255).astype(np.uint8)
    save_binary(perm_uint8, output_path / 'permeability.raw', 'uint8')

    # Create metadata
    metadata = {
        'synthetic': True,
        'description': 'Synthetic folded strata with an inclined fault and displaced layers. Drag to orbit; scroll to zoom.',
        'dimensions': {'x': dim_x, 'y': dim_y, 'z': dim_z},
        'bounds': {
            'x': {'min': 0, 'max': 1200},
            'y': {'min': 0, 'max': 900},
            'z': {'min': -600, 'max': 0},
        },
        'variables': [
            {
                'id': 0,
                'name': 'Lithology',
                'file': 'lithology.raw',
                'dtype': 'uint8',
                'type': 'discrete',
                'numClasses': 5,
                'colormap': [
                    {'value': 0, 'label': 'Clay', 'color': [139, 90, 43, 255]},
                    {'value': 1, 'label': 'Sand', 'color': [255, 223, 128, 255]},
                    {'value': 2, 'label': 'Gravel', 'color': [169, 169, 169, 255]},
                    {'value': 3, 'label': 'Silt', 'color': [194, 178, 128, 255]},
                    {'value': 4, 'label': 'Fault', 'role': 'fault', 'color': [203, 75, 61, 255]},
                ]
            },
            {
                'id': 1,
                'name': 'Permeability',
                'file': 'permeability.raw',
                'dtype': 'uint8',
                'type': 'continuous',
                'unit': 'relative',
                'range': {'min': 0, 'max': 1},
                'colormap': generate_continuous_colormap(),
            }
        ]
    }

    with open(output_path / 'metadata.json', 'w') as f:
        json.dump(metadata, f, indent=2)

    print(f"Sample data created in {output_path}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Convert NetCDF voxel data to web-friendly format')
    parser.add_argument('input', nargs='?', help='Input NetCDF file path')
    parser.add_argument('--output-dir', '-o', default='./public/data', help='Output directory')
    parser.add_argument('--lithology-var', help='Name of lithology variable in NetCDF')
    parser.add_argument('--permeability-var', help='Name of permeability variable in NetCDF')
    parser.add_argument('--sample', action='store_true', help='Generate sample test data')

    args = parser.parse_args()

    if args.sample:
        create_sample_data(args.output_dir)
    elif args.input:
        convert_netcdf(args.input, args.output_dir, args.lithology_var, args.permeability_var)
    else:
        print("Usage: python convert_netcdf.py <input.nc> --output-dir ./public/data")
        print("   or: python convert_netcdf.py --sample --output-dir ./public/data")
