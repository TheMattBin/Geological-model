# Geological Volume Explorer

An interactive React + Three.js WebGL2 viewer for voxel geology. The bundled **synthetic** example contains undulating strata, an inclined fault with displaced layers, and correlated relative permeability. It is not a surveyed Hong Kong dataset.

Features include categorical lithology, continuous volume rendering, class/fault visibility, labeled geological axes, a horizontal scale bar, two section cuts, vertical exaggeration, and continuous-variable isosurfaces. Drag to orbit, right-drag to pan, and scroll to zoom.

## Explore and share

- **Inspect:** click the model to report the first visible voxel along the ray. The result includes its stored value or class, zero-based X/Y/Z indices, and physical cell-center coordinates. Cuts, missing data, hidden classes/faults, opacity, and value filters are respected. At an isosurface, inspection reports the voxel at the first sampled crossing; it is not an interpolated surface measurement.
- **Measure:** N–S and W–E sliders show physical coordinates as well as percentages. Zero hides the entire clipped volume; 100% restores that axis. Coordinates and the horizontal scale bar use original dataset units and are independent of vertical exaggeration. Toggle the grid to show/hide the ground, axes and scale together.
- **Filter continuous data:** adjust opacity and the minimum/maximum value window. The histogram describes the entire active variable, excluding missing values; clipping does not recompute it. Computation runs in a cancellable worker with 1 MiB chunks, keeping the UI responsive and preserving the renderer buffer. Isosurfaces also respect the value window.
- **Navigate:** use Reset camera, Top, Front (looking north), and Side (looking west) presets. On narrow screens, open the Legend & explore or Visualization controls panel from the toolbar.
- **2D sections:** open **2D sections** in Explore for synchronized N–S and W–E cell maps. N–S holds X constant and shows Y horizontally; W–E holds Y constant and shows X horizontally. Elevation increases upward. Each map preserves physical proportions with the current vertical exaggeration and reports original cell-center coordinates. Click/tap a cell or focus the map and use arrow keys (Home/End for corners). The section sliders, selected variable and exaggeration update the 3D controls and saved view. At a cell boundary the map selects the cell on the positive side; the 100% endpoint selects the final cell. The requested plane and sampled cell center are both shown.
- Section maps apply class/fault visibility and the continuous value window. Volume opacity and isosurfaces affect the 3D rendering only. Checkerboard cells can be missing, filtered, unmapped or transparent; inspection distinguishes missing values from valid class zero. Each map shows its complete plane, independently of the other section cut or the 3D cut visibility switch. Drawing reuses loaded CPU data, yields in bounded batches for large maps, and cancels when controls change or the dialog closes.
- **Export sections:** each 2D map has **Export PNG** and **Export CSV** buttons. PNGs ([example](docs/images/section-export.png)) include axes and units, requested plane and sampled cell center, displayed exaggeration, legend, filters, provenance, dataset fingerprint and synthetic disclosure. CSVs contain every section cell, including filtered and missing cells, with original indices/coordinates, raw and decoded values, labels, status, units and provenance. Missing decoded values are empty; valid zero stays zero. Rows run from highest to lowest Z, then left to right. Coordinates and values retain numeric precision; metadata text is CSV-quoted and formula-like text receives a leading apostrophe for spreadsheet safety. Exports cancel when the section/variable/filter/exaggeration changes or the dialog closes; CSV preparation also has a Cancel button and a 64 MiB size limit.
- **Share view:** save the camera, variable, sections, exaggeration, continuous controls, class visibility and display switches into the URL fragment. The app copies the link where clipboard access is available; otherwise copy the address bar. Open/reload that URL to restore it. Links include the dataset path and a SHA-256 fingerprint of metadata and raw-file checksums. Restoration waits for a matching identity; changed datasets, invalid links and older version-1 links fall back to defaults with a notice. Links do not embed data. Sharing requires checksummed metadata produced by the converter; older datasets still load, but must be reconverted before sharing. Checksummed datasets require HTTPS or localhost.
- **Export PNG:** download the rendered scene with a legend, section percentages, exaggeration, continuous settings and synthetic/source disclosure. Export remains available when the on-screen legend is hidden.

Inspection returns stored voxel values. Continuous rendering can interpolate between those values, and isosurface inspection is approximate at voxel resolution.

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

