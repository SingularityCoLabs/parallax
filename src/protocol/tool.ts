import { z } from 'zod';

/**
 * A model-proposed tool invocation. `arguments` stays `unknown` until the
 * matching tool validates it against its Zod schema (blueprint §8.2, Principle 1).
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ToolError {
  code: string;
  message: string;
  retryable: boolean;
}

/** Structured outcome of a tool execution (blueprint §8.3). */
export interface ToolResult<T = unknown> {
  callId: string;
  ok: boolean;
  /** Short human-facing label (for the UI / logs). */
  summary: string;
  data?: T;
  /** Exact text the model should see; if omitted the runtime derives it. */
  modelContent?: string;
  error?: ToolError;
  truncated?: boolean;
  durationMs: number;
}

// NOTE: schemas are intentionally left unannotated (no `: z.ZodType<Interface>`).
// Under `exactOptionalPropertyTypes`, Zod's inferred optionals (`x?: T | undefined`)
// don't structurally equal the interfaces' `x?: T`. The interfaces above are the
// hand-authored contract; the round-trip test guards drift between them.
export const toolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.unknown(),
});

export const toolErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});

export const toolResultSchema = z.object({
  callId: z.string(),
  ok: z.boolean(),
  summary: z.string(),
  data: z.unknown().optional(),
  modelContent: z.string().optional(),
  error: toolErrorSchema.optional(),
  truncated: z.boolean().optional(),
  durationMs: z.number(),
});

/**
 * A tool as advertised to the model: name, description, and JSON-Schema
 * parameters. Shared wire vocabulary between the tool registry (producer) and
 * the provider layer (consumer), so it lives in `protocol` to avoid a
 * cross-layer import (blueprint §7.1 boundaries).
 */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: unknown;
}
