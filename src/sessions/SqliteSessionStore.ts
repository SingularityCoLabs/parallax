import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  newSessionId,
  newTurnId,
  parseRuntimeEvent,
  type RuntimeEvent,
} from '../protocol/index.ts';
import { runMigrations } from './migrations.ts';
import type { SessionStore } from './SessionStore.ts';
import type { DatabaseSyncInstance } from './sqlite.ts';
import { DatabaseSyncCtor } from './sqlite.ts';
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

/** node:sqlite rejects `undefined`; coalesce optional bindings to null. */
function nn<T>(v: T | undefined): T | null {
  return v === undefined ? null : v;
}

let messageCounter = 0;

interface SessionRow {
  id: string;
  created_at: number;
  updated_at: number;
  cwd: string;
  provider: string;
  model: string;
  permission_mode: string;
  status: string;
}

interface MessageRow {
  id: string;
  session_id: string;
  turn_id: string;
  role: string;
  content: string;
  tool_calls_json: string | null;
  tool_call_id: string | null;
  created_at: number;
}

/**
 * Durable SessionStore backed by the built-in `node:sqlite` (blueprint §5.6,
 * §21). WAL mode for concurrent reads; hand-written migrations. Same semantics
 * as InMemorySessionStore so the two are interchangeable at the composition
 * root. The `events` table's (session_id, seq) is the authoritative order.
 */
export class SqliteSessionStore implements SessionStore {
  private readonly db: DatabaseSyncInstance;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSyncCtor(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    runMigrations(this.db);
  }

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
    this.db
      .prepare(
        `INSERT INTO sessions (id, created_at, updated_at, cwd, provider, model, permission_mode, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.createdAt,
        record.updatedAt,
        record.cwd,
        record.provider,
        record.model,
        record.permissionMode,
        record.status,
      );
    return Promise.resolve(record);
  }

  getSession(id: string): Promise<SessionRecord | undefined> {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
      SessionRow | undefined;
    return Promise.resolve(row ? this.mapSession(row) : undefined);
  }

  listSessions(): Promise<SessionRecord[]> {
    const rows = this.db
      .prepare('SELECT * FROM sessions ORDER BY updated_at DESC')
      .all() as unknown as SessionRow[];
    return Promise.resolve(rows.map((r) => this.mapSession(r)));
  }

  setSessionStatus(id: string, status: SessionStatus): Promise<void> {
    this.db
      .prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, Date.now(), id);
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
    this.db
      .prepare(
        `INSERT INTO turns (id, session_id, created_at, completed_at, status, user_text)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(record.id, record.sessionId, record.createdAt, null, record.status, record.userText);
    return Promise.resolve(record);
  }

  setTurnStatus(id: string, status: TurnStatus, completedAt?: number): Promise<void> {
    this.db
      .prepare('UPDATE turns SET status = ?, completed_at = ? WHERE id = ?')
      .run(status, nn(completedAt), id);
    return Promise.resolve();
  }

  appendEvent(event: RuntimeEvent): Promise<void> {
    const turnId = 'turnId' in event ? event.turnId : null;
    this.db
      .prepare(
        `INSERT INTO events (session_id, seq, turn_id, timestamp, type, payload_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(event.sessionId, event.seq, turnId, event.timestamp, event.type, JSON.stringify(event));
    this.db
      .prepare('UPDATE sessions SET updated_at = ? WHERE id = ?')
      .run(event.timestamp, event.sessionId);
    return Promise.resolve();
  }

  listEvents(sessionId: string): Promise<RuntimeEvent[]> {
    const rows = this.db
      .prepare('SELECT payload_json FROM events WHERE session_id = ? ORDER BY seq ASC')
      .all(sessionId) as Array<{ payload_json: string }>;
    return Promise.resolve(rows.map((r) => parseRuntimeEvent(JSON.parse(r.payload_json))));
  }

  maxEventSeq(sessionId: string): Promise<number> {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(seq), -1) AS m FROM events WHERE session_id = ?')
      .get(sessionId) as { m: number };
    return Promise.resolve(row.m);
  }

  appendMessage(input: AppendMessageInput): Promise<MessageRecord> {
    const seqRow = this.db
      .prepare('SELECT COALESCE(MAX(seq), -1) + 1 AS s FROM messages WHERE session_id = ?')
      .get(input.sessionId) as { s: number };
    const record: MessageRecord = {
      id: `m${(messageCounter += 1)}-${seqRow.s}`,
      sessionId: input.sessionId,
      turnId: input.turnId,
      role: input.role,
      content: input.content,
      createdAt: Date.now(),
    };
    if (input.toolCalls) record.toolCalls = input.toolCalls;
    if (input.toolCallId !== undefined) record.toolCallId = input.toolCallId;
    this.db
      .prepare(
        `INSERT INTO messages (id, session_id, turn_id, seq, role, content, tool_calls_json, tool_call_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.sessionId,
        record.turnId,
        seqRow.s,
        record.role,
        record.content,
        input.toolCalls ? JSON.stringify(input.toolCalls) : null,
        nn(input.toolCallId),
        record.createdAt,
      );
    return Promise.resolve(record);
  }

  listMessages(sessionId: string): Promise<MessageRecord[]> {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY seq ASC')
      .all(sessionId) as unknown as MessageRow[];
    return Promise.resolve(rows.map((r) => this.mapMessage(r)));
  }

  recordToolCall(record: ToolCallRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO tool_calls (id, session_id, turn_id, tool_name, input_json, status, result_json, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.sessionId,
        record.turnId,
        record.toolName,
        JSON.stringify(record.input ?? null),
        record.status,
        record.result !== undefined ? JSON.stringify(record.result) : null,
        record.createdAt,
        nn(record.completedAt),
      );
    return Promise.resolve();
  }

  updateToolCall(
    id: string,
    patch: { status: ToolCallStatus; result?: unknown; completedAt?: number },
  ): Promise<void> {
    this.db
      .prepare('UPDATE tool_calls SET status = ?, result_json = ?, completed_at = ? WHERE id = ?')
      .run(
        patch.status,
        patch.result !== undefined ? JSON.stringify(patch.result) : null,
        nn(patch.completedAt),
        id,
      );
    return Promise.resolve();
  }

  recordApproval(record: ApprovalRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO approvals (id, session_id, turn_id, tool_call_id, decision, scope_json, created_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.sessionId,
        record.turnId,
        record.toolCallId,
        record.decision,
        null,
        record.createdAt,
        nn(record.resolvedAt),
      );
    return Promise.resolve();
  }

  close(): void {
    this.db.close();
  }

  private mapSession(row: SessionRow): SessionRecord {
    return {
      id: row.id,
      cwd: row.cwd,
      provider: row.provider,
      model: row.model,
      permissionMode: row.permission_mode as SessionRecord['permissionMode'],
      status: row.status as SessionStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapMessage(row: MessageRow): MessageRecord {
    const record: MessageRecord = {
      id: row.id,
      sessionId: row.session_id,
      turnId: row.turn_id,
      role: row.role as MessageRecord['role'],
      content: row.content,
      createdAt: row.created_at,
    };
    if (row.tool_calls_json) {
      record.toolCalls = JSON.parse(row.tool_calls_json) as NonNullable<MessageRecord['toolCalls']>;
    }
    if (row.tool_call_id !== null) record.toolCallId = row.tool_call_id;
    return record;
  }
}