Create a Python 3.11+ environment for data tools (CI uses 3.12):

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
python scripts/convert_netcdf.py input.nc --output-dir public/custom-data --coordinate-system "EPSG:2326"
```

`--coordinate-system` records the source projected CRS; it does not reproject coordinates. Omit it if unknown and the metadata explicitly records that uncertainty. The converter records the source filename and conversion settings without private absolute paths.

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

The version 1 [JSON schema](public/metadata.schema.json) supports editor validation. Runtime validation additionally checks ordered ranges, unique identifiers and palette positions, missing-value collisions, and safe byte counts. Errors identify the offending metadata field before any raw files are fetched. Legacy files without `schemaVersion` use version 1 semantics; new conversions explicitly write version 1.

Metadata defines:

- `schemaVersion`: currently `1`.
- `coordinateUnit`: physical coordinate unit, independent of variable units. Omitted legacy units display as “units”.
- `provenance`: optional `source`, `coordinateSystem`, and `conversion` text.
- `dimensions`: voxel counts `{x, y, z}`.
- `bounds`: cell-edge `{min, max}` for each axis, in a common physical unit.
- `synthetic` and `description`: dataset disclosure and descriptive text.
- `variables`: unique IDs, names, files, dtype, `discrete`/`continuous` type, optional units and range, and colormap.
- Discrete colormap entries: `value`, `label`, RGBA `color`, optional `enabled`, and optional `role: "fault"`. Values need not be consecutive.
- Continuous colormap entries: normalized `position` and RGBA `color`.
- Optional `noDataValue`: missing-value sentinel in raw units. Optional `encodingRange`: the valid interval after uint8 texture normalization; converted continuous data uses `[0, 254/255]`.

Missing-value textures use nearest sampling to prevent sentinel values blending into valid measurements. All display colors use sRGB. Categorical values remain categorical; continuous opacity is corrected for sample spacing. The renderer uses Z-up, with N–S cuts at constant X and W–E cuts at constant Y.

## Loading and device limits

Only the initial selected variable downloads at startup. A saved selection is used only after metadata identity verification; mismatched links load the default variable. Other variables load on demand with byte progress and cancellation; cached revisits avoid network requests. Failed loads offer a retry. The cache retains at most 256 MiB of raw variable data, evicting least recently used inactive entries. CPU data is retained for inspection and histograms, and uploaded variables also require GPU memory; changing variables can temporarily exceed the cache target while a new download completes.

Before downloading data, the viewer checks the device's maximum 3D texture dimension and rejects variables larger than 256 MiB each with a downsampling message. Continuous float32 interpolation also requires device support. These are conservative application limits, not a guarantee that a device has enough free GPU memory. On WebGL context loss the viewer pauses rendering and offers a reload; automatic restoration re-uploads retained textures and requests a fresh frame while preserving camera and filters. The viewer still uses whole-volume textures, not tiled/streamed bricks. Hardware performance needs testing on representative datasets and devices.

## Structure and deployment

`src/App/` owns typed shared application state and saved views, `src/components/` contains controls and the scene wrapper, and `src/three/` contains renderer, shaders, loader, and types. Static datasets live under `public/data/`; the converter is `scripts/convert_netcdf.py`.

Deploy `dist/` to static hosting after `npm run build`, or build the supplied Dockerfile:

```bash
docker build -t geological-model .
docker run --rm -p 8080:80 geological-model
```

The `CI` workflow runs on pull requests and pushes to `main`. Application checks, Python conversion tests, and development renderer tests run in parallel. Python 3.12 runs the converter and checkpoint tests against both minimum supported versions (`scripts/constraints-minimum.txt`) and current compatible releases. Keep the minimum constraints aligned with `scripts/requirements.txt`. The application job builds once; production smoke and visual tests download that artifact and serve it under `/Geological-model/` to catch project-path asset failures. The `CI passed` job succeeds only when every validation job succeeds. Superseded PR runs are cancelled; main runs do not cancel an active deployment.

After successful validation on `main`, GitHub Pages receives the same build artifact. A final smoke test checks the deployed commit through `revision.json`, both dataset variables, saved-view restoration, and PNG export. A failed deployment check is visible as a failed workflow; it does not automatically roll back the site. To roll back, revert the offending commit and let CI validate and deploy the revert.

Repository setup is required once:

- In **Settings → Pages**, choose **GitHub Actions** as the build source.
- Configure the `github-pages` environment to allow deployments only from `main`.
- In the `main` branch ruleset, require the **CI passed** status check. Remove requirements for the retired `Build React App`, `Code Quality`, and `Bundle Analysis` checks if configured. Required checks apply to PR merges; restricting direct pushes requires a corresponding branch rule.

These settings live on GitHub and are not applied by editing workflow files. PRs validate the build but cannot deploy. Validation jobs have read-only repository permissions; only the deployment job receives Pages and OIDC write permissions. Actions use full commit pins. Weekly grouped Dependabot updates cover npm, Python, and GitHub Actions; the overlapping scheduled updater has been removed. Dependency audits never automatically rewrite dependency versions during validation.

To reproduce the production checks locally, use the Node version in `.nvmrc`:

```bash
npm ci
npm test
npm run typecheck
npm run build
npm run check:bundle
npx playwright install chromium
npm run test:browser
npm run test:production
npm run test:visual
```

The bundle gate sums gzip level-9 sizes of all JavaScript and CSS assets, including lazy chunks. Budgets in `bundle-budget.json` are 240 KiB JavaScript and 4 KiB CSS; the initial measured build is approximately 217 KiB and 2.6 KiB respectively. Budget increases should be intentional and explained in review. Results go to the Actions job summary, so fork PRs need no comment-write permission.

Visual baselines in `tests/visual/baselines/` cover lithology, section cuts, permeability, the mobile model, and both 2D section maps. They use Chromium from the lockfile, SwiftShader, fixed viewports, and device scale 1. The model comparisons hide UI overlays and disable axis labels to avoid Linux font differences; mobile controls are checked separately for visibility and interaction. Generate baselines on Linux with `npm run test:visual -- --update-snapshots`, inspect every changed image, and commit intentional changes. CI never regenerates baselines. Browser upgrades may require reviewed baseline updates; software WebGL checks correctness, not hardware performance.

Browser failures retain screenshots and traces in `test-results/`; HTML reports are in `playwright-report/`. CI uploads these for seven days, including visual diffs. Open a trace with `npx playwright show-trace <trace.zip>`. To smoke-test an existing deployment, set `PLAYWRIGHT_BASE_URL=https://your-host/project/` when running `npm run test:production`; optionally set `EXPECTED_REVISION` to require an exact commit. The revision check is skipped locally unless that variable is set.

