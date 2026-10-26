import * as THREE from 'three';
import type { DiscreteColor, VariableMetadata, VolumeMetadata, VoxelInspection } from './types';

import { isMissing, physicalValue } from './volumeValues';
export { isMissing, physicalValue, buildHistogram } from './volumeValues';

/** Exact voxel traversal in texture coordinates. Coordinates report original cell centers. */
export function inspectRay(
  ray: THREE.Ray,
  clip: THREE.Box3,
  metadata: VolumeMetadata,
  data: ArrayLike<number>,
  variable: VariableMetadata,
  visible: (raw: number, previous: number | null) => boolean
): VoxelInspection | null {
  const entry = ray.intersectBox(clip, new THREE.Vector3());
  if (!entry) return null;
  const point = clip.containsPoint(ray.origin) ? ray.origin.clone() : entry;
  point.addScaledVector(ray.direction, 1e-8);
  const dimensions = [metadata.dimensions.x, metadata.dimensions.y, metadata.dimensions.z];
  const origin = ray.origin.toArray();
  const direction = ray.direction.toArray();
  const cell = point.toArray().map((n, i) => Math.min(dimensions[i] - 1, Math.max(0, Math.floor(n * dimensions[i]))));
  const steps = direction.map(Math.sign);
  const delta = direction.map((d, i) => (d === 0 ? Infinity : Math.abs(1 / (d * dimensions[i]))));
  const next = direction.map((d, i) =>
    d === 0 ? Infinity : ((cell[i] + (d > 0 ? 1 : 0)) / dimensions[i] - origin[i]) / d
  );
  let previous: number | null = null;
  for (let count = 0; count < dimensions[0] + dimensions[1] + dimensions[2] + 3; count++) {
    if (!clip.containsPoint(point) || cell.some((c, i) => c < 0 || c >= dimensions[i])) break;
    const raw = data[(cell[2] * dimensions[1] + cell[1]) * dimensions[0] + cell[0]];
    if (!isMissing(raw, variable) && visible(raw, previous)) {
      const axes = ['x', 'y', 'z'] as const;
      return {
        indices: cell as [number, number, number],
        coordinates: axes.map(
          (axis, i) =>
            metadata.bounds[axis].min +
            ((cell[i] + 0.5) / dimensions[i]) * (metadata.bounds[axis].max - metadata.bounds[axis].min)
        ) as [number, number, number],
        value: physicalValue(raw, variable),
        unit: variable.unit,
        label:
          variable.type === 'discrete'
            ? (variable.colormap as DiscreteColor[]).find((c) => c.value === raw)?.label
            : undefined
      };
    }
    previous = isMissing(raw, variable) ? null : raw;
    const t = Math.min(...next);
    if (!Number.isFinite(t)) break;
    // Advance every tied axis so rays through edges do not visit zero-width cells.
    for (let i = 0; i < 3; i++)
      if (next[i] <= t + 1e-10) {
        cell[i] += steps[i];
        next[i] += delta[i];
      }
    point.copy(ray.at(t + 1e-8, new THREE.Vector3()));
  }
  return null;
}
