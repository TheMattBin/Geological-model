/**
 * Data loader for voxel volume data
 *
 * Loads binary .raw files and metadata.json for 3D volume visualization
 */

import * as THREE from 'three';
import { parseMetadata } from './metadata';
import { fingerprintMetadata, sha256 } from './datasetIdentity';
import type { VolumeMetadata, VariableMetadata, ColorStop, DiscreteColor } from './types';

export interface LoadedVolume {
  metadata: VolumeMetadata;
  textures: Map<number, THREE.Data3DTexture>;
  transferFunctions: Map<number, THREE.DataTexture>;
}

/**
 * Load volume metadata from JSON file
 */
export async function loadMetadata(basePath: string, signal?: AbortSignal): Promise<VolumeMetadata> {
  const response = await fetch(`${basePath}/metadata.json`, { signal });
  if (!response.ok) {
    throw new Error(`Failed to load metadata: ${response.statusText}`);
  }
  const metadata = parseMetadata(await response.json());
  metadata.datasetFingerprint = await fingerprintMetadata(metadata);
  signal?.throwIfAborted();
  return metadata;
}

/**
 * Load raw binary volume data as ArrayBuffer
 */
export async function loadRawData(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to load volume data: ${response.statusText}`);
  }
  return response.arrayBuffer();
}

/**
 * Create a 3D texture from raw volume data
 */
export function createVolumeTexture(
  data: ArrayBuffer,
  dimensions: { x: number; y: number; z: number },
  dtype: 'uint8' | 'float32' = 'uint8',
  discrete = false
): THREE.Data3DTexture {
  const { x, y, z } = dimensions;
  const expectedSize = x * y * z * (dtype === 'float32' ? 4 : 1);

  if (data.byteLength !== expectedSize) {
    throw new Error(`Data size mismatch: expected ${expectedSize} bytes, got ${data.byteLength}`);
  }

  // Create typed array from buffer
  const typedArray = dtype === 'float32' ? new Float32Array(data) : new Uint8Array(data);

  // Create 3D texture
  const texture = new THREE.Data3DTexture(
    typedArray,
    x, // width
    y, // height
    z // depth
  );

  texture.format = THREE.RedFormat;
  texture.type = dtype === 'float32' ? THREE.FloatType : THREE.UnsignedByteType;
  // Categorical lithology values must not be interpolated between classes;
  // continuous variables benefit from trilinear interpolation.
  texture.minFilter = discrete ? THREE.NearestFilter : THREE.LinearFilter;
  texture.magFilter = discrete ? THREE.NearestFilter : THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;

  return texture;
}

/**
 * Create a transfer function texture for discrete (categorical) data
 */
export function createDiscreteTransferFunction(colormap: DiscreteColor[]): THREE.DataTexture {
  // Index by actual class value; unmapped values remain transparent.
  const numClasses = 256;
  const data = new Uint8Array(numClasses * 4);
  const values = new Set<number>();

  for (let i = 0; i < colormap.length; i++) {
    const color = colormap[i];
    if (!Number.isInteger(color.value) || color.value < 0 || color.value > 255 || values.has(color.value)) {
      throw new Error('Discrete class values must be unique integers between 0 and 255');
    }
    values.add(color.value);
    const enabled = color.enabled !== false;
    const offset = color.value * 4;
    data[offset + 0] = color.color[0];
    data[offset + 1] = color.color[1];
    data[offset + 2] = color.color[2];
    data[offset + 3] = enabled ? color.color[3] : 0;
  }

  const texture = new THREE.DataTexture(data, numClasses, 1, THREE.RGBAFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;

  return texture;
}

/**
 * Create a transfer function texture for continuous data
 */
export function createContinuousTransferFunction(colormap: ColorStop[], resolution: number = 256): THREE.DataTexture {
  if (colormap.length === 0 || colormap.some((stop) => !Number.isFinite(stop.position))) {
    throw new Error('Continuous colormap requires finite color stops');
  }
  const data = new Uint8Array(resolution * 4);

  // Sort colormap by position
  const sortedColormap = [...colormap].sort((a, b) => a.position - b.position);

  for (let i = 0; i < resolution; i++) {
    const t = Math.max(
      sortedColormap[0].position,
      Math.min(sortedColormap[sortedColormap.length - 1].position, i / (resolution - 1))
    );

    // Find surrounding color stops
    let lowerIndex = 0;
    let upperIndex = sortedColormap.length - 1;

    for (let j = 0; j < sortedColormap.length - 1; j++) {
      if (t >= sortedColormap[j].position && t <= sortedColormap[j + 1].position) {
        lowerIndex = j;
        upperIndex = j + 1;
        break;
      }
    }

    const lower = sortedColormap[lowerIndex];
    const upper = sortedColormap[upperIndex];

    // Interpolate between color stops
    const range = upper.position - lower.position;
    const factor = range > 0 ? (t - lower.position) / range : 0;

    data[i * 4 + 0] = Math.round(lower.color[0] + (upper.color[0] - lower.color[0]) * factor);
    data[i * 4 + 1] = Math.round(lower.color[1] + (upper.color[1] - lower.color[1]) * factor);
    data[i * 4 + 2] = Math.round(lower.color[2] + (upper.color[2] - lower.color[2]) * factor);
    data[i * 4 + 3] = Math.round(lower.color[3] + (upper.color[3] - lower.color[3]) * factor);
  }

  const texture = new THREE.DataTexture(data, resolution, 1, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  return texture;
}

/**
 * Create transfer function texture from variable metadata
 */
export function createTransferFunction(variable: VariableMetadata): THREE.DataTexture {
  if (variable.type === 'discrete') {
    return createDiscreteTransferFunction(variable.colormap as DiscreteColor[]);
  } else {
    return createContinuousTransferFunction(variable.colormap as ColorStop[]);
  }
}

/** Fetch one variable, with byte progress and exact size validation. */
export async function loadVariable(
  basePath: string,
  metadata: VolumeMetadata,
  variable: VariableMetadata,
  signal?: AbortSignal,
  onProgress?: (message: string) => void
): Promise<{ texture: THREE.Data3DTexture; transfer: THREE.DataTexture }> {
  const expected =
    metadata.dimensions.x * metadata.dimensions.y * metadata.dimensions.z * (variable.dtype === 'float32' ? 4 : 1);
  const response = await fetch(`${basePath}/${variable.file}`, { signal });
  if (!response.ok) throw new Error(`${variable.name}: download failed (${response.status})`);
  const reader = response.body?.getReader();
  let data: ArrayBuffer;
  if (reader) {
    const bytes = new Uint8Array(expected);
    let offset = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (offset + value.length > expected)
          throw new Error(`${variable.name}: data exceeds expected ${expected} bytes`);
        bytes.set(value, offset);
        offset += value.length;
        onProgress?.(`Loading ${variable.name}: ${Math.round((offset / expected) * 100)}%`);
      }
      if (offset !== expected) throw new Error(`${variable.name}: expected ${expected} bytes, got ${offset}`);
      data = bytes.buffer;
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
  } else {
    data = await response.arrayBuffer();
  }
  if (variable.sha256 && (await sha256(data)) !== variable.sha256)
    throw new Error(`${variable.name}: checksum mismatch. Reload or reconvert the dataset.`);
  signal?.throwIfAborted();
  const texture = createVolumeTexture(
    data,
    metadata.dimensions,
    variable.dtype,
    variable.type === 'discrete' || variable.noDataValue !== undefined
  );
  try {
    return { texture, transfer: createTransferFunction(variable) };
  } catch (error) {
    texture.dispose();
    throw error;
  }
}

export function checkVolumeLimits(
  metadata: VolumeMetadata,
  maxTextureSize: number,
  byteBudget = 256 * 1024 * 1024
): void {
  const { x, y, z } = metadata.dimensions;
  if (Math.max(x, y, z) > maxTextureSize)
    throw new Error(
      `Volume dimensions exceed this device's ${maxTextureSize}-voxel 3D texture limit. Downsample the dataset.`
    );
  for (const variable of metadata.variables) {
    const bytes = x * y * z * (variable.dtype === 'float32' ? 4 : 1);
    if (bytes > byteBudget)
      throw new Error(
        `${variable.name} needs ${Math.ceil(bytes / 1048576)} MiB per copy (CPU and GPU). Downsample below the ${byteBudget / 1048576} MiB per-variable limit.`
      );
  }
}

/**
 * Update transfer function for a variable (e.g., when toggling class visibility)
 */
export function updateDiscreteTransferFunction(texture: THREE.DataTexture, colormap: DiscreteColor[]): void {
  const data = texture.image.data as unknown as Uint8Array;
  data.fill(0);
  for (const color of colormap) {
    const offset = color.value * 4;
    data.set([color.color[0], color.color[1], color.color[2], color.enabled !== false ? color.color[3] : 0], offset);
  }
  texture.needsUpdate = true;
}
