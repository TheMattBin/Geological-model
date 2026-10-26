import type {
  ColorStop,
  DiscreteColor,
  SectionLayout,
  SectionOrientation,
  SectionSample,
  SectionSource,
  SectionStyle,
  VolumeMetadata
} from './types';
import { isMissing, physicalValue } from './volumeValues';

export function sectionLayout(
  metadata: VolumeMetadata,
  orientation: SectionOrientation,
  position: number
): SectionLayout {
  if (!Number.isFinite(position) || position < 0 || position > 1)
    throw new Error('Section position must be within 0–1.');
  const fixedAxis = orientation === 'NS' ? 'x' : 'y';
  const horizontalAxis = orientation === 'NS' ? 'y' : 'x';
  const bounds = metadata.bounds[fixedAxis];
  const count = metadata.dimensions[fixedAxis];
  // At the upper edge, select the final cell. At internal edges, select the positive-side cell.
  const cell = Math.min(count - 1, Math.floor(position * count));
  return {
    orientation,
    fixedAxis,
    horizontalAxis,
    cell,
    position: bounds.min + position * (bounds.max - bounds.min),
    center: bounds.min + ((cell + 0.5) / count) * (bounds.max - bounds.min),
    width: metadata.dimensions[horizontalAxis],
    height: metadata.dimensions.z,
    physicalWidth: metadata.bounds[horizontalAxis].max - metadata.bounds[horizontalAxis].min,
    physicalHeight: metadata.bounds.z.max - metadata.bounds.z.min
  };
}

export function sectionIndices(layout: SectionLayout, column: number, row: number): [number, number, number] {
  const horizontal = Math.max(0, Math.min(layout.width - 1, Math.floor(column)));
  const z = layout.height - 1 - Math.max(0, Math.min(layout.height - 1, Math.floor(row)));
  return layout.orientation === 'NS' ? [layout.cell, horizontal, z] : [horizontal, layout.cell, z];
}

function classifier(source: SectionSource, style: SectionStyle) {
  const { variable } = source;
  const classes = new Map(
    (variable.type === 'discrete' ? (variable.colormap as DiscreteColor[]) : []).map((c) => [c.value, c])
  );
  const hidden = new Set(style.hiddenClasses);
  return (raw: number): SectionSample['status'] => {
    if (isMissing(raw, variable)) return 'missing';
    if (variable.type === 'discrete') {
      const entry = classes.get(raw);
      if (!entry) return 'unmapped';
      if (hidden.has(raw) || (!style.displayFault && entry.role === 'fault') || entry.color[3] === 0) return 'filtered';
    } else {
      const value = physicalValue(raw, variable);
      if (value < style.valueWindow[0] || value > style.valueWindow[1]) return 'filtered';
    }
    return 'visible';
  };
}

function rawAt(source: SectionSource, indices: [number, number, number]): number {
  const [x, y, z] = indices;
  const d = source.metadata.dimensions;
  return source.data[(z * d.y + y) * d.x + x];
}

/** Prepare lookup tables once when inspecting or exporting many cells. */
export function createSectionInspector(source: SectionSource, layout: SectionLayout, style: SectionStyle) {
  const classify = classifier(source, style);
  const labels = new Map(
    (source.variable.type === 'discrete' ? (source.variable.colormap as DiscreteColor[]) : []).map((c) => [
      c.value,
      c.label
    ])
  );
  return (column: number, row: number): SectionSample => {
    const indices = sectionIndices(layout, column, row);
    const raw = rawAt(source, indices);
    const status = classify(raw);
    return {
      indices,
      coordinates: (['x', 'y', 'z'] as const).map((axis, i) => {
        const bounds = source.metadata.bounds[axis];
        return bounds.min + ((indices[i] + 0.5) / source.metadata.dimensions[axis]) * (bounds.max - bounds.min);
      }) as [number, number, number],
      value: status === 'missing' ? null : physicalValue(raw, source.variable),
      label: labels.get(raw),
      unit: source.variable.unit,
      status
    };
  };
}

export function inspectSection(
  source: SectionSource,
  layout: SectionLayout,
  style: SectionStyle,
  column: number,
  row: number
): SectionSample {
  return createSectionInspector(source, layout, style)(column, row);
}

function colorFunction(source: SectionSource) {
  const { variable } = source;
  if (variable.type === 'discrete') {
    const colors = new Map((variable.colormap as DiscreteColor[]).map((c) => [c.value, c.color]));
    return (raw: number) => colors.get(raw) ?? [0, 0, 0, 0];
  }
  const stops = [...(variable.colormap as ColorStop[])].sort((a, b) => a.position - b.position);
  const range = variable.range ?? { min: 0, max: 1 };
  // Match the 256-entry metadata transfer palette, in sRGB, without allocating GPU resources.
  const palette = Array.from({ length: 256 }, (_, i) => {
    const t = Math.max(stops[0].position, Math.min(stops[stops.length - 1].position, i / 255));
    const upper = stops.findIndex((stop) => stop.position >= t);
    const b = stops[Math.max(0, upper)];
    const a = stops[Math.max(0, upper - 1)];
    const mix = b.position === a.position ? 0 : (t - a.position) / (b.position - a.position);
    return a.color.map((channel, index) => Math.round(channel + (b.color[index] - channel) * mix));
  });
  return (raw: number) => {
    const fraction = range.max === range.min ? 0 : (physicalValue(raw, variable) - range.min) / (range.max - range.min);
    return palette[Math.round(Math.max(0, Math.min(1, fraction)) * 255)];
  };
}

export function yieldToUI(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, 0);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Exact cell raster; bounded work batches yield so large sections remain cancellable. */
export async function rasterizeSection(
  source: SectionSource,
  layout: SectionLayout,
  style: SectionStyle,
  signal: AbortSignal
): Promise<Uint8ClampedArray<ArrayBuffer>> {
  signal.throwIfAborted();
  const pixels = new Uint8ClampedArray(layout.width * layout.height * 4);
  const classify = classifier(source, style);
  const color = colorFunction(source);
  for (let start = 0; start < layout.width * layout.height; start += 16384) {
    signal.throwIfAborted();
    const end = Math.min(layout.width * layout.height, start + 16384);
    for (let pixel = start; pixel < end; pixel++) {
      const raw = rawAt(source, sectionIndices(layout, pixel % layout.width, Math.floor(pixel / layout.width)));
      if (classify(raw) === 'visible') pixels.set(color(raw), pixel * 4);
    }
    if (end < layout.width * layout.height) await yieldToUI(signal);
  }
  signal.throwIfAborted();
  return pixels;
}
