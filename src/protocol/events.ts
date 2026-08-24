import { z } from 'zod';
import { toolCallSchema, toolResultSchema } from './tool.ts';
import { approvalRequestSchema, approvalDecisionSchema } from './approval.ts';

/**
 * The runtime's event protocol (blueprint §10). The runtime emits these instead
 * of calling UI code directly, so CLI, TUI, headless, tests, and future clients
 * all consume the same contract (§10.3). Every event carries a protocol version
 * `v`, a `seq` (assigned by the store for ordering), and correlating ids.
 *
 * Each variant is a Zod schema; the `RuntimeEvent` type is derived from the
 * discriminated union so the schema is the single source of truth (§32.4).
 */

export const PROTOCOL_VERSION = 1 as const;

const base = {
  v: z.literal(PROTOCOL_VERSION),
  seq: z.number().int().nonnegative(),
  sessionId: z.string(),
  timestamp: z.number().int(),
};

export const sessionStartedEvent = z.object({
  ...base,
  type: z.literal('session.started'),
  cwd: z.string(),
  provider: z.string(),
  model: z.string(),
  permissionMode: z.string(),
});

export const turnStartedEvent = z.object({
  ...base,
  type: z.literal('turn.started'),
  turnId: z.string(),
  userText: z.string(),
});

export const modelStartedEvent = z.object({
  ...base,
  type: z.literal('model.started'),
  turnId: z.string(),
  step: z.number().int().nonnegative(),
});

export const assistantDeltaEvent = z.object({
  ...base,
  type: z.literal('assistant.delta'),
  turnId: z.string(),
  text: z.string(),
});

export const modelCompletedEvent = z.object({
  ...base,
  type: z.literal('model.completed'),
  turnId: z.string(),
  reason: z.string(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
});

export const toolProposedEvent = z.object({
  ...base,
  type: z.literal('tool.proposed'),
  turnId: z.string(),
  call: toolCallSchema,
});

export const approvalRequestedEvent = z.object({
  ...base,
  type: z.literal('approval.requested'),
  turnId: z.string(),
  request: approvalRequestSchema,
});

export const approvalResolvedEvent = z.object({
  ...base,
  type: z.literal('approval.resolved'),
  turnId: z.string(),
  approvalId: z.string(),
  decision: approvalDecisionSchema,
});

export const toolStartedEvent = z.object({
  ...base,
  type: z.literal('tool.started'),
  turnId: z.string(),
  callId: z.string(),
  toolName: z.string(),
});

export const toolStdoutEvent = z.object({
  ...base,
  type: z.literal('tool.stdout'),
  turnId: z.string(),
  callId: z.string(),
  text: z.string(),
});

export const toolStderrEvent = z.object({
  ...base,
  type: z.literal('tool.stderr'),
  turnId: z.string(),
  callId: z.string(),
  text: z.string(),
});

export const toolCompletedEvent = z.object({
  ...base,
  type: z.literal('tool.completed'),
  turnId: z.string(),
  result: toolResultSchema,
});

export const toolFailedEvent = z.object({
  ...base,
  type: z.literal('tool.failed'),
  turnId: z.string(),
  result: toolResultSchema,
});

export const turnCompletedEvent = z.object({
  ...base,
  type: z.literal('turn.completed'),
  turnId: z.string(),
});

export const turnCancelledEvent = z.object({
  ...base,
  type: z.literal('turn.cancelled'),
  turnId: z.string(),
});

export const turnFailedEvent = z.object({
  ...base,
  type: z.literal('turn.failed'),
  turnId: z.string(),
  errorCode: z.string(),
  message: z.string(),
});

/**
 * The session's permission mode changed mid-run (blueprint §16.3). Currently
 * emitted when the `present_plan` gate is approved and the runtime flips the
 * session from `plan` to `workspace`. UIs update their mode indicator; the
 * timeline reducer folds it into `session.permissionMode`.
 */
export const modeChangedEvent = z.object({
  ...base,
  type: z.literal('mode.changed'),
  turnId: z.string(),
  mode: z.string(),
});

export const runtimeEventSchema = z.discriminatedUnion('type', [
  sessionStartedEvent,
  turnStartedEvent,
  modelStartedEvent,
  assistantDeltaEvent,
  modelCompletedEvent,
  toolProposedEvent,
  approvalRequestedEvent,
  approvalResolvedEvent,
  toolStartedEvent,
  toolStdoutEvent,
  toolStderrEvent,
  toolCompletedEvent,
  toolFailedEvent,
  turnCompletedEvent,
  turnCancelledEvent,
  turnFailedEvent,
  modeChangedEvent,
]);

export type RuntimeEvent = z.infer<typeof runtimeEventSchema>;
export type RuntimeEventType = RuntimeEvent['type'];

/** Narrow a RuntimeEvent by its `type` tag. */
export type RuntimeEventOf<T extends RuntimeEventType> = Extract<RuntimeEvent, { type: T }>;

/** Distributive Omit — plain `Omit<Union, K>` collapses a union to its common
 * keys, which would erase per-event fields. This maps over each member. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * Fields the runtime supplies per event; `v`, `seq`, and `timestamp` are stamped
 * centrally by the emitter (blueprint §21 event ordering), so producers don't
 * repeat them.
 */
export type EmittedEvent = DistributiveOmit<RuntimeEvent, 'v' | 'seq' | 'timestamp'>;

/** An emitted event without its session id, for producers that add it centrally. */
export type EmittedEventBody = DistributiveOmit<EmittedEvent, 'sessionId'>;

export function parseRuntimeEvent(value: unknown): RuntimeEvent {
  return runtimeEventSchema.parse(value);
}
