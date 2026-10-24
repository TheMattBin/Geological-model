import type { VolumeMetadata } from './types';

/** Validate untrusted JSON before fetching binary data or allocating GPU resources. */
export function parseMetadata(input: unknown): VolumeMetadata {
  const fail = (path: string, reason: string): never => {
    throw new Error(`Metadata ${path}: ${reason}`);
  };
  const object = (value: unknown, path: string): Record<string, any> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object');
    return value as Record<string, any>;
  };
  const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
  const text = (value: unknown, path: string) => {
    if (typeof value !== 'string' || !value.trim()) fail(path, 'expected nonempty text');
  };
  const range = (value: unknown, path: string, strict = false) => {
    const r = object(value, path);
    if (
      !finite(r.min) ||
      !finite(r.max) ||
      !Number.isFinite(r.max - r.min) ||
      (strict ? r.max <= r.min : r.max < r.min)
    ) {
      fail(path, `expected finite min ${strict ? '<' : '≤'} max`);
    }
    return r;
  };
  const m = object(input, 'root');
  if (m.schemaVersion !== undefined && m.schemaVersion !== 1) fail('schemaVersion', 'only version 1 is supported');
  const dimensions = object(m.dimensions, 'dimensions');
  const bounds = object(m.bounds, 'bounds');
  for (const axis of ['x', 'y', 'z']) {
    if (!Number.isSafeInteger(dimensions[axis]) || dimensions[axis] < 1)
      fail(`dimensions.${axis}`, 'expected a positive integer');
    range(bounds[axis], `bounds.${axis}`, true);
  }
  if (!Number.isSafeInteger(dimensions.x * dimensions.y * dimensions.z * 4))
    fail('dimensions', 'volume byte count exceeds safe integer limits');
  for (const key of ['description', 'coordinateUnit']) if (m[key] !== undefined) text(m[key], key);
  if (m.synthetic !== undefined && typeof m.synthetic !== 'boolean') fail('synthetic', 'expected a boolean');
  if (m.provenance !== undefined) {
    const p = object(m.provenance, 'provenance');
    for (const key of ['source', 'coordinateSystem', 'conversion'])
      if (p[key] !== undefined) text(p[key], `provenance.${key}`);
  }
  if (!Array.isArray(m.variables) || !m.variables.length) fail('variables', 'expected at least one variable');
  const ids = new Set<number>();
  m.variables.forEach((item: unknown, index: number) => {
    const path = `variables[${index}]`;
    const v = object(item, path);
    if (!Number.isSafeInteger(v.id) || ids.has(v.id)) fail(`${path}.id`, 'expected a unique integer');
    ids.add(v.id);
    text(v.name, `${path}.name`);
    text(v.file, `${path}.file`);
    if (!/^[\w.-]+(?:\/[\w.-]+)*$/.test(v.file) || v.file.split('/').some((part: string) => part === '..'))
      fail(`${path}.file`, 'use a relative dataset file path');
    if (!['uint8', 'float32'].includes(v.dtype)) fail(`${path}.dtype`, 'expected uint8 or float32');
    if (!['discrete', 'continuous'].includes(v.type)) fail(`${path}.type`, 'expected discrete or continuous');
    if (v.unit !== undefined) text(v.unit, `${path}.unit`);
    if (v.range !== undefined) range(v.range, `${path}.range`);
    if (v.dtype === 'float32' && v.type === 'continuous' && !v.range)
      fail(`${path}.range`, 'float data requires a finite physical range');
    if (v.encodingRange !== undefined) {
      const r = range(v.encodingRange, `${path}.encodingRange`, true);
      if (v.dtype !== 'uint8' || r.min < 0 || r.max > 1)
        fail(`${path}.encodingRange`, 'expected a uint8 normalized interval within 0–1');
    }
    if (
      v.noDataValue !== undefined &&
      (!finite(v.noDataValue) ||
        (v.dtype === 'float32' && !Number.isFinite(Math.fround(v.noDataValue))) ||
        (v.dtype === 'uint8' && (!Number.isInteger(v.noDataValue) || v.noDataValue < 0 || v.noDataValue > 255)))
    )
      fail(`${path}.noDataValue`, 'expected a representable finite raw value');
    if (
      v.encodingRange &&
      v.noDataValue !== undefined &&
      v.noDataValue / 255 >= v.encodingRange.min &&
      v.noDataValue / 255 <= v.encodingRange.max
    )
      fail(`${path}.noDataValue`, 'missing value overlaps the valid encoding range');
    if (!Array.isArray(v.colormap) || !v.colormap.length) fail(`${path}.colormap`, 'expected a nonempty palette');
    const values = new Set<number>();
    v.colormap.forEach((entry: unknown, i: number) => {
      const cp = `${path}.colormap[${i}]`;
      const c = object(entry, cp);
      if (
        !Array.isArray(c.color) ||
        c.color.length !== 4 ||
        !c.color.every((n: unknown) => Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 255)
      )
        fail(`${cp}.color`, 'expected four integer RGBA channels in 0–255');
      const value = v.type === 'discrete' ? c.value : c.position;
      if (!finite(value) || values.has(value)) fail(cp, 'class values / color positions must be finite and unique');
      values.add(value);
      if (v.type === 'discrete') {
        if (!Number.isInteger(value) || value < 0 || value > 255 || value === v.noDataValue)
          fail(`${cp}.value`, 'expected a class in 0–255 distinct from missing data');
        text(c.label, `${cp}.label`);
        if (c.enabled !== undefined && typeof c.enabled !== 'boolean') fail(`${cp}.enabled`, 'expected a boolean');
        if (c.role !== undefined && c.role !== 'fault') fail(`${cp}.role`, 'only fault is supported');
      } else if (value < 0 || value > 1) fail(`${cp}.position`, 'expected a position within 0–1');
    });
  });
  return m as VolumeMetadata;
}
