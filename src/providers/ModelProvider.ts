import type { ModelEvent } from './ModelEvent.ts';
import type { ModelRequest } from './ModelRequest.ts';

/**
 * Capability flags (blueprint §11.2). The runtime consults these rather than
 * assuming a lowest-common-denominator API, so provider differences stay
 * explicit instead of being flattened away.
 */
export interface ModelCapabilities {
  streaming: boolean;
  nativeToolCalls: boolean;
  parallelToolCalls: boolean;
  vision: boolean;
  reasoningControls: boolean;
  maxContextTokens?: number;
}

/**
 * The only surface the runtime depends on to talk to a model (blueprint §11.2).
 * The runtime never imports a vendor SDK — a real adapter implements this and is
 * wired in the composition root. `stream` must honor `signal` for cancellation.
 */
export interface ModelProvider {
  readonly name: string;
  getCapabilities(model: string): Promise<ModelCapabilities>;
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
}
