import type { ToolCall } from '../protocol/index.ts';

/**
 * Normalized model stream events (blueprint §11.3). Both the fake provider and
 * any future real adapter emit exactly these, so the runtime never branches on
 * vendor specifics. Tool-call assembly (streaming deltas) is the provider's job;
 * the runtime only sees a completed `ToolCall`.
 */
export type ModelEvent =
  | { type: 'text.delta'; text: string }
  | { type: 'tool_call.completed'; call: ToolCall }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number }
  | { type: 'completed'; reason: string };
