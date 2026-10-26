import type { Histogram, VariableMetadata } from './types';

/** Transfer bounded copies; never detach the renderer's inspection/texture buffer. */
export function computeHistogram(
  data: Uint8Array | Float32Array,
  variable: VariableMetadata,
  signal: AbortSignal
): Promise<Histogram> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL('./histogram.worker.ts', import.meta.url), { type: 'module' });
    const range = variable.range ?? { min: 0, max: 1 };
    const result: Histogram = { bins: Array(32).fill(0), ...range, valid: 0, missing: 0 };
    const chunkLength = (1024 * 1024) / data.BYTES_PER_ELEMENT;
    let offset = 0;
    const cleanup = () => {
      worker.terminate();
      signal.removeEventListener('abort', abort);
    };
    const fail = (error: unknown) => {
      cleanup();
      reject(error);
    };
    const abort = () => fail(signal.reason);
    const next = () => {
      try {
        const chunk = data.slice(offset, offset + chunkLength);
        offset += chunk.length;
        worker.postMessage({ data: chunk, variable }, [chunk.buffer]);
      } catch (error) {
        fail(error);
      }
    };
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = (event) => {
      event.preventDefault();
      fail(new Error(`Histogram calculation failed: ${event.message}`));
    };
    worker.onmessageerror = () => fail(new Error('Histogram result could not be read.'));
    worker.onmessage = ({ data: chunk }: MessageEvent<Histogram>) => {
      chunk.bins.forEach((count, index) => (result.bins[index] += count));
      result.valid += chunk.valid;
      result.missing += chunk.missing;
      if (offset < data.length) next();
      else {
        cleanup();
        resolve(result);
      }
    };
    next();
  });
}
