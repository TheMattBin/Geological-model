import { useEffect, useState } from 'react';
import { useUIContext } from '@/UIContext';
import type { VolumeRenderer } from '@three/VolumeRenderer';
import type { DiscreteColor, Histogram, ViewSettings, VolumeMetadata } from '@three/types';

interface Props {
  volumeRenderer: VolumeRenderer | null;
  metadata: VolumeMetadata | null;
  settings: ViewSettings;
  onHistogram: (histogram: Histogram | null) => void;
  onHistogramError: (message: string) => void;
  onReadyVariable: (variableId: number | null) => void;
}

/** All asynchronous selection completes before variable-dependent styles are applied. */
export default function VolumeController({
  volumeRenderer: renderer,
  metadata,
  settings,
  onHistogram,
  onHistogramError,
  onReadyVariable
}: Props) {
  const { enableGrid, displayFault } = useUIContext();
  const [loadedId, setLoadedId] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoadedId(null);
    onHistogram(null);
    onHistogramError('');
    onReadyVariable(null);
    if (!renderer || !metadata || settings.variableId === null) return;
    renderer
      .setActiveVariable(settings.variableId)
      .then(async () => {
        if (cancelled || renderer.getState().activeVariableId !== settings.variableId) return;
        setLoadedId(settings.variableId);
        onReadyVariable(settings.variableId);
        try {
          const histogram = await renderer.getHistogram(controller.signal);
          if (!cancelled) onHistogram(histogram);
        } catch (error) {
          if (!controller.signal.aborted)
            onHistogramError('Value distribution unavailable. Select the variable again to retry.');
        }
      })
      .catch(() => {
        /* Renderer reports actionable loading errors through Scene3D. */
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [renderer, metadata, settings.variableId, onHistogram, onHistogramError, onReadyVariable]);

  useEffect(() => {
    if (!renderer || !metadata) return;
    renderer.setVerticalExaggeration(settings.exaggeration);
    renderer.setSection('NS', settings.displaySections, settings.sections.NS);
    renderer.setSection('WE', settings.displaySections, settings.sections.WE);
    renderer.setGridVisible(enableGrid);
  }, [renderer, metadata, settings.exaggeration, settings.sections, settings.displaySections, enableGrid]);

  useEffect(() => {
    if (!renderer || !metadata || loadedId !== settings.variableId) return;
    const variable = metadata.variables.find((v) => v.id === loadedId);
    if (!variable) return;
    renderer.setContinuousStyle(settings.opacity, settings.valueWindow);
    renderer.setIsosurface(settings.isosurface && variable.type === 'continuous', settings.isovalue);
    if (variable.type === 'discrete') {
      renderer.updateColormap(
        variable.id,
        (variable.colormap as DiscreteColor[]).map((entry) => ({
          ...entry,
          enabled:
            !(settings.hiddenClasses[variable.id] ?? []).includes(entry.value) &&
            (entry.role !== 'fault' || displayFault)
        }))
      );
    }
  }, [
    renderer,
    metadata,
    loadedId,
    settings.variableId,
    settings.opacity,
    settings.valueWindow,
    settings.isosurface,
    settings.isovalue,
    settings.hiddenClasses,
    displayFault
  ]);
  return null;
}
