import type { ToolCall, ToolSchema } from '../protocol/index.ts';

/** A tool advertised to the model (name + JSON-schema parameters). */
export type ModelToolSchema = ToolSchema;

/**
 * Conversation messages as the model sees them. This is the *model-visible*
 * projection built by the ContextBuilder — not the durable session history
 * (blueprint §7.1 context vs. §20.3 source history).
 */
export type ModelMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface ModelRequest {
  model: string;
  system: string;
  messages: ModelMessage[];
  tools: ModelToolSchema[];
}
