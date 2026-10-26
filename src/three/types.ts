/**
 * Type definitions for the voxel volume visualization system
 */

/** Metadata for the voxel volume */
export interface VolumeMetadata {
  schemaVersion?: 1;
  /** Computed from validated metadata and raw-file checksums at load time. */
  datasetFingerprint?: string;
  coordinateUnit?: string;
  provenance?: { source?: string; coordinateSystem?: string; conversion?: string };
  description?: string;
  synthetic?: boolean;
  dimensions: {
    x: number;
    y: number;
    z: number;
  };
  bounds: {
    x: { min: number; max: number };
    y: { min: number; max: number };
    z: { min: number; max: number };
  };
  variables: VariableMetadata[];
}

/** Metadata for a single variable in the volume */
export interface VariableMetadata {
  id: number;
  name: string;
  file: string;
  sha256?: string;
  dtype: 'uint8' | 'float32';
  type: 'discrete' | 'continuous';
  unit?: string;
  numClasses?: number;
  range?: { min: number; max: number };
  /** Range in the sampled texture, after uint8 normalization. */
  encodingRange?: { min: number; max: number };
  noDataValue?: number;
  colormap: ColorStop[] | DiscreteColor[];
}

/** Color stop for continuous colormap */
export interface ColorStop {
  position: number;
  color: [number, number, number, number]; // RGBA 0-255
}

/** Discrete color for categorical data */
export interface DiscreteColor {
  value: number;
  label: string;
  color: [number, number, number, number]; // RGBA 0-255
  enabled?: boolean;
  role?: 'fault';
}

/** Slice configuration for cross-section views */
export interface SliceConfig {
  enabled: boolean;
  axis: 'x' | 'y' | 'z';
  position: number; // 0-1 normalized
}

/** Section configuration for cutting planes */
export interface SectionConfig {
  enabled: boolean;
  orientation: 'NS' | 'WE'; // North-South or West-East
  position: number; // 0-1 normalized
}

/** Render mode for volume visualization */
export type RenderMode = 'volume' | 'surfaces';

/** Volume renderer options */
export interface VolumeRendererOptions {
  /** Container element for the Three.js canvas */
  container: HTMLElement;
  /** Initial render mode */
  renderMode?: RenderMode;
  /** Initial vertical exaggeration */
  verticalExaggeration?: number;
  /** Enable alpha compositing for transparent background */
  transparent?: boolean;
  /** Quality profile - affects step count in ray marching */
  quality?: 'low' | 'medium' | 'high';
  /** Callback when loading state changes */
  onLoadingChange?: (loading: boolean) => void;
  onProgress?: (message: string) => void;
  onContextChange?: (lost: boolean) => void;
  /** Callback when an error occurs */
  onError?: (error: Error) => void;
  /** Development-only frame performance callback */
  onPerformanceChange?: (metrics: PerformanceMetrics) => void;
}

/** Runtime rendering metrics used by the development performance overlay. */
export interface PerformanceMetrics {
  fps: number;
  frameTimeMs: number;
  qualityTier: 'interaction' | 'balanced' | 'high';
  raySteps: number;
  pixelRatio: number;
}

/** Volume renderer state */
export interface VolumeRendererState {
  activeVariableId: number;
  renderMode: RenderMode;
  verticalExaggeration: number;
  slices: {
    x: SliceConfig;
    y: SliceConfig;
    z: SliceConfig;
  };
  sections: {
    NS: SectionConfig;
    WE: SectionConfig;
  };
  isosurface: {
    enabled: boolean;
    value: number;
    opacity: number;
  };
}

/** Camera state for saving/restoring views */
export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
}

export interface Histogram {
  bins: number[];
  min: number;
  max: number;
  valid: number;
  missing: number;
}

export interface VoxelInspection {
  indices: [number, number, number];
  coordinates: [number, number, number];
  value: number;
  label?: string;
  unit?: string;
}

export interface LegendInfo {
  id: number;
  label: string;
  continuous: boolean;
  range?: [number, number];
  unit?: string;
  colorStops?: ColorStop[];
  uniqueValues?: (Omit<DiscreteColor, 'color'> & { color: { r: number; g: number; b: number; a: number } })[];
}

export interface ViewSettings {
  variableId: number | null;
  exaggeration: number;
  sections: { NS: number; WE: number };
  displaySections: boolean;
  isosurface: boolean;
  isovalue: number;
  opacity: number;
  valueWindow: [number, number];
  hiddenClasses: Record<string, number[]>;
}

export interface DisplaySettings {
  enableGrid: boolean;
  displayLegend: boolean;
  displayFault: boolean;
}

export interface SavedView {
  version: 2;
  dataset: string;
  datasetFingerprint: string;
  settings: ViewSettings;
  display: DisplaySettings;
  camera: CameraState;
}

export type SectionOrientation = 'NS' | 'WE';

/** Borrowed CPU data; consumers must not mutate or detach the renderer buffer. */
export interface SectionSource {
  data: ArrayLike<number>;
  variable: VariableMetadata;
  metadata: VolumeMetadata;
}

export interface SectionStyle {
  hiddenClasses: number[];
  displayFault: boolean;
  valueWindow: [number, number];
}

export interface SectionLayout {
  orientation: SectionOrientation;
  fixedAxis: 'x' | 'y';
  horizontalAxis: 'x' | 'y';
  cell: number;
  position: number;
  center: number;
  width: number;
  height: number;
  physicalWidth: number;
  physicalHeight: number;
}

export interface SectionSample {
  indices: [number, number, number];
  coordinates: [number, number, number];
  value: number | null;
  label?: string;
  unit?: string;
  status: 'visible' | 'missing' | 'filtered' | 'unmapped';
}
