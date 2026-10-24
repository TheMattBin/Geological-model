/**
 * VolumeRenderer - Main class for 3D volumetric rendering using Three.js
 *
 * This class handles:
 * - WebGL context and Three.js scene setup
 * - Loading and displaying 3D voxel data
 * - Ray marching volume rendering
 * - Camera controls (orbit, pan, zoom)
 * - Slicing and cross-sections
 * - Variable switching
 * - Vertical exaggeration
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { VolumeRendererOptions, VolumeRendererState, VolumeMetadata, CameraState } from './types';
import { loadVolume, LoadedVolume, updateDiscreteTransferFunction } from './dataLoader';
import { volumeVertexShader, volumeFragmentShader, debugVertexShader, debugFragmentShader } from './shaders';
import type { DiscreteColor } from './types';
import { AdaptiveQualityController } from './renderQuality.mjs';
import { getCameraDistance, getNormalizedVolumeSize, validateVolumeMetadata } from './volumeGeometry.mjs';
import type { PerformanceMetrics } from './types';

export class VolumeRenderer {
  // Three.js core objects
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;

  // Volume rendering objects
  private volumeMesh: THREE.Mesh | null = null;
  private volumeMaterial: THREE.RawShaderMaterial | null = null;

  // Data
  private loadedVolume: LoadedVolume | null = null;
  private metadata: VolumeMetadata | null = null;

  // State
  private state: VolumeRendererState;
  private animationFrameId: number | null = null;
  private container: HTMLElement;
  private resizeObserver: ResizeObserver | null = null;
  private usesWindowResize = false;
  private renderRequested = false;
  private isInteracting = false;
  private qualityRecoveryFrames = 0;
  private cameraUniformDirty = true;
  private disposed = false;
  private previousFrameTime: number | null = null;
  private grid: THREE.GridHelper | null = null;
  private gridVisible = true;
  private loadController: AbortController | null = null;

  // Reused math objects avoid allocations in the render loop.
  private cameraPosition = new THREE.Vector3();
  private lastCameraPosition = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);
  private inverseVolumeMatrix = new THREE.Matrix4();

  // Callbacks
  private onLoadingChange?: (loading: boolean) => void;
  private onError?: (error: Error) => void;
  private onPerformanceChange?: (metrics: PerformanceMetrics) => void;

  // Quality and performance tracking
  private qualityController: AdaptiveQualityController;
  private frameSamples: number[] = [];
  private frameCount = 0;

  // Debug mode - set to true to use simple colored shader for debugging
  private debugMode = false;

  constructor(options: VolumeRendererOptions) {
    this.container = options.container;
    this.onLoadingChange = options.onLoadingChange;
    this.onError = options.onError;
    this.onPerformanceChange = options.onPerformanceChange;
    this.qualityController = new AdaptiveQualityController({
      devicePixelRatio: window.devicePixelRatio,
      initialTier: options.quality === 'low' ? 'interaction' : options.quality === 'high' ? 'high' : 'balanced'
    });

    // Initialize state
    this.state = {
      activeVariableId: 0,
      renderMode: options.renderMode || 'volume',
      verticalExaggeration: options.verticalExaggeration || 1,
      slices: {
        x: { enabled: false, axis: 'x', position: 0.5 },
        y: { enabled: false, axis: 'y', position: 0.5 },
        z: { enabled: false, axis: 'z', position: 0.5 }
      },
      sections: {
        NS: { enabled: false, orientation: 'NS', position: 1 },
        WE: { enabled: false, orientation: 'WE', position: 1 }
      },
      isosurface: {
        enabled: options.renderMode === 'surfaces',
        value: 0.5,
        opacity: 0.7
      }
    };

    // Initialize Three.js
    try {
      this.renderer = this.createRenderer(options.transparent);
      this.scene = this.createScene();
      this.camera = this.createCamera();
      this.controls = this.createControls();

      // Note: canvas is added to container inside createRenderer
    } catch (error) {
      console.error('VolumeRenderer: Failed to initialize Three.js', error);
      throw error;
    }

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.handleResize);
      this.resizeObserver.observe(this.container);
    } else {
      this.usesWindowResize = true;
      window.addEventListener('resize', this.handleResize);
    }

    this.controls.addEventListener('start', this.handleInteractionStart);
    this.controls.addEventListener('change', this.handleControlsChange);
    this.controls.addEventListener('end', this.handleInteractionEnd);

    // Start with one frame; subsequent frames are requested only while needed.
    this.requestRender();
  }

  private createRenderer(transparent: boolean = true): THREE.WebGLRenderer {
    // Create a canvas element explicitly
    const canvas = document.createElement('canvas');
    this.container.appendChild(canvas);

    try {
      const renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: false,
        alpha: transparent,
        powerPreference: 'high-performance'
      });

      renderer.setPixelRatio(this.qualityController.pixelRatio);

      // Use container dimensions, fall back to window if container has no size yet
      const width = this.container.clientWidth || window.innerWidth;
      const height = this.container.clientHeight || window.innerHeight;
      renderer.setSize(width, height);
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      return renderer;
    } catch (err) {
      // Remove the canvas we added
      if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`WebGL initialization failed: ${errorMsg}`);
    }
  }

  private createScene(): THREE.Scene {
    const scene = new THREE.Scene();
    scene.background = null; // Transparent
    return scene;
  }

  private createCamera(): THREE.PerspectiveCamera {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 10000);

    camera.up.set(0, 0, 1);

    // Default camera position
    camera.position.set(2, 2, 2);
    camera.lookAt(0, 0, 0);

    return camera;
  }

  private createControls(): OrbitControls {
    const controls = new OrbitControls(this.camera, this.renderer.domElement);

    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.5;
    controls.maxDistance = 100;
    controls.enablePan = true;
    controls.panSpeed = 0.5;
    controls.rotateSpeed = 0.5;
    controls.zoomSpeed = 1.0;

    return controls;
  }

  private handleResize = (): void => {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    if (width > 0 && height > 0) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
      this.requestRender();
    }
  };

  private requestRender = (): void => {
    if (this.disposed || this.animationFrameId !== null) return;

    this.renderRequested = true;
    this.animationFrameId = requestAnimationFrame(this.animate);
  };

  private handleInteractionStart = (): void => {
    this.isInteracting = true;
    this.qualityController.update(16, true);
    this.applyQualityProfile();
    this.requestRender();
  };

  private handleControlsChange = (): void => {
    this.cameraUniformDirty = true;
    this.requestRender();
  };

  private handleInteractionEnd = (): void => {
    this.isInteracting = false;
    this.qualityRecoveryFrames = 120;
    this.requestRender();
  };

  private applyQualityProfile = (): void => {
    if (!this.volumeMaterial || this.debugMode) return;

    this.volumeMaterial.uniforms.uSteps.value = this.qualityController.profile.steps;
    this.renderer.setPixelRatio(this.qualityController.pixelRatio);
  };

  private updateCameraUniform = (): void => {
    if (!this.volumeMaterial || this.debugMode || !this.volumeMaterial.uniforms.cameraPos || !this.volumeMesh) return;
    if (!this.cameraUniformDirty && this.camera.position.equals(this.lastCameraPosition)) return;

    this.cameraPosition.copy(this.camera.position);
    this.volumeMesh.updateMatrixWorld();
    this.inverseVolumeMatrix.copy(this.volumeMesh.matrixWorld).invert();
    this.cameraPosition.applyMatrix4(this.inverseVolumeMatrix);
    this.volumeMaterial.uniforms.cameraPos.value.copy(this.cameraPosition);
    this.lastCameraPosition.copy(this.camera.position);
    this.cameraUniformDirty = false;
  };

  private animate = (timestamp: number): void => {
    this.animationFrameId = null;
    if (this.disposed || !this.renderRequested) return;

    this.renderRequested = false;
    const frameTimeMs = this.previousFrameTime === null ? null : timestamp - this.previousFrameTime;
    this.previousFrameTime = timestamp;
    const controlsChanged = this.controls.update();
    this.updateCameraUniform();
    this.renderer.render(this.scene, this.camera);

    if (frameTimeMs !== null) this.frameSamples.push(frameTimeMs);
    this.frameCount += 1;
    if (this.frameSamples.length > 30) this.frameSamples.shift();

    const nextProfile = this.qualityController.update(frameTimeMs ?? 16.67, this.isInteracting);
    const currentSteps = this.volumeMaterial && !this.debugMode ? this.volumeMaterial.uniforms.uSteps.value : -1;
    const qualityChanged = nextProfile.steps !== currentSteps && currentSteps !== -1;
    if (qualityChanged) {
      this.applyQualityProfile();
    }

    if (this.onPerformanceChange && this.frameSamples.length > 0 && this.frameCount % 30 === 0) {
      const averageFrameTime = this.frameSamples.reduce((sum, value) => sum + value, 0) / this.frameSamples.length;
      this.onPerformanceChange({
        fps: averageFrameTime > 0 ? 1000 / averageFrameTime : 0,
        frameTimeMs: averageFrameTime,
        qualityTier: this.qualityController.profile.tier,
        raySteps: this.qualityController.profile.steps,
        pixelRatio: this.qualityController.pixelRatio
      });
    }

    const shouldContinueRendering =
      this.isInteracting || controlsChanged || this.qualityRecoveryFrames > 0 || qualityChanged;
    if (!this.isInteracting && this.qualityRecoveryFrames > 0) this.qualityRecoveryFrames -= 1;
    if (shouldContinueRendering) this.requestRender();
    else this.previousFrameTime = null;
  };

  /**
   * Load volume data from the specified path
   */
  async loadData(basePath: string): Promise<void> {
    this.loadController?.abort();
    const controller = new AbortController();
    this.loadController = controller;
    this.onLoadingChange?.(true);
    try {
      const loaded = await loadVolume(basePath, undefined, controller.signal);
      if (this.disposed || controller.signal.aborted) {
        this.disposeVolumeTextures(loaded);
        return;
      }
      if (this.loadedVolume) this.disposeVolumeTextures(this.loadedVolume);
      this.loadedVolume = loaded;
      this.metadata = loaded.metadata;
      this.state.activeVariableId = this.metadata.variables[0].id;
      this.createVolumeMesh();
      this.fitCameraToVolume();
      this.requestRender();
      this.onLoadingChange?.(false);
    } catch (error) {
      if (this.disposed || controller.signal.aborted) return;
      this.onLoadingChange?.(false);
      this.onError?.(error as Error);
      throw error;
    }
  }

  private disposeVolumeTextures(volume: LoadedVolume): void {
    for (const texture of volume.textures.values()) texture.dispose();
    for (const texture of volume.transferFunctions.values()) texture.dispose();
  }

  private createVolumeMesh(): void {
    if (!this.loadedVolume || !this.metadata) return;

    const metadataWarnings = validateVolumeMetadata(this.metadata);
    metadataWarnings.forEach((warning) => console.warn(`Volume metadata: ${warning}`));

    // Remove existing mesh and wireframe
    if (this.volumeMesh) {
      this.scene.remove(this.volumeMesh);
      this.volumeMesh.geometry.dispose();
      this.volumeMaterial?.dispose();
      this.volumeMesh = null;
      this.volumeMaterial = null;
    }

    // Remove old debug wireframe
    const oldWireframe = this.scene.getObjectByName('debugWireframe');
    if (oldWireframe) {
      this.scene.remove(oldWireframe);
      if (oldWireframe instanceof THREE.LineSegments) {
        oldWireframe.geometry.dispose();
        (oldWireframe.material as THREE.Material).dispose();
      }
    }

    // Keep shader bounds in the un-exaggerated local coordinate system. The
    // display-only Z scale is applied to the mesh below.
    const normalizedSize = getNormalizedVolumeSize(this.metadata);
    const size = new THREE.Vector3(normalizedSize.x, normalizedSize.y, normalizedSize.z);

    // Create box geometry for ray marching
    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);

    // Debug mode: use simple colored material
    if (this.debugMode) {
      this.volumeMaterial = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: debugVertexShader,
        fragmentShader: debugFragmentShader,
        uniforms: {},
        side: THREE.DoubleSide,
        transparent: true,
        depthTest: true,
        depthWrite: true
      });
    } else {
      // Get active variable
      const activeVar = this.metadata.variables.find((v) => v.id === this.state.activeVariableId);
      const isDiscrete = activeVar?.type === 'discrete';

      // Create bounds vectors
      const boundsMin = new THREE.Vector3(-size.x / 2, -size.y / 2, -size.z / 2);
      const boundsMax = new THREE.Vector3(size.x / 2, size.y / 2, size.z / 2);

      // Create shader material
      this.volumeMaterial = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: volumeVertexShader,
        fragmentShader: volumeFragmentShader,
        uniforms: {
          uVolumeData: { value: this.loadedVolume.textures.get(this.state.activeVariableId) },
          uTransferFunction: { value: this.loadedVolume.transferFunctions.get(this.state.activeVariableId) },
          uDiscreteMode: { value: isDiscrete },
          uFloatData: { value: activeVar?.dtype === 'float32' },
          uValueRange: { value: new THREE.Vector2(0, 1) },
          uHasNoData: { value: activeVar?.noDataValue !== undefined },
          uNoDataValue: { value: 0 },
          uVolumeDimensions: {
            value: new THREE.Vector3(this.metadata.dimensions.x, this.metadata.dimensions.y, this.metadata.dimensions.z)
          },
          uBoundsMin: { value: boundsMin },
          uBoundsMax: { value: boundsMax },
          uSteps: { value: this.qualityController.profile.steps },
          uDensity: { value: 0.18 },
          cameraPos: { value: new THREE.Vector3() },

          // Slice uniforms
          uSliceXEnabled: { value: this.state.slices.x.enabled },
          uSliceXMin: { value: 0 },
          uSliceXMax: { value: 1 },
          uSliceYEnabled: { value: this.state.slices.y.enabled },
          uSliceYMin: { value: 0 },
          uSliceYMax: { value: 1 },
          uSliceZEnabled: { value: this.state.slices.z.enabled },
          uSliceZMin: { value: 0 },
          uSliceZMax: { value: 1 },

          // Section uniforms
          uSectionNSEnabled: { value: this.state.sections.NS.enabled },
          uSectionNSPosition: { value: this.state.sections.NS.position },
          uSectionWEEnabled: { value: this.state.sections.WE.enabled },
          uSectionWEPosition: { value: this.state.sections.WE.position },

          // Isosurface uniforms
          uIsosurfaceEnabled: { value: this.state.isosurface.enabled },
          uIsosurfaceValue: { value: this.state.isosurface.value },
          uIsosurfaceColor: { value: new THREE.Vector3(0.2, 0.6, 1.0) }, // Light blue
          uIsosurfaceOpacity: { value: this.state.isosurface.opacity },

          // Vertical exaggeration
          uVerticalExaggeration: { value: this.state.verticalExaggeration }
        },
        premultipliedAlpha: true,
        side: THREE.BackSide,
        transparent: true,
        depthTest: true,
        depthWrite: false
      });
    }

    // Check for shader compilation errors

    this.volumeMesh = new THREE.Mesh(geometry, this.volumeMaterial);
    this.volumeMesh.scale.z = this.state.verticalExaggeration;
    this.scene.add(this.volumeMesh);
    this.setActiveVariable(this.state.activeVariableId);
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.dispose();
    }
    this.grid = new THREE.GridHelper(1, 10, 0x82939d, 0x586873);
    this.grid.rotation.x = Math.PI / 2;
    this.grid.scale.set(size.x * 1.3, 1, size.y * 1.3);
    this.grid.position.z = (-size.z * this.state.verticalExaggeration) / 2 - 0.01;
    this.grid.visible = this.gridVisible;
    this.scene.add(this.grid);

    this.cameraUniformDirty = true;
  }

  private fitCameraToVolume(): void {
    if (!this.metadata) return;

    const size = getNormalizedVolumeSize(this.metadata, this.state.verticalExaggeration);
    const distance = getCameraDistance(size, this.camera.fov, 1.35, this.camera.aspect);
    const direction = new THREE.Vector3(1, 0.8, 0.6).normalize();

    this.camera.position.copy(direction).multiplyScalar(distance);
    this.camera.lookAt(0, 0, 0);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.cameraUniformDirty = true;
    this.requestRender();
  }

  /**
   * Set the active variable for visualization
   */
  setActiveVariable(variableId: number): void {
    if (!this.loadedVolume || !this.volumeMaterial) {
      return;
    }

    // In debug mode, uniforms are not set up
    if (this.debugMode) {
      this.state.activeVariableId = variableId;
      return;
    }

    const variable = this.metadata?.variables.find((v) => v.id === variableId);
    if (!variable) {
      return;
    }

    this.state.activeVariableId = variableId;

    // Update textures
    const volumeTexture = this.loadedVolume.textures.get(variableId);
    const transferTexture = this.loadedVolume.transferFunctions.get(variableId);

    this.volumeMaterial.uniforms.uVolumeData.value = volumeTexture;
    this.volumeMaterial.uniforms.uTransferFunction.value = transferTexture;
    this.volumeMaterial.uniforms.uDiscreteMode.value = variable.type === 'discrete';
    this.volumeMaterial.uniforms.uFloatData.value = variable.dtype === 'float32';
    const range = variable.dtype === 'float32' ? variable.range : variable.encodingRange;
    this.volumeMaterial.uniforms.uValueRange.value.set(range?.min ?? 0, range?.max ?? 1);
    this.volumeMaterial.uniforms.uHasNoData.value = variable.noDataValue !== undefined;
    this.volumeMaterial.uniforms.uNoDataValue.value =
      (variable.noDataValue ?? 0) / (variable.dtype === 'float32' ? 1 : 255);

    this.requestRender();
  }

  /**
   * Set vertical exaggeration
   */
  setVerticalExaggeration(value: number): void {
    const previousExaggeration = this.state.verticalExaggeration;
    value = Math.max(0.1, Math.min(10, Number.isFinite(value) ? value : 1));
    this.state.verticalExaggeration = value;
    if (this.volumeMesh) {
      this.volumeMesh.scale.z = value;
      this.volumeMesh.updateMatrixWorld();
      this.cameraUniformDirty = true;
    }

    if (this.volumeMaterial && !this.debugMode) this.volumeMaterial.uniforms.uVerticalExaggeration.value = value;
    if (this.metadata && this.grid) {
      this.grid.position.z = -getNormalizedVolumeSize(this.metadata, value).z / 2 - 0.01;
    }
    if (this.metadata && previousExaggeration !== value) {
      const previousSize = getNormalizedVolumeSize(this.metadata, previousExaggeration);
      const nextSize = getNormalizedVolumeSize(this.metadata, value);
      const previousDistance = getCameraDistance(previousSize, this.camera.fov);
      const nextDistance = getCameraDistance(nextSize, this.camera.fov);
      const cameraOffset = this.camera.position.clone().sub(this.controls.target);

      if (cameraOffset.lengthSq() > 0 && previousDistance > 0) {
        cameraOffset.multiplyScalar(nextDistance / previousDistance);
        this.camera.position.copy(this.controls.target).add(cameraOffset);
        this.camera.lookAt(this.controls.target);
        this.controls.update();
      } else {
        this.fitCameraToVolume();
      }
    }

    this.requestRender();
  }

  /**
   * Enable/disable and set slice position
   */
  setSlice(axis: 'x' | 'y' | 'z', enabled: boolean, min?: number, max?: number): void {
    this.state.slices[axis].enabled = enabled;

    if (!this.volumeMaterial || this.debugMode) {
      return;
    }

    const axisUpper = axis.toUpperCase();
    this.volumeMaterial.uniforms[`uSlice${axisUpper}Enabled`].value = enabled;

    if (min !== undefined) {
      this.volumeMaterial.uniforms[`uSlice${axisUpper}Min`].value = min;
    }
    if (max !== undefined) {
      this.volumeMaterial.uniforms[`uSlice${axisUpper}Max`].value = max;
    }
    this.requestRender();
  }

  /**
   * Enable/disable and set section position
   */
  setSection(orientation: 'NS' | 'WE', enabled: boolean, position?: number): void {
    this.state.sections[orientation].enabled = enabled;
    if (position !== undefined) {
      position = THREE.MathUtils.clamp(position, 0, 1);
      this.state.sections[orientation].position = position;
    }

    if (!this.volumeMaterial || this.debugMode) {
      return;
    }

    this.volumeMaterial.uniforms[`uSection${orientation}Enabled`].value = enabled;
    if (position !== undefined) {
      this.volumeMaterial.uniforms[`uSection${orientation}Position`].value = position;
    }
    this.requestRender();
  }

  /**
   * Enable/disable and set isosurface value
   */
  setIsosurface(enabled: boolean, value?: number, color?: [number, number, number]): void {
    this.state.isosurface.enabled = enabled;
    this.state.renderMode = enabled ? 'surfaces' : 'volume';
    if (value !== undefined) {
      this.state.isosurface.value = value;
    }

    if (!this.volumeMaterial || this.debugMode) {
      return;
    }

    this.volumeMaterial.uniforms.uIsosurfaceEnabled.value = enabled;
    if (value !== undefined) {
      // Normalize value to 0-1 range based on metadata
      const variable = this.metadata?.variables.find((v) => v.id === this.state.activeVariableId);
      if (variable && variable.range) {
        const normalizedValue =
          (value - variable.range.min) / Math.max(variable.range.max - variable.range.min, Number.EPSILON);
        this.volumeMaterial.uniforms.uIsosurfaceValue.value = normalizedValue;
      } else {
        this.volumeMaterial.uniforms.uIsosurfaceValue.value = value;
      }
    }
    if (color) {
      this.volumeMaterial.uniforms.uIsosurfaceColor.value.set(color[0], color[1], color[2]);
    }
    this.requestRender();
  }

  /**
   * Update discrete colormap (e.g., toggle class visibility)
   */
  updateColormap(variableId: number, colormap: DiscreteColor[]): void {
    if (!this.loadedVolume) return;

    const texture = this.loadedVolume.transferFunctions.get(variableId);
    if (texture) {
      updateDiscreteTransferFunction(texture, colormap);
    }
    this.requestRender();
  }

  setGridVisible(visible: boolean): void {
    this.gridVisible = visible;
    if (this.grid) this.grid.visible = visible;
    this.requestRender();
  }

  /**
   * Get current camera state
   */
  getCameraState(): CameraState {
    return {
      position: this.camera.position.toArray() as [number, number, number],
      target: this.controls.target.toArray() as [number, number, number],
      zoom: this.camera.zoom
    };
  }

  /**
   * Set camera state
   */
  setCameraState(state: CameraState): void {
    this.camera.position.fromArray(state.position);
    this.controls.target.fromArray(state.target);
    this.camera.zoom = state.zoom;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.cameraUniformDirty = true;
    this.requestRender();
  }

  /**
   * Get the current state
   */
  getState(): VolumeRendererState {
    return { ...this.state };
  }

  /**
   * Get metadata
   */
  getMetadata(): VolumeMetadata | null {
    return this.metadata;
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    this.disposed = true;
    this.loadController?.abort();
    this.grid?.dispose();

    // Stop the pending frame
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.resizeObserver?.disconnect();
    if (this.usesWindowResize) window.removeEventListener('resize', this.handleResize);
    this.controls.removeEventListener('start', this.handleInteractionStart);
    this.controls.removeEventListener('change', this.handleControlsChange);
    this.controls.removeEventListener('end', this.handleInteractionEnd);

    // Dispose Three.js objects
    if (this.volumeMesh) {
      this.volumeMesh.geometry.dispose();
    }
    if (this.volumeMaterial) {
      this.volumeMaterial.dispose();
    }

    // Dispose textures
    if (this.loadedVolume) {
      for (const texture of this.loadedVolume.textures.values()) texture.dispose();
      for (const texture of this.loadedVolume.transferFunctions.values()) texture.dispose();
    }

    this.controls.dispose();
    this.renderer.dispose();

    // Remove canvas from container
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
