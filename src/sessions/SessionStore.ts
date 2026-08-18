import type { RuntimeEvent } from '../protocol/index.ts';
import type {
  AppendMessageInput,
  ApprovalRecord,
  CreateSessionInput,
  MessageRecord,
  SessionRecord,
  SessionStatus,
  ToolCallRecord,
  ToolCallStatus,
  TurnRecord,
  TurnStatus,
} from './records.ts';
import type { PermissionMode } from '../protocol/index.ts';

/**
 * Durable state boundary (blueprint §21). The runtime depends only on this
 * interface; the in-memory and SQLite implementations are interchangeable and
 * wired by the composition root. All methods are async so the SQLite backend
 * can batch/await without changing callers.
 */
export interface SessionStore {
  createSession(input: CreateSessionInput): Promise<SessionRecord>;
  getSession(id: string): Promise<SessionRecord | undefined>;
  listSessions(): Promise<SessionRecord[]>;
  setSessionStatus(id: string, status: SessionStatus): Promise<void>;
  /**
   * Update the provider, model, and/or permission mode of an existing session
   * in place. Used when the user switches model/provider mid-chat (blueprint
   * §11.4) or toggles permission mode (Shift+Tab). Only the supplied fields
   * change.
   */
  updateSession(
    id: string,
    patch: { provider?: string; model?: string; permissionMode?: PermissionMode },
  ): Promise<void>;

  createTurn(sessionId: string, userText: string): Promise<TurnRecord>;
  setTurnStatus(id: string, status: TurnStatus, completedAt?: number): Promise<void>;

  /** Persist an already-stamped event (seq assigned by the runtime's EventBus). */
  appendEvent(event: RuntimeEvent): Promise<void>;
  listEvents(sessionId: string): Promise<RuntimeEvent[]>;
  /** Highest seq persisted for a session, or -1 if none (used to resume seq). */
  maxEventSeq(sessionId: string): Promise<number>;

  appendMessage(input: AppendMessageInput): Promise<MessageRecord>;
  listMessages(sessionId: string): Promise<MessageRecord[]>;

  recordToolCall(record: ToolCallRecord): Promise<void>;
  updateToolCall(
    id: string,
    patch: { status: ToolCallStatus; result?: unknown; completedAt?: number },
  ): Promise<void>;

  recordApproval(record: ApprovalRecord): Promise<void>;

  close(): void;
}
