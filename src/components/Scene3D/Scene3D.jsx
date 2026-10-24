import { useRef, useEffect, useState, useCallback, Children, cloneElement } from 'react';
import PropTypes from 'prop-types';
import * as styles from './Scene3D.module.css';
import { VolumeRenderer } from '../../three/VolumeRenderer';

/**
 * Scene3D - Three.js 3D scene container component
 *
 * Replaces the ArcGIS Map component with a Three.js-based volume renderer.
 * Manages the WebGL context, camera, and volume rendering.
 */
const Scene3D = ({ children, dataPath = './data', onMetadataChange }) => {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const [volumeRenderer, setVolumeRenderer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [performanceMetrics, setPerformanceMetrics] = useState(null);

  // Initialize the volume renderer after container has dimensions
  useEffect(() => {
    let cancelled = false;
    let initializationFrame;
    setLoading(true);
    setError(null);
    setMetadata(null);
    onMetadataChange?.(null);
    if (!containerRef.current) {
      console.error('Scene3D: Container ref is null');
      return;
    }

    // Prevent double initialization in StrictMode
    if (rendererRef.current) {
      return;
    }

    // Clean up any leftover canvas elements from previous instances
    const container = containerRef.current;
    const existingCanvases = container.querySelectorAll('canvas');
    existingCanvases.forEach((canvas) => {
      canvas.remove();
    });

    // Wait for container to have dimensions (CSS layout not yet applied on first render)
    const initializeRenderer = () => {
      if (cancelled || !container) return;

      // Double-check we haven't been initialized in the meantime (race condition guard)
      if (rendererRef.current) {
        return;
      }

      const width = container.clientWidth;
      const height = container.clientHeight;

      // If container has zero dimensions, wait and try again
      if (width === 0 || height === 0) {
        initializationFrame = requestAnimationFrame(initializeRenderer);
        return;
      }

      let renderer;
      try {
        // Create volume renderer
        renderer = new VolumeRenderer({
          container: container,
          transparent: true,
          quality: 'medium',
          onLoadingChange: setLoading,
          onPerformanceChange: import.meta.env.DEV ? setPerformanceMetrics : undefined,
          onError: (err) => {
            console.error('Volume renderer error:', err);
            setError(err.message);
          }
        });

        rendererRef.current = renderer;
        setVolumeRenderer(renderer);
      } catch (err) {
        console.error('Scene3D: Failed to create VolumeRenderer:', err);
        setError(`Failed to create renderer: ${err.message}`);
        setLoading(false);
        return;
      }

      // Load volume data
      renderer
        .loadData(dataPath)
        .then(() => {
          if (cancelled) return;
          setMetadata(renderer.getMetadata());
          onMetadataChange?.(renderer.getMetadata());
          setLoading(false);
        })
        .catch((err) => {
          if (cancelled) return;
          console.error('Failed to load volume data:', err);
          setError(`Failed to load data: ${err.message}`);
          setLoading(false);
        });
    };

    // Start initialization after a short delay to let CSS apply
    initializationFrame = requestAnimationFrame(initializeRenderer);

    // Cleanup on unmount
    return () => {
      cancelled = true;
      cancelAnimationFrame(initializationFrame);
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
    };
  }, [dataPath, onMetadataChange]);

  // Callback for children to interact with the renderer
  const getRenderer = useCallback(() => rendererRef.current, []);

  return (
    <>
      <div className={styles.sceneContainer} ref={containerRef}>
        {loading && <div className={styles.loading}>Loading volume data...</div>}
        {error && <div className={styles.error}>{error}</div>}
        {import.meta.env.DEV && performanceMetrics && (
          <div className={styles.performance} aria-label='Renderer performance'>
            {performanceMetrics.fps.toFixed(0)} FPS · {performanceMetrics.frameTimeMs.toFixed(1)} ms ·{' '}
            {performanceMetrics.qualityTier} · {performanceMetrics.raySteps} steps
          </div>
        )}
      </div>
      {/* Pass volumeRenderer to children */}
      {Children.map(children, (child) => {
        if (child) {
          return cloneElement(child, {
            volumeRenderer,
            metadata,
            getRenderer
          });
        }
        return child;
      })}
    </>
  );
};

Scene3D.propTypes = {
  children: PropTypes.node,
  dataPath: PropTypes.string,
  onMetadataChange: PropTypes.func
};

export default Scene3D;
