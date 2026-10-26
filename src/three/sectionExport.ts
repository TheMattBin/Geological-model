import { createSectionInspector, yieldToUI } from './sections';
import type { ColorStop, DiscreteColor, SectionLayout, SectionSource, SectionStyle } from './types';

function csvField(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return String(value);
  // Metadata is text, including text that spreadsheet applications might interpret as a formula.
  const text = /^\s*[=+@-]/.test(value) ? `'${value}` : value;
  return `"${text.split('"').join('""')}"`;
}

/** Every cell is exported, including hidden and missing cells; row zero is the highest elevation. */
export async function exportSectionCSV(
  source: SectionSource,
  layout: SectionLayout,
  style: SectionStyle,
  exaggeration: number,
  signal: AbortSignal,
  maxBytes = 64 * 1024 * 1024
): Promise<Blob> {
  signal.throwIfAborted();
  const { metadata: m, variable: v } = source;
  const inspect = createSectionInspector(source, layout, style);
  const header = [
    'section',
    'variable_id',
    'variable_name',
    'column',
    'row',
    'x_index',
    'y_index',
    'z_index',
    'x',
    'y',
    'z',
    'coordinate_unit',
    'raw_value',
    'value',
    'unit',
    'status',
    'label',
    'plane_coordinate',
    'sampled_center',
    'exaggeration',
    'synthetic',
    'dataset_fingerprint',
    'source',
    'coordinate_system',
    'conversion',
    'hidden_classes',
    'display_fault',
    'window_min',
    'window_max'
  ];
  const parts: BlobPart[] = [header.join(',') + '\r\n'];
  let bytes = new Blob(parts).size;
  for (let start = 0; start < layout.width * layout.height; start += 1024) {
    signal.throwIfAborted();
    const end = Math.min(layout.width * layout.height, start + 1024);
    const lines: string[] = [];
    for (let pixel = start; pixel < end; pixel++) {
      const column = pixel % layout.width;
      const row = Math.floor(pixel / layout.width);
      const sample = inspect(column, row);
      const [x, y, z] = sample.indices;
      const raw = source.data[(z * m.dimensions.y + y) * m.dimensions.x + x];
      lines.push(
        [
          layout.orientation,
          v.id,
          v.name,
          column,
          row,
          ...sample.indices,
          ...sample.coordinates,
          m.coordinateUnit,
          raw,
          sample.value,
          v.unit,
          sample.status,
          sample.label,
          layout.position,
          layout.center,
          exaggeration,
          m.synthetic ?? 'unspecified',
          m.datasetFingerprint,
          m.provenance?.source,
          m.provenance?.coordinateSystem,
          m.provenance?.conversion,
          style.hiddenClasses.join(';'),
          style.displayFault,
          ...style.valueWindow
        ]
          .map(csvField)
          .join(',') + '\r\n'
      );
    }
    const chunk = new Blob(lines);
    bytes += chunk.size;
    if (bytes > maxBytes) throw new Error('Section CSV exceeds the export size limit (64 MiB). Use a smaller dataset.');
    parts.push(chunk);
    if (end < layout.width * layout.height) await yieldToUI(signal);
  }
  signal.throwIfAborted();
  return new Blob(parts, { type: 'text/csv;charset=utf-8' });
}

const number = (value: number) => String(Number(value.toPrecision(8)));
const names = { NS: 'N–S', WE: 'W–E' };

