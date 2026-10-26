import { buildHistogram } from './volumeValues';
import type { VariableMetadata } from './types';

self.onmessage = (event: MessageEvent<{ data: Uint8Array | Float32Array; variable: VariableMetadata }>) => {
  self.postMessage(buildHistogram(event.data.data, event.data.variable));
};
