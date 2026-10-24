import type { SavedView, ViewSettings, VolumeMetadata } from './types';

export const defaultView: ViewSettings = {
  variableId: null,
  exaggeration: 1,
  sections: { NS: 0.68, WE: 0.82 },
  displaySections: true,
  isosurface: false,
  isovalue: 0.5,
  opacity: 1,
  valueWindow: [0, 1],
  hiddenClasses: {}
};

/** Reject malformed or incompatible links rather than partially restoring a misleading view. */
export function readSavedView(hash: string, dataset: string): SavedView | null {
  if (!hash.startsWith('#view=') || hash.length > 30000) return null;
  try {
    const v = JSON.parse(decodeURIComponent(hash.slice(6)));
    const s = v.settings,
      d = v.display,
      c = v.camera;
    const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
    const bounded = (n: unknown, min: number, max: number) => finite(n) && Number(n) >= min && Number(n) <= max;
    const vector = (a: unknown) => Array.isArray(a) && a.length === 3 && a.every((n) => bounded(n, -10000, 10000));
    if (v.version !== 1 || v.dataset !== dataset || !s || !d || !c) return null;
    if (!Number.isSafeInteger(s.variableId) || !bounded(s.exaggeration, 1, 5) || !bounded(s.opacity, 0, 3)) return null;
    if (!bounded(s.sections?.NS, 0, 1) || !bounded(s.sections?.WE, 0, 1) || !finite(s.isovalue)) return null;
    if (
      !Array.isArray(s.valueWindow) ||
      s.valueWindow.length !== 2 ||
      !s.valueWindow.every(finite) ||
      s.valueWindow[0] > s.valueWindow[1]
    )
      return null;
    if (
      ![s.displaySections, s.isosurface, d.enableGrid, d.displayLegend, d.displayFault].every(
        (b) => typeof b === 'boolean'
      )
    )
      return null;
    if (
      !s.hiddenClasses ||
      typeof s.hiddenClasses !== 'object' ||
      Array.isArray(s.hiddenClasses) ||
      !Object.entries(s.hiddenClasses).every(
        ([id, values]) =>
          /^-?\d+$/.test(id) &&
          Array.isArray(values) &&
          values.length <= 256 &&
          values.every((n) => Number.isInteger(n) && bounded(n, 0, 255))
      )
    )
      return null;
    if (
      !vector(c.position) ||
      !vector(c.target) ||
      !bounded(c.zoom, 0.1, 20) ||
      c.position.every((n: number, i: number) => n === c.target[i])
    )
      return null;
    return v as SavedView;
  } catch {
    return null;
  }
}

export function writeSavedView(view: SavedView): string {
  return `#view=${encodeURIComponent(JSON.stringify(view))}`;
}

export function reconcileView(view: ViewSettings, metadata: VolumeMetadata): ViewSettings {
  const variable = metadata.variables.find((v) => v.id === view.variableId) ?? metadata.variables[0];
  const range = variable.range ?? { min: 0, max: 1 };
  const clamp = (value: number) => Math.max(range.min, Math.min(range.max, value));
  const same = view.variableId === variable.id;
  return {
    ...view,
    variableId: variable.id,
    isovalue: same ? clamp(view.isovalue) : (range.min + range.max) / 2,
    valueWindow: same ? [clamp(view.valueWindow[0]), clamp(view.valueWindow[1])] : [range.min, range.max]
  };
}
