import { newToolCallId } from '../../protocol/index.ts';
import type { ModelEvent } from '../ModelEvent.ts';
import type { ModelRequest } from '../ModelRequest.ts';
import type { ModelCapabilities, ModelProvider } from '../ModelProvider.ts';

/** One `stream()` call worth of events. */
export type FakeStep = ModelEvent[];

/** Convenience builders for scripting a fake model (blueprint §11.5). */
export function modelText(text: string): ModelEvent {
  return { type: 'text.delta', text };
}

export function modelToolCall(name: string, args: unknown, id?: string): ModelEvent {
  return {
    type: 'tool_call.completed',
    call: { id: id ?? newToolCallId(), name, arguments: args },
  };
}

export function modelUsage(inputTokens?: number, outputTokens?: number): ModelEvent {
  const ev: ModelEvent = { type: 'usage' };
  if (inputTokens !== undefined) ev.inputTokens = inputTokens;
  if (outputTokens !== undefined) ev.outputTokens = outputTokens;
  return ev;
}

export function modelFinal(reason = 'stop'): ModelEvent {
  return { type: 'completed', reason };
}

const FAKE_CAPABILITIES: ModelCapabilities = {
  streaming: true,
  nativeToolCalls: true,
  parallelToolCalls: false,
  vision: false,
  reasoningControls: false,
  maxContextTokens: 200_000,
};

/**
 * Deterministic, offline model (blueprint §11.5, §32.2). Each `stream()` call
 * consumes the next scripted step. A `completed` event is auto-appended if a
 * step omits one. Cancellation is honored between yields. Every request is
 * recorded so tests can assert on the context the runtime built.
 */
export class FakeModelProvider implements ModelProvider {
  readonly name = 'fake';
  readonly requests: ModelRequest[] = [];
  private cursor = 0;
  private readonly steps: FakeStep[];

  constructor(steps: FakeStep[] = []) {
    this.steps = steps;
  }

  getCapabilities(_model: string): Promise<ModelCapabilities> {
    return Promise.resolve(FAKE_CAPABILITIES);
  }

  get calls(): number {
    return this.cursor;
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    const step = this.steps[this.cursor];
    this.cursor += 1;
    this.requests.push(request);

    // Script exhausted -> end the turn gracefully (no tool calls) rather than
    // crash; the runtime's max-steps guard still bounds runaways.
    if (!step) {
      yield { type: 'completed', reason: 'stop' };
      return;
    }

    let sawCompleted = false;
    let sawToolCall = false;
    for (const ev of step) {
      if (signal.aborted) return;
      if (ev.type === 'completed') sawCompleted = true;
      if (ev.type === 'tool_call.completed') sawToolCall = true;
      yield ev;
      // Yield to the event loop so streaming/cancellation behave realistically.
      await Promise.resolve();
    }
    if (!sawCompleted && !signal.aborted) {
      yield { type: 'completed', reason: sawToolCall ? 'tool_use' : 'stop' };
    }
  }
}
