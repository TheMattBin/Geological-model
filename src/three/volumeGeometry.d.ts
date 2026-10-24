import type { VolumeMetadata } from './types';

export interface NormalizedVolumeSize {
  x: number;
  y: number;
  z: number;
}

export function getNormalizedVolumeSize(metadata: VolumeMetadata, verticalExaggeration?: number): NormalizedVolumeSize;
export function getCameraDistance(
  size: NormalizedVolumeSize,
  fieldOfView?: number,
  margin?: number,
  aspect?: number
): number;
export function validateVolumeMetadata(metadata: VolumeMetadata): string[];
