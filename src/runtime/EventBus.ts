import { PROTOCOL_VERSION, type EmittedEvent, type RuntimeEvent } from '../protocol/index.ts';
import type { SessionStore } from '../sessions/index.ts';

export type EventListener = (event: RuntimeEvent) => void;

/**
 * Central event emitter (blueprint §10). Producers hand it an `EmittedEvent`
 * (without `v`/`seq`/`timestamp`); the bus stamps the protocol version, assigns
 * a monotonic per-session `seq` (for ordering, blueprint §21), persists it, then
 * fans out to subscribers. Persistence happens before fan-out so a crashed
 * subscriber cannot lose durable history.
 */
export class EventBus {
  private readonly store: SessionStore;
  private readonly listeners = new Set<EventListener>();
  private readonly seqBySession = new Map<string, number>();

  constructor(store: SessionStore) {
    this.store = store;
  }

  /** Seed the seq counter when resuming an existing session. */
  seedSeq(sessionId: string, lastSeq: number): void {
    this.seqBySession.set(sessionId, lastSeq);
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async emit(event: EmittedEvent): Promise<RuntimeEvent> {
    const seq = (this.seqBySession.get(event.sessionId) ?? -1) + 1;
    this.seqBySession.set(event.sessionId, seq);
    const full = {
      ...event,
      v: PROTOCOL_VERSION,
      seq,
      timestamp: Date.now(),
    } as RuntimeEvent;
    await this.store.appendEvent(full);
    for (const listener of this.listeners) {
      listener(full);
    }
    return full;
  }
}
