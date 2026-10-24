import test from 'node:test';
import assert from 'node:assert/strict';
import { getNormalizedVolumeSize, getCameraDistance, validateVolumeMetadata } from '../src/three/volumeGeometry.mjs';

const sampleMetadata = {
  dimensions: { x: 64, y: 64, z: 32 },
  bounds: {
    x: { min: 0, max: 1000 },
    y: { min: 0, max: 1000 },
    z: { min: -500, max: 0 }
  },
  variables: []
};

test('normalizes the sample volume to its physical aspect ratio', () => {
  assert.deepEqual(getNormalizedVolumeSize(sampleMetadata, 1), { x: 1, y: 1, z: 0.5 });
});

test('applies vertical exaggeration only to the displayed Z dimension', () => {
  assert.deepEqual(getNormalizedVolumeSize(sampleMetadata, 2), { x: 1, y: 1, z: 1 });
  assert.deepEqual(getNormalizedVolumeSize(sampleMetadata, 5), { x: 1, y: 1, z: 2.5 });
});

test('camera distance grows with the displayed volume height', () => {
  const normalDistance = getCameraDistance(getNormalizedVolumeSize(sampleMetadata, 1));
  const exaggeratedDistance = getCameraDistance(getNormalizedVolumeSize(sampleMetadata, 5));

  assert.ok(exaggeratedDistance > normalDistance);
});

test('portrait camera framing accounts for horizontal field of view', () => {
  const size = getNormalizedVolumeSize(sampleMetadata);
  assert.ok(getCameraDistance(size, 45, 1.35, 0.5) > getCameraDistance(size, 45, 1.35, 1));
});

test('reports missing or invalid coordinate bounds', () => {
  const warnings = validateVolumeMetadata({
    ...sampleMetadata,
    bounds: { x: sampleMetadata.bounds.x, y: { min: 1, max: 1 } }
  });

  assert.deepEqual(warnings, ['Axis y has a non-positive span', 'Axis z is missing bounds']);
});
