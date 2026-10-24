import { useEffect } from 'react';
import PropTypes from 'prop-types';
import { useUIContext } from '../../UIContext.jsx';

/** Synchronize UI state with the renderer after its dataset is ready. */
const VolumeController = ({
  volumeRenderer,
  metadata,
  selectedVariable,
  exaggeration,
  sections,
  displaySections,
  legendInfo,
  setLegendInfo,
  isosurface,
  isovalue
}) => {
  const { enableGrid, displayFault } = useUIContext();
  const ready = volumeRenderer && metadata && selectedVariable;

  useEffect(() => {
    if (!ready) return;
    const variable = metadata.variables.find((item) => item.id === selectedVariable.id);
    if (!variable) return;
    volumeRenderer.setActiveVariable(variable.id);
    setLegendInfo(
      variable.type === 'continuous'
        ? {
            id: variable.id,
            label: variable.name,
            continuous: true,
            range: [variable.range?.min ?? 0, variable.range?.max ?? 1],
            unit: variable.unit,
            colorStops: variable.colormap
          }
        : {
            id: variable.id,
            label: variable.name,
            continuous: false,
            uniqueValues: variable.colormap.map((entry) => ({
              ...entry,
              color: { r: entry.color[0], g: entry.color[1], b: entry.color[2], a: entry.color[3] },
              enabled: entry.enabled !== false
            }))
          }
    );
  }, [volumeRenderer, metadata, selectedVariable, setLegendInfo, ready]);

  useEffect(() => {
    if (ready) volumeRenderer.setVerticalExaggeration(exaggeration);
  }, [volumeRenderer, ready, exaggeration]);

  useEffect(() => {
    if (!ready) return;
    volumeRenderer.setSection('NS', displaySections, sections.NS);
    volumeRenderer.setSection('WE', displaySections, sections.WE);
  }, [volumeRenderer, ready, sections, displaySections]);

  useEffect(() => {
    if (ready) volumeRenderer.setGridVisible(enableGrid);
  }, [volumeRenderer, ready, enableGrid]);

  useEffect(() => {
    if (!ready) return;
    volumeRenderer.setIsosurface(isosurface && selectedVariable.type === 'continuous', isovalue);
  }, [volumeRenderer, ready, selectedVariable, isosurface, isovalue]);

  useEffect(() => {
    if (!ready || !legendInfo || legendInfo.continuous || legendInfo.id !== selectedVariable.id) return;
    volumeRenderer.updateColormap(
      legendInfo.id,
      legendInfo.uniqueValues.map((entry) => ({
        ...entry,
        color: [entry.color.r, entry.color.g, entry.color.b, entry.color.a],
        enabled: entry.enabled && (entry.role !== 'fault' || displayFault)
      }))
    );
  }, [volumeRenderer, ready, selectedVariable, legendInfo, displayFault]);

  return null;
};

VolumeController.propTypes = {
  volumeRenderer: PropTypes.object,
  metadata: PropTypes.object,
  selectedVariable: PropTypes.object,
  exaggeration: PropTypes.number,
  sections: PropTypes.object,
  displaySections: PropTypes.bool,
  legendInfo: PropTypes.object,
  setLegendInfo: PropTypes.func,
  isosurface: PropTypes.bool,
  isovalue: PropTypes.number
};

export default VolumeController;
