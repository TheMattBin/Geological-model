import { useEffect, useMemo, useRef, useState } from 'react';
import { useUIContext } from '@/UIContext';
import { inspectSection, rasterizeSection, sectionLayout } from '@three/sections';
import { downloadSection, exportSectionCSV, exportSectionPNG } from '@three/sectionExport';
import type { VolumeRenderer } from '@three/VolumeRenderer';
import type {
  ColorStop,
  DiscreteColor,
  SectionOrientation,
  SectionSample,
  SectionSource,
  SectionStyle,
  ViewSettings,
  VolumeMetadata
} from '@three/types';
import styles from './SectionViews.module.css';

const format = (value: number) => Number(value.toPrecision(6)).toLocaleString();
const names = { NS: 'N–S', WE: 'W–E' };

interface Props {
  renderer: VolumeRenderer | null;
  metadata: VolumeMetadata;
  settings: ViewSettings;
  ready: boolean;
  update: (patch: Partial<ViewSettings>) => void;
  selectVariable: (id: number) => void;
  close: () => void;
}

function SectionPlot({
  source,
  orientation,
  settings,
  style,
  update
}: {
  source: SectionSource;
  orientation: SectionOrientation;
  settings: ViewSettings;
  style: SectionStyle;
  update: Props['update'];
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const position = settings.sections[orientation];
  const layout = useMemo(() => sectionLayout(source.metadata, orientation, position), [source, orientation, position]);
  const [drawing, setDrawing] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState<'PNG' | 'CSV' | null>(null);
  const [exportMessage, setExportMessage] = useState('');
  const exportController = useRef<AbortController | null>(null);
  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [sample, setSample] = useState<SectionSample | null>(null);
  const ratio = layout.physicalWidth / (layout.physicalHeight * settings.exaggeration);
  const unit = source.metadata.coordinateUnit ?? 'units';
  const horizontal = source.metadata.bounds[layout.horizontalAxis];
  const vertical = source.metadata.bounds.z;

  useEffect(() => {
    const controller = new AbortController();
    setDrawing(true);
    setError('');
    setSelected(null);
    setSample(null);
    const context = canvas.current!.getContext('2d');
    context?.clearRect(0, 0, layout.width, layout.height);
    rasterizeSection(source, layout, style, controller.signal)
      .then((pixels) => {
        if (controller.signal.aborted) return;
        if (!context) throw new Error('2D canvas is unavailable.');
        context.putImageData(new ImageData(pixels, layout.width, layout.height), 0, 0);
        setDrawing(false);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : 'Section drawing failed.');
          setDrawing(false);
        }
      });
    return () => controller.abort();
  }, [source, layout, style]);

  useEffect(() => {
    exportController.current?.abort();
    setExporting(null);
    setExportMessage('');
    return () => exportController.current?.abort();
  }, [source, layout, style, settings.exaggeration]);

  const exportSection = async (format: 'PNG' | 'CSV') => {
    if (drawing || error || exporting || !canvas.current) return;
    const controller = new AbortController();
    exportController.current?.abort();
    exportController.current = controller;
    setExporting(format);
    setExportMessage(`Preparing ${format}…`);
    try {
      const blob =
        format === 'PNG'
          ? await exportSectionPNG(canvas.current, source, layout, style, settings.exaggeration, controller.signal)
          : await exportSectionCSV(source, layout, style, settings.exaggeration, controller.signal);
      controller.signal.throwIfAborted();
      downloadSection(
        blob,
        `geological-${orientation.toLowerCase()}-variable-${source.variable.id}-cell-${layout.cell}.${format.toLowerCase()}`
      );
      setExportMessage(`${format} downloaded.`);
    } catch (reason) {
      if (!controller.signal.aborted) setExportMessage(reason instanceof Error ? reason.message : 'Export failed.');
    } finally {
      if (!controller.signal.aborted) setExporting(null);
    }
  };

  const inspect = (column: number, row: number) => {
    if (drawing || error) return;
    const cell: [number, number] = [
      Math.max(0, Math.min(layout.width - 1, Math.floor(column))),
      Math.max(0, Math.min(layout.height - 1, Math.floor(row)))
    ];
    setSelected(cell);
    setSample(inspectSection(source, layout, style, ...cell));
  };
  return (
    <section className={styles.section} aria-label={`${names[orientation]} section`}>
      <h3>
        {names[orientation]} section · {source.variable.name}
      </h3>
      <label>
        {names[orientation]} section position
        <input
          type='range'
          min={0}
          max={100}
          step={1}
          value={Math.round(position * 100)}
          onChange={(event) =>
            update({ sections: { ...settings.sections, [orientation]: Number(event.target.value) / 100 } })
          }
        />
      </label>
      <p className={styles.caption}>
        {layout.fixedAxis.toUpperCase()} = {format(layout.position)} {unit} · sampled cell center{' '}
        {format(layout.center)} {unit}
      </p>
      <div className={styles.plotArea}>
        <div className={styles.diagram} style={{ width: `min(calc(100% - 80px), ${280 * ratio}px)` }}>
          <div className={styles.image} style={{ aspectRatio: ratio }}>
            <canvas
              ref={canvas}
              width={layout.width}
              height={layout.height}
              tabIndex={0}
              role='img'
              aria-label={`${names[orientation]} section cells`}
              aria-describedby={`section-help-${orientation}`}
              aria-busy={drawing}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.currentTarget.focus();
                const rect = event.currentTarget.getBoundingClientRect();
                inspect(
                  ((event.clientX - rect.left) / rect.width) * layout.width,
                  ((event.clientY - rect.top) / rect.height) * layout.height
                );
              }}
              onKeyDown={(event) => {
                const [x, y] = selected ?? [Math.floor(layout.width / 2), Math.floor(layout.height / 2)];
                const moves: Record<string, [number, number]> = {
                  'ArrowLeft': [x - 1, y],
                  'ArrowRight': [x + 1, y],
                  'ArrowUp': [x, y - 1],
                  'ArrowDown': [x, y + 1],
                  'Home': [0, 0],
                  'End': [layout.width - 1, layout.height - 1],
                  'Enter': [x, y],
                  ' ': [x, y]
                };
                if (moves[event.key]) {
                  event.preventDefault();
                  inspect(...moves[event.key]);
                }
              }}
            />
            {selected && (
              <span
                className={styles.marker}
                style={{
                  left: `${((selected[0] + 0.5) / layout.width) * 100}%`,
                  top: `${((selected[1] + 0.5) / layout.height) * 100}%`
                }}
              />
            )}
            <span className={styles.top}>{format(vertical.max)}</span>
            <span className={styles.bottom}>{format(vertical.min)}</span>
            <span className={styles.vertical}>Z · elevation ({unit})</span>
          </div>
          <div className={styles.extents}>
            <span>{format(horizontal.min)}</span>
            <span>{format(horizontal.max)}</span>
          </div>
          <div className={styles.axis}>
            {layout.horizontalAxis === 'y' ? 'Y · south → north' : 'X · west → east'} ({unit})
          </div>
        </div>
      </div>
      <p id={`section-help-${orientation}`} className={styles.caption}>
        Click or tap a cell. Focus the image and use arrow keys; Home/End select corners.
      </p>
      <div className={styles.exports}>
        {(['PNG', 'CSV'] as const).map((format) => (
          <button
            key={format}
            disabled={drawing || !!error || exporting !== null}
            aria-label={`Export ${names[orientation]} ${format}`}
            onClick={() => void exportSection(format)}
          >
            Export {format}
          </button>
        ))}
        {exporting && (
          <button
            onClick={() => {
              exportController.current?.abort();
              setExporting(null);
              setExportMessage('Export cancelled.');
            }}
          >
            Cancel export
          </button>
        )}
      </div>
      {exportMessage && (
        <p role='status' aria-label={`${names[orientation]} export status`}>
          {exportMessage}
        </p>
      )}
      {drawing && <p role='status'>Drawing {names[orientation]} section…</p>}
      {error && <p role='alert'>{error}</p>}
      <div className={styles.inspection} role='status' aria-label={`${names[orientation]} section inspection`}>
        {sample ? (
          <>
            <strong>
              {sample.status === 'missing'
                ? 'Missing data'
                : `${sample.label ?? format(sample.value!)} ${sample.unit ?? ''}`}
            </strong>
            {sample.status === 'filtered' && ' · filtered'}
            {sample.status === 'unmapped' && ' · unmapped class'}
            <div>Cell (X, Y, Z): {sample.indices.join(', ')} · zero-based</div>
            <div>
              Center: {sample.coordinates.map(format).join(', ')} {unit}
            </div>
          </>
        ) : (
          'No section cell selected.'
        )}
      </div>
    </section>
  );
}

