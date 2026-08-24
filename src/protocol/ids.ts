import { randomUUID } from 'node:crypto';

/**
 * Opaque-ish string identifiers. Kept as plain aliases (blueprint §8.1) for
 * ergonomics; uniqueness/ordering guarantees come from the store, not the type.
 */
export type SessionId = string;
export type TurnId = string;
export type ToolCallId = string;
export type ApprovalId = string;
export type MessageId = string;

export const newSessionId = (): SessionId => randomUUID();
export const newTurnId = (): TurnId => randomUUID();
export const newToolCallId = (): ToolCallId => randomUUID();
export const newApprovalId = (): ApprovalId => randomUUID();
export const newMessageId = (): MessageId => randomUUID();
