import { useEffect, useState } from 'react';
import { useUIContext } from '@/UIContext';
import type { VolumeRenderer } from '@three/VolumeRenderer';
import type { DiscreteColor, Histogram, ViewSettings, VolumeMetadata } from '@three/types';

interface Props {
  volumeRenderer: VolumeRenderer | null;
  metadata: VolumeMetadata | null;
  settings: ViewSettings;
  onHistogram: (histogram: Histogram | null) => void;
  onReady: (ready: boolean) => void;
}

/** All asynchronous selection completes before variable-dependent styles are applied. */
export default function VolumeController({
  volumeRenderer: renderer,
  metadata,
  settings,
  onHistogram,
  onReady
}: Props) {
  const { enableGrid, displayFault } = useUIContext();
  const [loadedId, setLoadedId] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoadedId(null);
    onHistogram(null);
    onReady(false);
    if (!renderer || !metadata || settings.variableId === null) return;
    renderer
      .setActiveVariable(settings.variableId)
      .then(() => {
        if (cancelled || renderer.getState().activeVariableId !== settings.variableId) return;
        setLoadedId(settings.variableId);
        onHistogram(renderer.getHistogram());
        onReady(true);
      })
      .catch(() => {
        /* Renderer reports actionable loading errors through Scene3D. */
      });
    return () => {
      cancelled = true;
    };
  }, [renderer, metadata, settings.variableId, onHistogram, onReady]);

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