export default function SectionViews({ renderer, metadata, settings, ready, update, selectVariable, close }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { displayFault } = useUIContext();
  const source = useMemo(
    () => (ready && settings.variableId !== null ? (renderer?.getSectionSource(settings.variableId) ?? null) : null),
    [renderer, metadata, settings.variableId, ready]
  );
  const style = useMemo<SectionStyle>(
    () => ({
      hiddenClasses: settings.hiddenClasses[settings.variableId ?? ''] ?? [],
      displayFault,
      valueWindow: settings.valueWindow
    }),
    [settings.hiddenClasses, settings.variableId, settings.valueWindow, displayFault]
  );
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => {
      element.close();
      previous?.focus();
    };
  }, []);
  const variable = metadata.variables.find((v) => v.id === settings.variableId);
  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby='section-views-title' onCancel={close}>
      <header className={styles.header}>
        <div>
          <h2 id='section-views-title'>2D sections</h2>
          <p>Stored cell values at the current cut positions.</p>
        </div>
        <button onClick={close} autoFocus>
          Close sections
        </button>
      </header>
      <div className={styles.controls}>
        <label>
          Section variable
          <select value={settings.variableId ?? ''} onChange={(event) => selectVariable(Number(event.target.value))}>
            {metadata.variables.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Section exaggeration
          <input
            type='range'
            min={1}
            max={5}
            step={1}
            value={settings.exaggeration}
            onChange={(event) => update({ exaggeration: Number(event.target.value) })}
          />
          <output>{settings.exaggeration}×</output>
        </label>
        <label>
          <input
            type='checkbox'
            checked={settings.displaySections}
            onChange={(event) => update({ displaySections: event.target.checked })}
          />
          Show section cuts in 3D
        </label>
      </div>
      <p className={styles.caption}>
        Coordinates use original bounds. Exaggeration changes displayed height. Class, fault and value-window filters
        apply; volume opacity and isosurfaces apply to the 3D view.
      </p>
      {source ? (
        <div className={styles.plots}>
          {(['NS', 'WE'] as const).map((orientation) => (
            <SectionPlot
              key={`${source.variable.id}-${orientation}`}
              source={source}
              orientation={orientation}
              settings={settings}
              style={style}
              update={update}
            />
          ))}
        </div>
      ) : (
        <p role='status'>Waiting for the selected variable. Close sections to retry if loading fails.</p>
      )}
      {variable?.type === 'discrete' && (
        <ul className={styles.legend} aria-label='Section legend'>
          {(variable.colormap as DiscreteColor[]).map((entry) => (
            <li key={entry.value}>
              <span style={{ background: `rgba(${entry.color.slice(0, 3).join(',')}, ${entry.color[3] / 255})` }} />
              {entry.label}
              {style.hiddenClasses.includes(entry.value) || (!displayFault && entry.role === 'fault')
                ? ' (filtered)'
                : ''}
            </li>
          ))}
        </ul>
      )}
      {variable?.type === 'continuous' && (
        <div className={styles.continuousLegend} aria-label='Section legend'>
          <div
            style={{
              background: `linear-gradient(to right, ${(variable.colormap as ColorStop[])
                .slice()
                .sort((a, b) => a.position - b.position)
                .map(
                  (stop) => `rgba(${stop.color.slice(0, 3).join(',')}, ${stop.color[3] / 255}) ${stop.position * 100}%`
                )
                .join(',')})`
            }}
          />
          <span>
            {format(variable.range?.min ?? 0)} – {format(variable.range?.max ?? 1)} {variable.unit}
          </span>
          <span>Visible window: {settings.valueWindow.map(format).join(' – ')}</span>
        </div>
      )}
      <p className={styles.caption}>
        Checkerboard indicates missing, filtered, unmapped or transparent cells. Inspect a cell for its value and
        status.
      </p>
      <footer>
        {metadata.synthetic
          ? 'Synthetic demonstration dataset · Not a surveyed Hong Kong model.'
          : (metadata.description ?? metadata.provenance?.source ?? 'Geological volume data')}
      </footer>
    </dialog>
  );
}
