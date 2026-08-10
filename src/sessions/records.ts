import type { PermissionMode, ToolCall } from '../protocol/index.ts';

export type SessionStatus = 'active' | 'completed' | 'error';
export type TurnStatus = 'running' | 'completed' | 'cancelled' | 'failed';
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';
export type ToolCallStatus = 'proposed' | 'denied' | 'running' | 'completed' | 'failed';

export interface SessionRecord {
  id: string;
  cwd: string;
  provider: string;
  model: string;
  permissionMode: PermissionMode;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
}

export interface TurnRecord {
  id: string;
  sessionId: string;
  userText: string;
  status: TurnStatus;
  createdAt: number;
  completedAt?: number;
}

/**
 * Durable conversation history (blueprint §20.3 — full raw history, distinct
 * from the bounded model-visible context). Maps closely to a provider
 * `ModelMessage`; the runtime handles the projection.
 */
export interface MessageRecord {
  id: string;
  sessionId: string;
  turnId: string;
  role: MessageRole;
  content: string;
  /** For assistant messages that proposed tool calls. */
  toolCalls?: ToolCall[];
  /** For tool-result messages, the call they answer. */
  toolCallId?: string;
  createdAt: number;
}

export interface ToolCallRecord {
  id: string;
  sessionId: string;
  turnId: string;
  toolName: string;
  input: unknown;
  status: ToolCallStatus;
  result?: unknown;
  createdAt: number;
  completedAt?: number;
}

export interface ApprovalRecord {
  id: string;
  sessionId: string;
  turnId: string;
  toolCallId: string;
  decision: 'allow_once' | 'deny';
  createdAt: number;
  resolvedAt?: number;
}

export interface CreateSessionInput {
  cwd: string;
  provider: string;
  model: string;
  permissionMode: PermissionMode;
}

export interface AppendMessageInput {
  sessionId: string;
  turnId: string;
  role: MessageRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}
