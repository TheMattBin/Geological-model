import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

import netCDF4
import numpy as np

spec = importlib.util.spec_from_file_location('converter', Path(__file__).parents[1] / 'scripts/convert_netcdf.py')
converter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(converter)


class ConversionTests(unittest.TestCase):
    def test_sample_is_repeatable_and_contains_displaced_layers(self):
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            converter.create_sample_data(first)
            converter.create_sample_data(second)
            for name in ('metadata.json', 'lithology.raw', 'permeability.raw'):
                self.assertEqual(Path(first, name).read_bytes(), Path(second, name).read_bytes())
            metadata = json.loads(Path(first, 'metadata.json').read_text())
            dims = metadata['dimensions']
            data = np.fromfile(Path(first, 'lithology.raw'), dtype=np.uint8).reshape(dims['z'], dims['y'], dims['x'])
            self.assertTrue(metadata['synthetic'])
            self.assertNotEqual(dims['x'], dims['y'])
            self.assertGreater(len(np.unique(data[dims['z'] // 2][data[dims['z'] // 2] != 4])), 1)

    def test_missing_values_are_distinct_from_valid_zero(self):
        data, minimum, maximum = converter.normalize_to_uint8(np.ma.array([0., 10., 2., np.nan], mask=[0, 0, 1, 0]))
        np.testing.assert_array_equal(data, [0, 254, 255, 255])
        self.assertEqual((minimum, maximum), (0, 10))
        constant, _, _ = converter.normalize_to_uint8(np.ma.array([3., 3.], mask=[0, 1]))
        np.testing.assert_array_equal(constant, [0, 255])

    def test_named_axes_are_transposed_and_depth_is_reversed(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory, 'input.nc')
            values = np.arange(24).reshape(3, 2, 4)
            with netCDF4.Dataset(source, 'w') as dataset:
                for name, coords in [('easting', [2, 1, 0]), ('northing', [10, 20]), ('depth', [0, 1, 2, 3])]:
                    dataset.createDimension(name, len(coords))
                    coordinate = dataset.createVariable(name, 'f8', (name,))
                    coordinate.units = 'm'
                    coordinate[:] = coords
                variable = dataset.createVariable('lithology', 'i4', ('easting', 'northing', 'depth'), fill_value=-999)
                variable[:] = values
                variable[0, 0, 0] = -999
            loaded = converter.load_netcdf(source)
            expected = values[::-1, :, ::-1].transpose(2, 1, 0)
            actual = loaded['variables']['lithology']['data']
            np.testing.assert_array_equal(actual.compressed(), np.ma.array(expected, mask=np.ma.getmaskarray(actual)).compressed())
            self.assertEqual(actual.shape, (4, 2, 3))
            self.assertTrue(actual.mask[3, 0, 2])
            self.assertEqual(loaded['bounds']['z'], {'min': -3.5, 'max': 0.5})
            converter.convert_netcdf(source, directory)
            raw = np.fromfile(Path(directory, 'lithology.raw'), dtype=np.uint8).reshape(4, 2, 3)
            self.assertEqual(raw[3, 0, 2], 255)
            self.assertNotEqual(raw[0, 0, 0], 255)

    def test_continuous_only_input_and_irregular_coordinates(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory, 'permeability.nc')
            with netCDF4.Dataset(source, 'w') as dataset:
                for axis in ('x', 'y', 'z'):
                    dataset.createDimension(axis, 3)
                    coordinate = dataset.createVariable(axis, 'f8', (axis,))
                    coordinate[:] = [0, 1, 2]
                variable = dataset.createVariable('permeability', 'f4', ('z', 'y', 'x'))
                variable[:] = np.arange(27).reshape(3, 3, 3)
            converter.convert_netcdf(source, directory)
            metadata = json.loads(Path(directory, 'metadata.json').read_text())
            self.assertEqual([v['type'] for v in metadata['variables']], ['continuous'])
            self.assertEqual(metadata['variables'][0]['range'], {'min': 0., 'max': 26.})
            with netCDF4.Dataset(source, 'a') as dataset:
                dataset.variables['x'][:] = [0, 1, 3]
            with self.assertRaisesRegex(ValueError, 'regular coordinate grid'):
                converter.load_netcdf(source)


if __name__ == '__main__':
    unittest.main()
