import type { Histogram, VariableMetadata } from './types';

export function physicalValue(raw: number, variable: VariableMetadata): number {
  if (variable.type === 'discrete' || variable.dtype === 'float32') return raw;
  const encoding = variable.encodingRange ?? { min: 0, max: 1 };
  const range = variable.range ?? { min: 0, max: 1 };
  const normalized = Math.max(0, Math.min(1, (raw / 255 - encoding.min) / (encoding.max - encoding.min)));
  return range.min + normalized * (range.max - range.min);
}

export function isMissing(raw: number, variable: VariableMetadata): boolean {
  const sentinel =
    variable.noDataValue === undefined
      ? undefined
      : variable.dtype === 'float32'
        ? Math.fround(variable.noDataValue)
        : variable.noDataValue;
  return !Number.isFinite(raw) || raw === sentinel;
}

export function buildHistogram(data: ArrayLike<number>, variable: VariableMetadata): Histogram {
  const { min, max } = variable.range ?? { min: 0, max: 1 };
  const bins = Array(32).fill(0) as number[];
  let missing = 0;
  for (let i = 0; i < data.length; i++) {
    if (isMissing(data[i], variable)) {
      missing++;
      continue;
    }
    const value = physicalValue(data[i], variable);
    const index = max === min ? 0 : Math.min(31, Math.max(0, Math.floor(((value - min) / (max - min)) * 32)));
    bins[index]++;
  }
  return { bins, min, max, valid: data.length - missing, missing };
}
