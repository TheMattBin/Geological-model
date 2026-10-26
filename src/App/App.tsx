import { useCallback, useEffect, useRef, useState } from 'react';
import { dataPath } from '@/config';
import { UIProvider, useUIContext } from '@/UIContext';
import Scene3D from '@/components/Scene3D/Scene3D';
import Title from '@/components/Title/Title';
import MenuPanel from '@/components/MenuPanel/MenuPanel';
import VisualizationPanel from '@/components/VisualizationPanel/VisualizationPanel';
import VolumeController from '@/components/VolumeController/VolumeController';
import ExplorationPanel from '@/components/ExplorationPanel/ExplorationPanel';
import SectionViews from '@/components/SectionViews/SectionViews';
import ErrorBoundary from '@/components/ErrorBoundary/ErrorBoundary';
import { defaultView, readSavedView, reconcileView, writeSavedView } from '@three/savedView';
import type { VolumeRenderer } from '@three/VolumeRenderer';
import type {
  ColorStop,
  DiscreteColor,
  Histogram,
  LegendInfo,
  SavedView,
  ViewSettings,
  VolumeMetadata,
  VoxelInspection
} from '@three/types';
import styles from './App.module.css';

function Explorer({ saved }: { saved: SavedView | null }) {
  const [metadata, setMetadata] = useState<VolumeMetadata | null>(null);
  const [renderer, setRenderer] = useState<VolumeRenderer | null>(null);
  const [settings, setSettings] = useState<ViewSettings>(defaultView);
  const [histogram, setHistogram] = useState<Histogram | null>(null);
  const [inspection, setInspection] = useState<VoxelInspection | null>(null);
  const [histogramError, setHistogramError] = useState('');
  const [viewNotice, setViewNotice] = useState(
    window.location.hash.startsWith('#view=') && !saved
      ? 'This saved link is invalid or predates dataset verification. Showing the default view.'
      : ''
  );
  const initialized = useRef(false);
  const [readyVariableId, setReadyVariableId] = useState<number | null>(null);
  const ready = metadata !== null && settings.variableId !== null && readyVariableId === settings.variableId;
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'layers' | 'controls' | null>(null);
  const restored = useRef<VolumeRenderer | null>(null);
  const { enableGrid, displayLegend, displayFault, setEnableGrid, setDisplayLegend, setDisplayFault } = useUIContext();
  const selectedVariable = metadata?.variables.find((v) => v.id === settings.variableId);
  const onMetadata = useCallback(
    (value: VolumeMetadata | null) => {
      setMetadata(value);
      if (value) {
        const first = !initialized.current;
        initialized.current = true;
        const compatible = saved && value.datasetFingerprint === saved.datasetFingerprint;
        if (first && saved) {
          if (compatible) {
            setEnableGrid(saved.display.enableGrid);
            setDisplayLegend(saved.display.displayLegend);
            setDisplayFault(saved.display.displayFault);
          } else setViewNotice('This dataset has changed or cannot be verified. Showing the default view.');
        }
        setSettings((current) => {
          const next = reconcileView(first && compatible ? saved.settings : current, value);
          const hidden = { ...next.hiddenClasses };
          for (const variable of value.variables)
            if (variable.type === 'discrete' && !hidden[variable.id]) {
              hidden[variable.id] = (variable.colormap as DiscreteColor[])
                .filter((c) => c.enabled === false)
                .map((c) => c.value);
            }
          return { ...next, hiddenClasses: hidden };
        });
      }
    },
    [saved, setEnableGrid, setDisplayLegend, setDisplayFault]
  );
  useEffect(() => {
    if (
      ready &&
      renderer &&
      saved &&
      metadata?.datasetFingerprint === saved.datasetFingerprint &&
      restored.current !== renderer
    ) {
      renderer.setCameraState(saved.camera);
      restored.current = renderer;
    }
  }, [ready, renderer, saved, metadata]);
  useEffect(() => {
    setInspection(null);
  }, [settings, enableGrid, displayFault]);
  const update = (patch: Partial<ViewSettings>) => setSettings((current) => ({ ...current, ...patch }));
  const selectVariable = (id: number) => {
    const variable = metadata?.variables.find((v) => v.id === id);
    if (!variable) return;
    const range = variable.range ?? { min: 0, max: 1 };
    update({ variableId: id, isovalue: (range.min + range.max) / 2, valueWindow: [range.min, range.max] });
  };
  const legendInfo: LegendInfo | null = !selectedVariable
    ? null
    : selectedVariable.type === 'continuous'
      ? {
          id: selectedVariable.id,
          label: selectedVariable.name,
          continuous: true,
          range: [selectedVariable.range?.min ?? 0, selectedVariable.range?.max ?? 1],
          unit: selectedVariable.unit,
          colorStops: selectedVariable.colormap as ColorStop[]
        }
      : {
          id: selectedVariable.id,
          label: selectedVariable.name,
          continuous: false,
          uniqueValues: (selectedVariable.colormap as DiscreteColor[]).map((entry) => ({
            ...entry,
            color: { r: entry.color[0], g: entry.color[1], b: entry.color[2], a: entry.color[3] },
            enabled: !(settings.hiddenClasses[selectedVariable.id] ?? []).includes(entry.value)
          }))
        };
  const setLegendInfo = (legend: LegendInfo) =>
    update({
      hiddenClasses: {
        ...settings.hiddenClasses,
        [legend.id]: (legend.uniqueValues ?? []).filter((v) => !v.enabled).map((v) => v.value)
      }
    });
  const share = async () => {
    if (!renderer || settings.variableId === null) return 'Load a dataset first.';
    if (!metadata?.datasetFingerprint) return 'Sharing requires dataset checksums. Reconvert this dataset first.';
    const hash = writeSavedView({
      version: 2,
      dataset: dataPath,
      datasetFingerprint: metadata.datasetFingerprint,
      settings,
      display: { enableGrid, displayLegend, displayFault },
      camera: renderer.getCameraState()
    });
    window.history.replaceState(null, '', hash);
    try {
      await navigator.clipboard.writeText(window.location.href);
      return 'View link copied. It includes camera, filters and visibility.';
    } catch {
      return 'View saved in the address bar. Copy its URL to share.';
    }
  };
  return (
    <>
      <ErrorBoundary>
        <Scene3D
          dataPath={dataPath}
          initialVariableId={saved?.settings.variableId ?? undefined}
          initialDatasetFingerprint={saved?.datasetFingerprint}
          onMetadataChange={onMetadata}
          onRendererChange={setRenderer}
          onInspection={setInspection}
        />
      </ErrorBoundary>
      <VolumeController
        volumeRenderer={renderer}
        metadata={metadata}
        settings={settings}
        onHistogram={setHistogram}
        onHistogramError={setHistogramError}
        onReadyVariable={setReadyVariableId}
      />
      <div className={styles.appLayout}>
        <header className={styles.appTitle}>
          <Title text='Geological Volume Explorer' size='large' />
          {viewNotice && <p role='status'>{viewNotice}</p>}
        </header>
        <nav className={styles.mobileToolbar} aria-label='Viewer panels'>
          <button
            aria-expanded={mobilePanel === 'layers'}
            aria-controls='layers-panel'
            onClick={() => setMobilePanel(mobilePanel === 'layers' ? null : 'layers')}
          >
            Legend & explore
          </button>
          <button
            aria-expanded={mobilePanel === 'controls'}
            aria-controls='controls-panel'
            onClick={() => setMobilePanel(mobilePanel === 'controls' ? null : 'controls')}
          >
            Visualization controls
          </button>
        </nav>
        <div className={styles.appContent}>
          <div id='layers-panel' className={styles.leftPane} data-open={mobilePanel === 'layers'}>
            <ErrorBoundary>
              <MenuPanel metadata={metadata} legendInfo={legendInfo} setLegendInfo={setLegendInfo} />
            </ErrorBoundary>
            {histogramError && <p role='status'>{histogramError}</p>}
            <ExplorationPanel
              renderer={renderer}
              metadata={metadata}
              histogram={histogram}
              inspection={inspection}
              ready={ready}
              share={share}
              openSections={() => setSectionsOpen(true)}
            />
          </div>
          <div id='controls-panel' className={styles.rightPane} data-open={mobilePanel === 'controls'}>
            <ErrorBoundary>
              <VisualizationPanel
                metadata={metadata}
                selectedVariable={selectedVariable}
                settings={settings}
                update={update}
                selectVariable={selectVariable}
              />
            </ErrorBoundary>
          </div>
        </div>
        <footer className={styles.appFooter}>
          <p>
            {metadata?.synthetic
              ? 'Synthetic demonstration dataset · Not a surveyed Hong Kong model.'
              : (metadata?.description ?? 'Explore geological volume data.')}
          </p>
          <p className={styles.Logo}>
            <a href='https://github.com/TheMattBin/Geological-model' target='_blank' rel='noreferrer'>
              <img src='./assets/github_logo.png' alt='GitHub' />
            </a>
          </p>
        </footer>
      </div>
      {sectionsOpen && metadata && (
        <SectionViews
          renderer={renderer}
          metadata={metadata}
          settings={settings}
          ready={ready}
          update={update}
          selectVariable={selectVariable}
          close={() => setSectionsOpen(false)}
        />
      )}
    </>
  );
}
export default function App() {
  const [saved] = useState(() => readSavedView(window.location.hash, dataPath));
  return (
    <UIProvider>
      <Explorer saved={saved} />
    </UIProvider>
  );
}
