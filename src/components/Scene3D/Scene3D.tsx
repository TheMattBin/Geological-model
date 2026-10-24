import { useRef, useEffect, useState } from 'react';
import styles from './Scene3D.module.css';
import { VolumeRenderer } from '@three/VolumeRenderer';
import type { PerformanceMetrics, VolumeMetadata, VoxelInspection } from '@three/types';

interface Props {
  dataPath: string;
  initialVariableId?: number;
  onMetadataChange: (metadata: VolumeMetadata | null) => void;
  onRendererChange: (renderer: VolumeRenderer | null) => void;
  onInspection: (inspection: VoxelInspection | null) => void;
}
export default function Scene3D({
  dataPath,
  initialVariableId,
  onMetadataChange,
  onRendererChange,
  onInspection
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState('Loading dataset metadata…');
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false,
      frame = 0,
      loadingVariable = true,
      loadFailed = false;
    let renderer: VolumeRenderer | null = null;
    let start: { x: number; y: number } | null = null;
    const container = containerRef.current!;
    setLoading(true);
    setError(null);
    onMetadataChange(null);
    const down = (event: PointerEvent) => {
      start = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
    };
    const up = (event: PointerEvent) => {
      if (
        renderer &&
        !loadingVariable &&
        !loadFailed &&
        start &&
        Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4
      )
        onInspection(renderer.inspect(event.clientX, event.clientY));
      start = null;
    };
    const initialize = () => {
      if (cancelled) return;
      if (!container.clientWidth || !container.clientHeight) {
        frame = requestAnimationFrame(initialize);
        return;
      }
      try {
        renderer = new VolumeRenderer({
          container,
          transparent: true,
          quality: 'medium',
          onLoadingChange: (value) => {
            if (!cancelled) {
              loadingVariable = value;
              setLoading(value);
              if (value) {
                setError(null);
                loadFailed = false;
              }
            }
          },
          onProgress: (value) => {
            if (!cancelled) setProgress(value);
          },
          onPerformanceChange: import.meta.env.DEV ? setMetrics : undefined,
          onError: (err) => {
            if (!cancelled) {
              setError(err.message);
              loadFailed = true;
            }
          }
        });
        onRendererChange(renderer);
        container.addEventListener('pointerdown', down);
        container.addEventListener('pointerup', up);
        renderer
          .loadData(dataPath, initialVariableId)
          .then(() => {
            if (!cancelled) onMetadataChange(renderer!.getMetadata());
          })
          .catch((err: Error) => {
            if (!cancelled) {
              setError(err.message);
              loadFailed = true;
            }
          });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    };
    frame = requestAnimationFrame(initialize);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      container.removeEventListener('pointerdown', down);
      container.removeEventListener('pointerup', up);
      renderer?.dispose();
      onRendererChange(null);
    };
  }, [dataPath, initialVariableId, onMetadataChange, onRendererChange, onInspection, retry]);
  return (
    <div className={styles.sceneContainer} ref={containerRef} aria-label='Geological model'>
      {loading && (
        <div className={styles.loading} role='status'>
          {progress}
        </div>
      )}
      {error && (
        <div className={styles.error} role='alert'>
          {error}
          <br />
          <button onClick={() => setRetry((n) => n + 1)}>Retry loading</button>
        </div>
      )}
      {import.meta.env.DEV && metrics && (
        <div className={styles.performance} aria-label='Renderer performance'>
          {metrics.fps.toFixed(0)} FPS · {metrics.frameTimeMs.toFixed(1)} ms · {metrics.qualityTier} ·{' '}
          {metrics.raySteps} steps
        </div>
      )}
    </div>
  );
}
