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
import {
  loadMetadata,
  loadVariable,
  checkVolumeLimits,
  LoadedVolume,
  updateDiscreteTransferFunction
} from './dataLoader';
import { volumeVertexShader, volumeFragmentShader, debugVertexShader, debugFragmentShader } from './shaders';
import type { DiscreteColor } from './types';
import { AdaptiveQualityController } from './renderQuality.mjs';
import { getCameraDistance, getNormalizedVolumeSize, validateVolumeMetadata } from './volumeGeometry.mjs';
import type { PerformanceMetrics, Histogram, VoxelInspection, ColorStop } from './types';
import { buildHistogram, inspectRay, physicalValue } from './volumeAnalysis';

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
  private variableController: AbortController | null = null;
  private basePath = '';
  private selection = 0;
  private annotations: THREE.Group | null = null;
  private histogramCache = new Map<number, Histogram>();
  private continuousOpacity = 1;
  private valueWindow: [number, number] = [0, 1];
  private onProgress?: (message: string) => void;

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
    this.onProgress = options.onProgress;
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
  async loadData(basePath: string, initialVariableId?: number): Promise<void> {
    this.loadController?.abort();
    this.variableController?.abort();
    this.selection++;
    const controller = new AbortController();
    this.loadController = controller;
    this.onLoadingChange?.(true);
    this.onProgress?.('Loading dataset metadata…');
    let pending: Awaited<ReturnType<typeof loadVariable>> | undefined;
    try {
      const metadata = await loadMetadata(basePath, controller.signal);
      const gl = this.renderer.getContext() as WebGL2RenderingContext;
      checkVolumeLimits(metadata, gl.getParameter(gl.MAX_3D_TEXTURE_SIZE));
      if (
        metadata.variables.some(
          (v) => v.dtype === 'float32' && v.type === 'continuous' && v.noDataValue === undefined
        ) &&
        !gl.getExtension('OES_texture_float_linear')
      ) {
        throw new Error('This device cannot interpolate float32 textures. Convert continuous data to uint8.');
      }
      const variable = metadata.variables.find((v) => v.id === initialVariableId) ?? metadata.variables[0];
      pending = await loadVariable(basePath, metadata, variable, controller.signal, this.onProgress);
      if (this.disposed || controller.signal.aborted) {
        pending.texture.dispose();
        pending.transfer.dispose();
        return;
      }
      if (this.loadedVolume) this.disposeVolumeTextures(this.loadedVolume);
      this.histogramCache.clear();
      this.basePath = basePath;
      this.loadedVolume = {
        metadata,
        textures: new Map([[variable.id, pending.texture]]),
        transferFunctions: new Map([[variable.id, pending.transfer]])
      };
      pending = undefined;
      this.metadata = metadata;
      this.state.activeVariableId = variable.id;
      this.valueWindow = [variable.range?.min ?? 0, variable.range?.max ?? 1];
      this.state.isosurface.value = (this.valueWindow[0] + this.valueWindow[1]) / 2;
      this.createVolumeMesh();
      this.fitCameraToVolume();
      this.requestRender();
      this.onLoadingChange?.(false);
    } catch (error) {
      pending?.texture.dispose();
      pending?.transfer.dispose();
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
          uWindow: { value: new THREE.Vector2(0, 1) },
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
    this.applyActiveVariable(this.state.activeVariableId);
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
    this.createAnnotations();

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
  async setActiveVariable(variableId: number): Promise<void> {
    if (!this.loadedVolume || !this.metadata || this.disposed) return;
    const variable = this.metadata.variables.find((v) => v.id === variableId);
    if (!variable) return;
    const selection = ++this.selection;
    this.variableController?.abort();
    const controller = new AbortController();
    this.variableController = controller;
    this.onLoadingChange?.(true);
    if (!this.loadedVolume.textures.has(variableId)) {
      this.onProgress?.(`Loading ${variable.name}…`);
      try {
        const loaded = await loadVariable(this.basePath, this.metadata, variable, controller.signal, this.onProgress);
        if (this.disposed || selection !== this.selection) {
          loaded.texture.dispose();
          loaded.transfer.dispose();
          return;
        }
        this.loadedVolume.textures.set(variableId, loaded.texture);
        this.loadedVolume.transferFunctions.set(variableId, loaded.transfer);
      } catch (error) {
        if (controller.signal.aborted || this.disposed) return;
        this.onLoadingChange?.(false);
        this.onError?.(error as Error);
        throw error;
      }
    }
    if (selection !== this.selection) return;
    this.applyActiveVariable(variableId);
    // LRU cache capped at 256 MiB of raw data, excluding only the active entry from eviction.
    const active = this.loadedVolume.textures.get(variableId)!;
    this.loadedVolume.textures.delete(variableId);
    this.loadedVolume.textures.set(variableId, active);
    let bytes = [...this.loadedVolume.textures.values()].reduce(
      (total, texture) => total + texture.image.data!.byteLength,
      0
    );
    for (const [id, texture] of this.loadedVolume.textures) {
      if (bytes <= 256 * 1024 * 1024) break;
      if (id === variableId) continue;
      bytes -= texture.image.data!.byteLength;
      texture.dispose();
      this.loadedVolume.transferFunctions.get(id)?.dispose();
      this.loadedVolume.textures.delete(id);
      this.loadedVolume.transferFunctions.delete(id);
      this.histogramCache.delete(id);
    }
    this.onLoadingChange?.(false);
  }

  private applyActiveVariable(variableId: number): void {
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

    if (this.state.activeVariableId !== variableId) {
      this.valueWindow = [variable.range?.min ?? 0, variable.range?.max ?? 1];
      this.state.isosurface.value = (this.valueWindow[0] + this.valueWindow[1]) / 2;
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

    this.setContinuousStyle(this.continuousOpacity, this.valueWindow);
    this.setIsosurface(this.state.isosurface.enabled, this.state.isosurface.value);
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

    if (previousExaggeration !== value) this.createAnnotations();
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
        const normalizedValue = (value - variable.range.min) / (variable.range.max - variable.range.min || 1);
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
    if (this.annotations) this.annotations.visible = visible;
    this.requestRender();
  }

  setContinuousStyle(opacity: number, window: [number, number]): void {
    this.continuousOpacity = Math.max(0, Math.min(3, opacity));
    this.valueWindow = window;
    if (!this.volumeMaterial || this.debugMode) return;
    this.volumeMaterial.uniforms.uDensity.value = 0.18 * this.continuousOpacity;
    this.volumeMaterial.uniforms.uIsosurfaceOpacity.value = Math.min(1, 0.7 * this.continuousOpacity);
    const variable = this.metadata?.variables.find((v) => v.id === this.state.activeVariableId);
    const range = variable?.range ?? { min: 0, max: 1 };
    const normalize = (value: number) =>
      range.max === range.min ? (value <= range.min ? 0 : 1) : (value - range.min) / (range.max - range.min);
    this.volumeMaterial.uniforms.uWindow.value.set(
      normalize(window[0]),
      range.max === range.min ? 1 : normalize(window[1])
    );
    this.requestRender();
  }

  getHistogram(): Histogram | null {
    const id = this.state.activeVariableId;
    const variable = this.metadata?.variables.find((v) => v.id === id);
    const texture = this.loadedVolume?.textures.get(id);
    if (!variable || variable.type !== 'continuous' || !texture) return null;
    if (!this.histogramCache.has(id)) this.histogramCache.set(id, buildHistogram(texture.image.data!, variable));
    return this.histogramCache.get(id)!;
  }

  inspect(clientX: number, clientY: number): VoxelInspection | null {
    if (!this.volumeMesh || !this.metadata || !this.loadedVolume) return null;
    const variable = this.metadata.variables.find((v) => v.id === this.state.activeVariableId)!;
    const data = this.loadedVolume.textures.get(variable.id)?.image.data;
    if (!data || (variable.type === 'continuous' && this.continuousOpacity === 0)) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const caster = new THREE.Raycaster();
    this.camera.updateMatrixWorld();
    this.volumeMesh.updateMatrixWorld();
    caster.setFromCamera(
      new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, 1 - ((clientY - rect.top) / rect.height) * 2),
      this.camera
    );
    const local = caster.ray.clone().applyMatrix4(this.volumeMesh.matrixWorld.clone().invert());
    const size = getNormalizedVolumeSize(this.metadata);
    const span = new THREE.Vector3(size.x, size.y, size.z);
    local.origin.divide(span).addScalar(0.5);
    local.direction.divide(span).normalize();
    const clip = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1));
    if (this.state.sections.NS.enabled) clip.max.x = this.state.sections.NS.position;
    if (this.state.sections.WE.enabled) clip.max.y = this.state.sections.WE.position;
    for (const axis of ['x', 'y', 'z'] as const) {
      if (!this.state.slices[axis].enabled) continue;
      const prefix = `uSlice${axis.toUpperCase()}`;
      clip.min[axis] = this.volumeMaterial!.uniforms[`${prefix}Min`].value;
      clip.max[axis] = Math.min(clip.max[axis], this.volumeMaterial!.uniforms[`${prefix}Max`].value);
    }
    if (clip.max.x <= clip.min.x || clip.max.y <= clip.min.y || clip.max.z <= clip.min.z) return null;
    const transfer = this.loadedVolume.transferFunctions.get(variable.id)!.image.data!;
    return inspectRay(local, clip, this.metadata, data, variable, (raw, previous) => {
      if (variable.type === 'discrete') return raw >= 0 && raw <= 255 && transfer[Math.round(raw) * 4 + 3] > 0;
      const value = physicalValue(raw, variable);
      if (value < this.valueWindow[0] || value > this.valueWindow[1]) return false;
      if (this.state.isosurface.enabled) {
        if (previous === null) return false;
        const before = physicalValue(previous, variable);
        return (
          before >= this.valueWindow[0] &&
          before <= this.valueWindow[1] &&
          before !== value &&
          (before - this.state.isosurface.value) * (value - this.state.isosurface.value) <= 0
        );
      }
      const range = variable.range ?? { min: 0, max: 1 };
      const index = Math.round(THREE.MathUtils.clamp((value - range.min) / (range.max - range.min || 1), 0, 1) * 255);
      return transfer[index * 4 + 3] > 0;
    });
  }

  setCameraPreset(preset: 'reset' | 'top' | 'front' | 'side'): void {
    if (!this.metadata) return;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = true;
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    if (preset === 'reset') {
      this.fitCameraToVolume();
      return;
    }
    const distance = getCameraDistance(
      getNormalizedVolumeSize(this.metadata, this.state.verticalExaggeration),
      this.camera.fov,
      1.35,
      this.camera.aspect
    );
    // Tiny Y offset avoids the top view's singularity with Z-up orbit controls.
    const direction =
      preset === 'top'
        ? new THREE.Vector3(0, -0.00001, 1)
        : preset === 'front'
          ? new THREE.Vector3(0, -1, 0)
          : new THREE.Vector3(1, 0, 0);
    this.setCameraState({
      position: direction.normalize().multiplyScalar(distance).toArray(),
      target: [0, 0, 0],
      zoom: 1
    });
  }

  /** Render and copy in the same task; no persistent drawing buffer is needed. */
  exportImage(): string {
    if (!this.metadata) throw new Error('Load a dataset before exporting.');
    this.updateCameraUniform();
    this.renderer.render(this.scene, this.camera);
    const source = this.renderer.domElement;
    const variable = this.metadata.variables.find((v) => v.id === this.state.activeVariableId)!;
    const palette = variable.colormap;
    const footer = 140 + (variable.type === 'discrete' ? Math.ceil(palette.length / 3) * 26 : 60);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(900, source.width);
    canvas.height = Math.round((source.height * canvas.width) / source.width) + footer;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#111c28';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const sceneHeight = canvas.height - footer;
    ctx.drawImage(source, 0, 0, canvas.width, sceneHeight);
    ctx.font = '18px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${variable.name} · Vertical exaggeration ${this.state.verticalExaggeration}×`, 24, sceneHeight + 30);
    ctx.font = '14px sans-serif';
    ctx.fillText(
      this.metadata.synthetic
        ? 'Synthetic demonstration dataset — not surveyed geology'
        : (this.metadata.provenance?.source ?? this.metadata.description ?? 'Geological volume'),
      24,
      sceneHeight + 55,
      canvas.width - 48
    );
    const sections = this.state.sections;
    ctx.fillText(
      `N–S: ${sections.NS.enabled ? Math.round(sections.NS.position * 100) + '%' : 'off'} · W–E: ${sections.WE.enabled ? Math.round(sections.WE.position * 100) + '%' : 'off'} · Coordinates: ${this.metadata.coordinateUnit ?? 'dataset units'}`,
      24,
      sceneHeight + 80
    );
    if (variable.type === 'continuous') {
      const gradient = ctx.createLinearGradient(24, 0, canvas.width - 24, 0);
      for (const stop of palette as ColorStop[])
        gradient.addColorStop(stop.position, `rgb(${stop.color.slice(0, 3).join(',')})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(24, sceneHeight + 100, canvas.width - 48, 20);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(
        `${variable.range?.min ?? 0} – ${variable.range?.max ?? 1} ${variable.unit ?? ''} · Window: ${this.valueWindow.join(' – ')} · Opacity: ${this.continuousOpacity}×${this.state.isosurface.enabled ? ` · Isosurface: ${this.state.isosurface.value}` : ''}`,
        24,
        sceneHeight + 150,
        canvas.width - 48
      );
    } else {
      const transfer = this.loadedVolume!.transferFunctions.get(variable.id)!.image.data!;
      (palette as DiscreteColor[]).forEach((entry, i) => {
        const x = 24 + (i % 3) * ((canvas.width - 48) / 3),
          y = sceneHeight + 110 + Math.floor(i / 3) * 26;
        ctx.fillStyle = `rgb(${entry.color.slice(0, 3).join(',')})`;
        ctx.fillRect(x, y - 12, 16, 16);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(
          `${entry.label}${transfer[entry.value * 4 + 3] ? '' : ' (hidden)'}`,
          x + 24,
          y,
          (canvas.width - 48) / 3 - 30
        );
      });
    }
    return canvas.toDataURL('image/png');
  }

  private disposeAnnotations(): void {
    if (!this.annotations) return;
    this.scene.remove(this.annotations);
    this.annotations.traverse((object) => {
      if (object instanceof THREE.Line || object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
        if ('geometry' in object) object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose();
          material.dispose();
        }
      }
    });
    this.annotations = null;
  }

  private createAnnotations(): void {
    this.disposeAnnotations();
    if (!this.metadata) return;
    const size = getNormalizedVolumeSize(this.metadata, this.state.verticalExaggeration);
    const group = new THREE.Group();
    const origin = new THREE.Vector3(-size.x / 2 - 0.04, -size.y / 2 - 0.04, -size.z / 2);
    const label = (text: string, point: THREE.Vector3, color = '#e2e8f0') => {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.font = '28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = color;
      ctx.fillText(text, 256, 42);
      const map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthTest: false, sizeAttenuation: false }));
      sprite.position.copy(point);
      sprite.scale.set(0.25, 0.03125, 1);
      group.add(sprite);
    };
    const axes = [
      { text: 'X · East', direction: new THREE.Vector3(1, 0, 0), length: size.x, color: 0xfca5a5 },
      { text: 'Y · North', direction: new THREE.Vector3(0, 1, 0), length: size.y, color: 0x86efac },
      { text: 'Z · Elevation', direction: new THREE.Vector3(0, 0, 1), length: size.z, color: 0x93c5fd }
    ];
    for (const axis of axes) {
      group.add(new THREE.ArrowHelper(axis.direction, origin, axis.length + 0.04, axis.color, 0.025, 0.015));
      label(axis.text, origin.clone().addScaledVector(axis.direction, axis.length + 0.09));
    }
    const span = this.metadata.bounds.x.max - this.metadata.bounds.x.min;
    const power = 10 ** Math.floor(Math.log10(span / 4));
    const length = [5, 2, 1].map((n) => n * power).find((n) => n <= span / 4) ?? power;
    const start = new THREE.Vector3(-size.x / 2, size.y / 2 + 0.13, -size.z / 2);
    const end = start.clone().add(new THREE.Vector3((size.x * length) / span, 0, 0));
    const tick = new THREE.Vector3(0, 0.015, 0);
    const points = [
      start,
      end,
      start.clone().sub(tick),
      start.clone().add(tick),
      end.clone().sub(tick),
      end.clone().add(tick)
    ];
    group.add(
      new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: 0xe2e8f0 })
      )
    );
    label(
      `${Number(length.toPrecision(3))} ${this.metadata.coordinateUnit ?? 'units'}`,
      start
        .clone()
        .lerp(end, 0.5)
        .add(new THREE.Vector3(0, 0.055, 0))
    );
    group.visible = this.gridVisible;
    this.annotations = group;
    this.scene.add(group);
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
    this.variableController?.abort();
    this.disposeAnnotations();
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
