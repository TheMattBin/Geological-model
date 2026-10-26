# Dataset and hardware acceptance

The bundled data and automated fixtures are synthetic. They do not establish agreement with a surveyed geological model. No real-data or hardware performance result is claimed by this procedure.

## Validate an approved dataset

Keep private input, converted data, checkpoints, and reports outside this repository. Convert using `scripts/convert_netcdf.py`, recording the coordinate system and units. The converter adds SHA-256 checksums for every raw file. A checksum detects a mismatched file, not an incorrect geological interpretation.

Obtain checkpoints independently from the survey/model owner or the source application's section exports. Do not generate expected values by reading the converted output. Cover the first and last cells, both sides of a fault, missing cells, valid class zero, extrema, and points along N–S (constant X) and W–E (constant Y) sections.

Save a reference JSON outside the repository using this format (the numbers below are illustrative, not survey observations):

```json
{
  "checks": [
    { "variable": 0, "indices": [1, 2, 3], "coordinates": [150, 250, -350], "value": 2 },
    { "variable": 1, "indices": [1, 2, 3], "coordinates": [150, 250, -350], "value": 0.25, "tolerance": 0.002 },
    { "variable": 1, "indices": [0, 0, 0], "coordinates": [50, 50, -650], "missing": true }
  ]
}
```

Indices are zero-based X/Y/Z, coordinates are physical cell centers before exaggeration, and continuous values are physical values. Use a tolerance justified by source precision and uint8 quantization (a converted continuous range has 254 intervals). Missing data must be declared explicitly. Float32 files use little-endian order.

```sh
python scripts/validate_dataset.py /path/to/converted /path/to/checkpoints.json > /path/to/report.json
```

The read-only command checks all raw byte counts and checksums, then checks cell centers, missing values and decoded values. It exits nonzero on a mismatch. This validates the listed checkpoints only. Review screenshots against independent section exports as well, with exaggeration 1, each variable, both section endpoints, fault/class visibility, and isosurfaces. Record the source version, conversion command, commit, checksums, reviewer and mismatches.

## Profile representative hardware

Use a production build on the target device with hardware WebGL enabled. Record browser/OS/GPU, viewport, device pixel ratio, dataset dimensions/dtypes, active variable, quality tier and commit. Verify that the browser is using the intended GPU; SwiftShader results are correctness checks only.

For a small, typical and largest supported dataset, record cold load and variable-switch time, cached revisit time, peak process memory, and a browser Performance trace during a repeatable 20-second orbit. Repeat three times after warm-up. Record median and 95th-percentile animation-frame intervals and long tasks; CPU submission duration is not GPU render time. Record GPU timings only if actually measured by a supported GPU profiling tool.

Check that histogram computation leaves controls responsive, switching cancels unfinished work, idle rendering stops, and a WebGL context loss/restoration preserves the view. Compare before/after traces on the same device. Set acceptance targets with the intended users before judging performance. Consider tiled loading only if measured memory or texture limits prevent representative workloads.

Until an approved dataset, independent checkpoints and target hardware are available, mark both acceptance results **pending**.