/** Export the already drawn cell raster with independent, publication-readable annotations. */
export async function exportSectionPNG(
  raster: HTMLCanvasElement,
  source: SectionSource,
  layout: SectionLayout,
  style: SectionStyle,
  exaggeration: number,
  signal: AbortSignal
): Promise<Blob> {
  signal.throwIfAborted();
  const { metadata: m, variable: v } = source;
  const unit = m.coordinateUnit ?? 'units';
  const classes = v.type === 'discrete' ? (v.colormap as DiscreteColor[]) : [];
  const ratio = layout.physicalWidth / (layout.physicalHeight * exaggeration);
  const width = Math.min(980, 640 * ratio);
  const height = width / ratio;
  const left = 110 + (980 - width) / 2;
  const top = 144;
  const legendTop = top + height + 90;
  const legendHeight = classes.length ? Math.ceil(classes.length / 2) * 26 + 34 : 84;
  const notesTop = legendTop + legendHeight;
  const output = document.createElement('canvas');
  output.width = 1200;
  output.height = Math.ceil(notesTop + 252);
  const ctx = output.getContext('2d');
  if (!ctx) throw new Error('PNG export requires a 2D canvas.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, output.width, output.height);
  ctx.fillStyle = '#172a3b';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText(`${names[layout.orientation]} section · ${v.name}`, 40, 42, 1120);
  ctx.font = '16px sans-serif';
  ctx.fillText(
    `${layout.fixedAxis.toUpperCase()} plane: ${number(layout.position)} ${unit} · sampled cell center: ${number(layout.center)} ${unit}`,
    40,
    74,
    1120
  );
  ctx.fillText(
    `Vertical exaggeration: ${exaggeration}× · ${layout.width} × ${layout.height} cells · original coordinates`,
    40,
    101,
    1120
  );
  // Opaque checkerboard keeps transparent/missing cells distinguishable in external image viewers.
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();
  for (let y = 0; y < height; y += 12)
    for (let x = 0; x < width; x += 12) {
      ctx.fillStyle = (x / 12 + y / 12) % 2 ? '#d4dde3' : '#edf1f4';
      ctx.fillRect(left + x, top + y, 12, 12);
    }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(raster, left, top, width, height);
  ctx.restore();
  ctx.strokeStyle = '#172a3b';
  ctx.lineWidth = 1;
  ctx.strokeRect(left, top, width, height);
  ctx.fillStyle = '#172a3b';
  ctx.font = '12px sans-serif';
  const horizontal = m.bounds[layout.horizontalAxis];
  const vertical = m.bounds.z;
  for (let tick = 0; tick <= 4; tick++) {
    const fraction = tick / 4;
    const x = left + fraction * width;
    const y = top + fraction * height;
    ctx.beginPath();
    ctx.moveTo(x, top + height);
    ctx.lineTo(x, top + height + 6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(left - 6, y);
    ctx.lineTo(left, y);
    ctx.stroke();
    ctx.textAlign = tick === 0 ? 'left' : tick === 4 ? 'right' : 'center';
    ctx.fillText(
      number(horizontal.min + fraction * (horizontal.max - horizontal.min)),
      x,
      top + height + 23,
      Math.max(30, width / 4)
    );
    ctx.textAlign = 'right';
    ctx.fillText(number(vertical.max - fraction * (vertical.max - vertical.min)), left - 10, y + 4, 70);
  }
  ctx.textAlign = 'center';
  ctx.font = '16px sans-serif';
  ctx.fillText(
    `${layout.horizontalAxis === 'y' ? 'Y · south → north' : 'X · west → east'} (${unit})`,
    600,
    top + height + 52,
    1000
  );
  ctx.save();
  ctx.translate(Math.max(24, left - 88), top + height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(`Z · elevation (${unit})`, 0, 0, Math.max(80, height));
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('Legend', 40, legendTop);
  ctx.font = '14px sans-serif';
  if (classes.length) {
    classes.forEach((entry, index) => {
      const x = 40 + (index % 2) * 560;
      const y = legendTop + 12 + Math.floor(index / 2) * 26;
      ctx.fillStyle = `rgba(${entry.color.slice(0, 3).join(',')}, ${entry.color[3] / 255})`;
      ctx.fillRect(x, y, 18, 18);
      ctx.strokeRect(x, y, 18, 18);
      ctx.fillStyle = '#172a3b';
      const hidden =
        style.hiddenClasses.includes(entry.value) ||
        (!style.displayFault && entry.role === 'fault') ||
        entry.color[3] === 0;
      ctx.fillText(`${entry.value}: ${entry.label}${hidden ? ' (filtered)' : ''}`, x + 28, y + 14, 512);
    });
  } else {
    const gradient = ctx.createLinearGradient(40, 0, 520, 0);
    for (const stop of v.colormap as ColorStop[])
      gradient.addColorStop(stop.position, `rgba(${stop.color.slice(0, 3).join(',')}, ${stop.color[3] / 255})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(40, legendTop + 16, 480, 20);
    ctx.fillStyle = '#172a3b';
    ctx.fillText(
      `${number(v.range?.min ?? 0)} – ${number(v.range?.max ?? 1)} ${v.unit ?? ''}`,
      40,
      legendTop + 58,
      1120
    );
  }
  ctx.fillStyle = '#172a3b';
  ctx.font = '14px sans-serif';
  const notes = [
    v.type === 'continuous'
      ? `Visible value window: ${style.valueWindow.map(number).join(' – ')} ${v.unit ?? ''}`
      : `Fault visibility: ${style.displayFault ? 'on' : 'off'} · filtered classes: ${style.hiddenClasses.join(', ') || 'none'}`,
    'Checkerboard: missing, filtered, unmapped or transparent cells. CSV includes every cell and its status.',
    'Stored cell values; volume opacity and isosurfaces apply only to the 3D view.',
    m.synthetic
      ? 'SYNTHETIC DEMONSTRATION DATASET · Not a surveyed Hong Kong model.'
      : (m.description ?? 'Geological volume data'),
    `Source: ${m.provenance?.source ?? 'Unspecified'}`,
    `Coordinate system: ${m.provenance?.coordinateSystem ?? 'Unspecified'}`,
    `Conversion: ${m.provenance?.conversion ?? 'Unspecified'}`,
    `Dataset SHA-256: ${m.datasetFingerprint ?? 'Unverified dataset'}`
  ];
  notes.forEach((text, index) => ctx.fillText(text, 40, notesTop + index * 27, 1120));
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    output.toBlob((blob) => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) reject(signal.reason);
      else if (blob) resolve(blob);
      else reject(new Error('Could not encode the section PNG.'));
    }, 'image/png');
  });
}

export function downloadSection(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
