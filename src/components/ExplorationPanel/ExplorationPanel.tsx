import { useState } from 'react';
import Background from '../Background/Background';
import styles from './ExplorationPanel.module.css';
import type { VolumeRenderer } from '@three/VolumeRenderer';
import type { Histogram, VolumeMetadata, VoxelInspection } from '@three/types';

interface Props {
  renderer: VolumeRenderer | null;
  metadata: VolumeMetadata | null;
  histogram: Histogram | null;
  inspection: VoxelInspection | null;
  ready: boolean;
  share: () => Promise<string>;
  openSections: () => void;
}
export default function ExplorationPanel({
  renderer,
  metadata,
  histogram,
  inspection,
  ready,
  share,
  openSections
}: Props) {
  const [message, setMessage] = useState('');
  const max = Math.max(1, ...(histogram?.bins ?? []));
  const exportImage = () => {
    try {
      if (!renderer) return;
      const link = document.createElement('a');
      link.href = renderer.exportImage();
      link.download = 'geological-view.png';
      link.click();
      setMessage('Image exported with legend and exaggeration.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Image export failed.');
    }
  };
  return (
    <Background>
      <section className={styles.panel} aria-label='Explore and inspect'>
        {histogram && (
          <figure className={styles.histogram}>
            <figcaption>Value distribution · entire dataset</figcaption>
            <svg
              viewBox='0 0 320 80'
              role='img'
              aria-label={`${histogram.valid} valid voxels, ${histogram.missing} missing voxels`}
            >
              {histogram.bins.map((count, i) => (
                <rect
                  key={i}
                  x={i * 10}
                  y={80 - (count / max) * 78}
                  width={9}
                  height={(count / max) * 78}
                  fill='#5cc9b5'
                >
                  <title>
                    {count} voxels ·{' '}
                    {Number((histogram.min + (i / 32) * (histogram.max - histogram.min)).toPrecision(4))}–
                    {Number((histogram.min + ((i + 1) / 32) * (histogram.max - histogram.min)).toPrecision(4))}
                  </title>
                </rect>
              ))}
            </svg>
            <div className={styles.extents}>
              <span>{histogram.min.toPrecision(3)}</span>
              <span>{histogram.max.toPrecision(3)}</span>
            </div>
            <small>
              {histogram.valid.toLocaleString()} valid · {histogram.missing.toLocaleString()} missing
            </small>
          </figure>
        )}
        <h2>Explore</h2>
        <div className={styles.buttons}>
          {(['reset', 'top', 'front', 'side'] as const).map((preset) => (
            <button key={preset} disabled={!ready} onClick={() => renderer?.setCameraPreset(preset)}>
              {preset === 'reset' ? 'Reset camera' : `${preset[0].toUpperCase()}${preset.slice(1)} view`}
            </button>
          ))}
          <button
            disabled={!ready}
            onClick={() => {
              share()
                .then(setMessage)
                .catch(() => setMessage('Could not save this view.'));
            }}
          >
            Share view
          </button>
          <button disabled={!ready} onClick={exportImage}>
            Export PNG
          </button>
          <button disabled={!ready} onClick={openSections}>
            2D sections
          </button>
        </div>
        {message && <p role='status'>{message}</p>}
        <h3>Voxel inspection</h3>
        <p>Click the model to inspect the first visible voxel. Drag to orbit.</p>
        {inspection ? (
          <div role='status' aria-label='Voxel inspection result'>
            <strong>
              {inspection.label ?? inspection.value.toPrecision(5)} {inspection.unit ?? ''}
            </strong>
            <p>Cell (X, Y, Z): {inspection.indices.join(', ')} · zero-based</p>
            <p>
              Center: {inspection.coordinates.map((v) => Number(v.toPrecision(6))).join(', ')}{' '}
              {metadata?.coordinateUnit ?? 'units'}
            </p>
            <small>Stored voxel value; continuous rendering interpolates between samples.</small>
          </div>
        ) : (
          <p className={styles.muted}>No voxel selected.</p>
        )}
        {metadata?.provenance && (
          <details>
            <summary>Dataset provenance</summary>
            <p>Source: {metadata.provenance.source ?? 'Unspecified'}</p>
            <p>Coordinates: {metadata.provenance.coordinateSystem ?? 'Unspecified'}</p>
            <p>{metadata.provenance.conversion}</p>
          </details>
        )}
      </section>
    </Background>
  );
}