Development conventions are in [AGENTS.md](AGENTS.md).

### Browser and accessibility checks

Legend buttons keep their text on a dark background with separate metadata-colored swatches
([viewer screenshot](docs/images/viewer-accessibility.png)); hidden classes have struck-through labels.
The 3D canvas has an accessible name and directs keyboard users to camera presets and section cell inspection.

Run `npm run build`, `npx playwright install --with-deps chromium firefox webkit`, then `npm run test:compatibility`.
Select one engine with `-- --project=firefox` (or `chromium` / `webkit`). The suite exercises the production build at the
deployment subpath: both variables, saved views, section endpoints, PNG/CSV downloads, keyboard controls, dialog focus
containment/restoration, mobile panel navigation and the WebGL failure/retry path. A missing WebGL2 context fails the
normal viewer tests; it is never treated as a passing compatibility check.

Each engine runs axe WCAG 2.1 A/AA checks on the desktop controls, mobile panels, both section variables and graphics
error state. Full axe results (including checks needing manual review), screenshots and failure traces are retained
with the CI artifacts. These checks detect common accessibility defects; they do not establish full conformance,
screen-reader usability, Safari/iOS compatibility or hardware performance. Manually check VoiceOver/Safari and
NVDA/Firefox announcements, focus visibility, zoom and touch behavior on target devices before claiming support.
CI requires all three browser jobs before deployment and uses the same build artifact as the other production tests.

Python Dependabot routine version PRs are disabled because the requirements already allow current compatible releases.
Minimum-version constraints are deliberate compatibility tests. Dependabot security updates remain enabled and are
not affected by `open-pull-requests-limit: 0`, as described in the
[GitHub security-update documentation](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-security-updates).
CI still tests minimum and current Python dependencies. Raise a minimum when a required fix or feature justifies it;
review major-version upper bounds explicitly. npm and GitHub Actions version updates remain enabled.

### Dataset acceptance and hardware profiling

Use the [checkpoint validation and hardware profiling procedure](docs/dataset-validation.md) before claiming real-model accuracy or hardware performance. `python scripts/validate_dataset.py DATASET REFERENCE.json` checks raw sizes, checksums, physical cell centers, missing data and independently supplied expected values without modifying the dataset. Real survey acceptance and hardware measurements remain pending until approved inputs and target devices are available.

The minimum netCDF4 version is 1.7.1.post2: [1.7.0](https://pypi.org/project/netCDF4/1.7.0/) and [1.7.1](https://pypi.org/project/netCDF4/1.7.1/) were withdrawn. TypeScript 7 uses relative alias paths without the removed `baseUrl` option.
