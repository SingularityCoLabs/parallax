import type { DatabaseSyncInstance } from './sqlite.ts';

/**
 * Ordered schema migrations (blueprint §21.1). Each runs once, tracked in a
 * `_migrations` table. Tables mirror the blueprint's minimal set; `events` is
 * the authoritative ordered log (via `seq`), other tables are queryable
 * projections for resume/audit.
 */
interface Migration {
  id: number;
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'initial',
    sql: `
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        cwd TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        permission_mode TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE turns (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        status TEXT NOT NULL,
        user_text TEXT NOT NULL
      );
      CREATE INDEX idx_turns_session ON turns(session_id);

      CREATE TABLE events (
        session_id TEXT NOT NULL REFERENCES sessions(id),
        seq INTEGER NOT NULL,
        turn_id TEXT,
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (session_id, seq)
      );

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        turn_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls_json TEXT,
        tool_call_id TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_messages_session ON messages(session_id, seq);

      CREATE TABLE tool_calls (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        turn_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        input_json TEXT NOT NULL,
        status TEXT NOT NULL,
        result_json TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE INDEX idx_tool_calls_session ON tool_calls(session_id);

      CREATE TABLE approvals (
        id TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        turn_id TEXT NOT NULL,
        tool_call_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        scope_json TEXT,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER,
        PRIMARY KEY (id, created_at)
      );
    `,
  },
];

export function runMigrations(db: DatabaseSyncInstance): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
  const applied = new Set(
    (db.prepare('SELECT id FROM _migrations').all() as Array<{ id: number }>).map((r) => r.id),
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)').run(
        migration.id,
        migration.name,
        Date.now(),
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
