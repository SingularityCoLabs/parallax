import { newSessionId, newTurnId, type RuntimeEvent } from '../protocol/index.ts';
import type { SessionStore } from './SessionStore.ts';
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

let messageSeq = 0;

/**
 * Non-durable SessionStore for tests and the fake-driven loop. Keeps the same
 * semantics as the SQLite store so swapping them is a wiring change only
 * (blueprint §21, Principle 2 seams).
 */
export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly turns = new Map<string, TurnRecord>();
  private readonly events = new Map<string, RuntimeEvent[]>();
  private readonly messages = new Map<string, MessageRecord[]>();
  private readonly toolCalls = new Map<string, ToolCallRecord>();
  private readonly approvals: ApprovalRecord[] = [];

  createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const now = Date.now();
    const record: SessionRecord = {
      id: newSessionId(),
      cwd: input.cwd,
      provider: input.provider,
      model: input.model,
      permissionMode: input.permissionMode,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(record.id, record);
    this.events.set(record.id, []);
    this.messages.set(record.id, []);
    return Promise.resolve(record);
  }

  getSession(id: string): Promise<SessionRecord | undefined> {
    return Promise.resolve(this.sessions.get(id));
  }

  listSessions(): Promise<SessionRecord[]> {
    return Promise.resolve([...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt));
  }

  setSessionStatus(id: string, status: SessionStatus): Promise<void> {
    const s = this.sessions.get(id);
    if (s) {
      s.status = status;
      s.updatedAt = Date.now();
    }
    return Promise.resolve();
  }

  createTurn(sessionId: string, userText: string): Promise<TurnRecord> {
    const record: TurnRecord = {
      id: newTurnId(),
      sessionId,
      userText,
      status: 'running',
      createdAt: Date.now(),
    };
    this.turns.set(record.id, record);
    return Promise.resolve(record);
  }

  setTurnStatus(id: string, status: TurnStatus, completedAt?: number): Promise<void> {
    const t = this.turns.get(id);
    if (t) {
      t.status = status;
      if (completedAt !== undefined) t.completedAt = completedAt;
    }
    return Promise.resolve();
  }

  appendEvent(event: RuntimeEvent): Promise<void> {
    const list = this.events.get(event.sessionId) ?? [];
    list.push(event);
    this.events.set(event.sessionId, list);
    const s = this.sessions.get(event.sessionId);
    if (s) s.updatedAt = event.timestamp;
    return Promise.resolve();
  }

  listEvents(sessionId: string): Promise<RuntimeEvent[]> {
    return Promise.resolve([...(this.events.get(sessionId) ?? [])].sort((a, b) => a.seq - b.seq));
  }

  maxEventSeq(sessionId: string): Promise<number> {
    const list = this.events.get(sessionId) ?? [];
    return Promise.resolve(list.reduce((m, e) => Math.max(m, e.seq), -1));
  }

  appendMessage(input: AppendMessageInput): Promise<MessageRecord> {
    const record: MessageRecord = {
      id: `m${(messageSeq += 1)}`,
      sessionId: input.sessionId,
      turnId: input.turnId,
      role: input.role,
      content: input.content,
      createdAt: Date.now(),
    };
    if (input.toolCalls) record.toolCalls = input.toolCalls;
    if (input.toolCallId !== undefined) record.toolCallId = input.toolCallId;
    const list = this.messages.get(input.sessionId) ?? [];
    list.push(record);
    this.messages.set(input.sessionId, list);
    return Promise.resolve(record);
  }

  listMessages(sessionId: string): Promise<MessageRecord[]> {
    return Promise.resolve([...(this.messages.get(sessionId) ?? [])]);
  }

  recordToolCall(record: ToolCallRecord): Promise<void> {
    this.toolCalls.set(record.id, { ...record });
    return Promise.resolve();
  }

  updateToolCall(
    id: string,
    patch: { status: ToolCallStatus; result?: unknown; completedAt?: number },
  ): Promise<void> {
    const rec = this.toolCalls.get(id);
    if (rec) {
      rec.status = patch.status;
      if (patch.result !== undefined) rec.result = patch.result;
      if (patch.completedAt !== undefined) rec.completedAt = patch.completedAt;
    }
    return Promise.resolve();
  }

  recordApproval(record: ApprovalRecord): Promise<void> {
    this.approvals.push({ ...record });
    return Promise.resolve();
  }

  close(): void {
    // no-op
  }
}
