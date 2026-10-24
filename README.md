# Geological Volume Explorer

An interactive React + Three.js WebGL2 viewer for voxel geology. The bundled **synthetic** example contains undulating strata, an inclined fault with displaced layers, and correlated relative permeability. It is not a surveyed Hong Kong dataset.

Features include categorical lithology, continuous volume rendering, class/fault visibility, a ground grid, two section cuts, vertical exaggeration, and continuous-variable isosurfaces. Drag to orbit, right-drag to pan, and scroll to zoom.

## Development

Use Node 22 (`nvm use`), then:

```bash
npm ci
npm run dev
```

Open http://localhost:3000. A WebGL2-capable browser is required.

```bash
npm test               # Geometry and adaptive quality policy
npm run typecheck      # TypeScript renderer checks
npm run build          # Production bundle in dist/
npx playwright install chromium
npm run test:browser   # Actual WebGL rendering and UI regressions
npm run preview       # Serve the production build
```

Browser tests run with software WebGL for portability and save screenshots under `test-results/`. They do not measure hardware GPU performance. The development overlay reports animation-frame cadence while rendering is active.

## Sample and custom data

Create a Python environment for data tools:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r scripts/requirements.txt
npm run test:data
```

Regenerate the bundled deterministic example (this overwrites `public/data/`):

```bash
npm run convert-sample
```

Convert your own dataset into a separate directory:

```bash
python scripts/convert_netcdf.py input.nc --output-dir public/custom-data
```

Set `dataPath` in `src/config.js` to `./custom-data`. The variable controls and legends come from that dataset's `metadata.json`; no variable list needs to be maintained in application code.

The converter recognizes `lithology`/`lith`/`rock_type`/`class` and `permeability`/`perm`/`k`/`conductivity`. Use `--lithology-var NAME` or `--permeability-var NAME` for other names. A continuous-only dataset is supported. Imported class labels retain source codes; edit their labels/colors in metadata to supply the geological interpretation.

Input requirements:

- Each variable must be a single 3D array on the same regular grid. Select time/member dimensions and resample irregular data before conversion.
- Dimensions must identify projected X (`x`, `easting`), Y (`y`, `northing`), and Z (`z`, `elevation`, `depth`). Their order may vary; conversion transposes to Z/Y/X.
- Coordinates use metres or kilometres (metres are assumed when units are absent). Geographic longitude/latitude requires projection before conversion.
- Descending coordinates are reversed together with the data. Positive-down depth becomes increasing elevation. Coordinate centers are converted to cell-edge bounds.
- Masked/nonfinite voxels remain missing. Converted uint8 data reserves 255 for missing values; continuous data is quantized to 0–254. Original physical ranges are retained for legends and isosurface thresholds.

## Binary/metadata contract

A dataset contains `metadata.json` plus one raw file per variable. Raw arrays are contiguous Z/Y/X (X varies fastest). Byte length must exactly match the dimensions and dtype. Supported dtypes are `uint8` and `float32`; float32 continuous values require a physical `range`.

Metadata defines:

- `dimensions`: voxel counts `{x, y, z}`.
- `bounds`: cell-edge `{min, max}` for each axis, in a common physical unit.
- `synthetic` and `description`: dataset disclosure and descriptive text.
- `variables`: unique IDs, names, files, dtype, `discrete`/`continuous` type, optional units and range, and colormap.
- Discrete colormap entries: `value`, `label`, RGBA `color`, optional `enabled`, and optional `role: "fault"`. Values need not be consecutive.
- Continuous colormap entries: normalized `position` and RGBA `color`.
- Optional `noDataValue`: missing-value sentinel in raw units. Optional `encodingRange`: the valid interval after uint8 texture normalization; converted continuous data uses `[0, 254/255]`.

Missing-value textures use nearest sampling to prevent sentinel values blending into valid measurements. All display colors use sRGB. Categorical values remain categorical; continuous opacity is corrected for sample spacing. The renderer uses Z-up, with N–S cuts at constant X and W–E cuts at constant Y.

## Structure and deployment

`src/App/` owns shared application state, `src/components/` contains controls and the scene wrapper, and `src/three/` contains renderer, shaders, loader, and types. Static datasets live under `public/data/`; the converter is `scripts/convert_netcdf.py`.

Deploy `dist/` to static hosting after `npm run build`, or build the supplied Dockerfile:

```bash
docker build -t geological-model .
docker run --rm -p 8080:80 geological-model
```

CI runs unit tests, type checking, conversion tests, browser rendering checks, dependency audit, and a production build on Node 22. Development conventions are in [AGENTS.md](AGENTS.md).
