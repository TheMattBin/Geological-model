# Repository Guidelines

## Architecture and data conventions

React owns UI state; `VolumeController` synchronizes it with the Three.js renderer after metadata loads. Keep GPU resources and render scheduling in `src/three/VolumeRenderer.ts`, texture loading in `dataLoader.ts`, and GLSL in `shaders.ts`.

- X is east, Y is north, and Z is elevation/up. Set camera up before constructing orbit controls. Vertical exaggeration scales only displayed Z.
- Binary volume order is Z/Y/X, with X changing fastest. Dimensions describe voxel counts; bounds describe physical cell edges in a common unit.
- N–S sections have constant X; W–E sections have constant Y. Section positions are normalized fractions of the original bounds, independent of exaggeration.
- Metadata is authoritative for variable IDs, names, ranges, units, colors, and fault classes (`role: 'fault'`). `src/config.js` selects the dataset path.
- Class values use nearest sampling. Continuous opacity must account for ray-step distance. Shader output and material blending both use premultiplied alpha; palette colors are sRGB.
- Reserve missing-data values explicitly in metadata. Never interpret a missing voxel as valid class zero. Converted uint8 continuous data uses 0–254, with 255 reserved for missing data; the bundled sample uses the full 0–255 range without a missing-data sentinel.
- The bundled dataset is synthetic. Preserve that disclosure when changing UI copy or sample generation. Never commit private datasets or credentials.

## Implementation

Use two spaces, semicolons, single quotes, and the 120-column print width in `.prettierrc.json`. Keep component styles in adjacent CSS modules and shared TypeScript interfaces in `src/three/types.ts`. Prefer the existing `@` and `@three` aliases.

Keep rendering demand-driven. Cancel pending initialization and fetches during cleanup; dispose textures, geometry, materials, controls, and observers. Use animation-frame intervals for frame cadence; CPU submission time is not GPU rendering time.

## Validation

Use the Node version in `.nvmrc` and `npm ci`. Run `npm test`, `npm run typecheck`, and `npm run build` for application changes.

For UI, shader, or loading changes, run `npm run test:browser` (install Chromium with `npx playwright install chromium` first). Review screenshots in `test-results/` and exercise both variables, section endpoints, class/fault visibility, grid, exaggeration, and isosurfaces. Software WebGL tests establish correctness, not hardware performance.

For converter or sample-data changes, install `scripts/requirements.txt` in a Python virtual environment and run `npm run test:data`. Confirm raw byte counts match metadata and sample regeneration is deterministic. Run browser tests after changing `public/data/`.

For dependency changes, run `npm audit --audit-level moderate`. Keep validation read-only with respect to dependency versions; update the lockfile deliberately.

## Commits and pull requests

Use short imperative conventional commits, such as `fix(renderer): correct section axes`. Pull requests should explain user-visible changes, link the relevant issue, include screenshots for visual changes, and report validation and limitations. Create an issue before opening a PR for a major change. Keep generated `dist/`, test results, and secrets out of commits.
