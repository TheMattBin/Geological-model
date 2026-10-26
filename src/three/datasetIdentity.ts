import type { VolumeMetadata } from './types';

export async function sha256(data: ArrayBuffer): Promise<string> {
  if (!crypto.subtle) throw new Error('Dataset verification requires HTTPS or localhost.');
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)])
    );
  return value;
}

/** Legacy metadata remains loadable, but cannot produce a verifiable saved view. */
export async function fingerprintMetadata(metadata: VolumeMetadata): Promise<string | undefined> {
  if (!metadata.variables.every((variable) => variable.sha256)) return undefined;
  const { datasetFingerprint: ignored, ...source } = metadata;
  return sha256(new TextEncoder().encode(JSON.stringify(canonical(source))).buffer);
}
