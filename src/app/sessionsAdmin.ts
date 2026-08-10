import { SqliteSessionStore, type SessionRecord } from '../sessions/index.ts';
import type { RuntimeEvent } from '../protocol/index.ts';

/** List persisted sessions, most recent first (blueprint §21.2 `sessions`). */
export async function listPersistedSessions(dbPath: string): Promise<SessionRecord[]> {
  const store = new SqliteSessionStore(dbPath);
  try {
    return await store.listSessions();
  } finally {
    store.close();
  }
}

/**
 * Replay a persisted session's event log for a resuming UI (blueprint §21.2
 * `--resume`). This re-renders history; it does NOT re-execute tools (§21.2 "never
 * automatically retry an interrupted mutating tool").
 */
export async function replaySession(
  dbPath: string,
  sessionId: string,
  onEvent: (event: RuntimeEvent) => void,
): Promise<boolean> {
  const store = new SqliteSessionStore(dbPath);
  try {
    const session = await store.getSession(sessionId);
    if (!session) return false;
    for (const event of await store.listEvents(sessionId)) onEvent(event);
    return true;
  } finally {
    store.close();
  }
}
