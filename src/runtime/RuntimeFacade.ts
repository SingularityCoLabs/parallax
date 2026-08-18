import type { Logger } from '../observability/index.ts';
import { childLogger } from '../observability/index.ts';
import {
  type ApprovalDecision,
  type PermissionMode,
  type RuntimeEvent,
} from '../protocol/index.ts';
import type { ModelProvider } from '../providers/index.ts';
import type { ContextBuilder } from '../context/index.ts';
import type { PolicyEngine } from '../policy/index.ts';
import type { SessionStore, SessionRecord } from '../sessions/index.ts';
import type { ToolRegistry } from '../tools/core/index.ts';
import { EventBus, type EventListener } from './EventBus.ts';
import { ApprovalGateway } from './ApprovalGateway.ts';
import { Scheduler } from './Scheduler.ts';
import { TurnController } from './TurnController.ts';
import { TurnCancelledError } from './errors.ts';

export interface RuntimeConfig {
  provider: ModelProvider;
  registry: ToolRegistry;
  policy: PolicyEngine;
  contextBuilder: ContextBuilder;
  store: SessionStore;
  defaultModel: string;
  maxSteps: number;
  logger: Logger;
  /** If set, unanswered ASK approvals auto-deny after this many ms (headless). */
  approvalAutoDenyMs?: number;
}

export interface CreateSessionOptions {
  cwd: string;
  permissionMode: PermissionMode;
  model?: string;
}

interface ActiveTurn {
  turnId: string;
  controller: AbortController;
}

/**
 * The single entry point the UI talks to (blueprint §6, Principle 2). It accepts
 * commands (create session, start turn, cancel, resolve approval) and exposes an
 * event subscription. It owns no rendering, no provider SDK, no SQL, no tool
 * execution — those live behind injected interfaces.
 */
export class RuntimeFacade {
  private readonly cfg: RuntimeConfig;
  private readonly bus: EventBus;
  private readonly approvals: ApprovalGateway;
  private readonly scheduler = new Scheduler();
  private readonly activeTurns = new Map<string, ActiveTurn>();
  /** Tools the user chose to "always allow", per session (blueprint §16). */
  private readonly grantedTools = new Map<string, Set<string>>();

  constructor(config: RuntimeConfig) {
    this.cfg = config;
    this.bus = new EventBus(config.store);
    this.approvals = new ApprovalGateway(
      config.approvalAutoDenyMs !== undefined
        ? { autoDenyMs: config.approvalAutoDenyMs }
        : undefined,
    );
  }

  subscribe(listener: EventListener): () => void {
    return this.bus.subscribe(listener);
  }

  /**
   * Swap the model provider for subsequent turns (blueprint §11.4). Turns build
   * their request from the provider at call time, so an in-flight turn keeps the
   * provider it started with and the next turn uses the new one. The session's
   * persisted provider/model is updated separately by the caller.
   */
  setModelProvider(provider: ModelProvider): void {
    this.cfg.provider = provider;
  }

  /**
   * Change a session's permission mode for subsequent turns (blueprint §16.3).
   * Persisted on the session record; `TurnController` reads it fresh each turn,
   * so an in-flight turn keeps its mode and the next turn uses the new one. This
   * is what the TUI's Shift+Tab (workspace → plan → read-only) drives.
   */
  async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    await this.cfg.store.updateSession(sessionId, { permissionMode: mode });
  }

  /** The per-session "always allow" grant set, created on first use. */
  private grantsFor(sessionId: string): Set<string> {
    let set = this.grantedTools.get(sessionId);
    if (!set) {
      set = new Set<string>();
      this.grantedTools.set(sessionId, set);
    }
    return set;
  }

  async createSession(options: CreateSessionOptions): Promise<SessionRecord> {
    const model = options.model ?? this.cfg.defaultModel;
    const session = await this.cfg.store.createSession({
      cwd: options.cwd,
      provider: this.cfg.provider.name,
      model,
      permissionMode: options.permissionMode,
    });
    await this.bus.emit({
      type: 'session.started',
      sessionId: session.id,
      cwd: session.cwd,
      provider: session.provider,
      model: session.model,
      permissionMode: session.permissionMode,
    });
    return session;
  }

  /** Resume an existing session: seed the event seq so ordering continues. */
  async resumeSession(sessionId: string): Promise<SessionRecord | undefined> {
    const session = await this.cfg.store.getSession(sessionId);
    if (!session) return undefined;
    const lastSeq = await this.cfg.store.maxEventSeq(sessionId);
    this.bus.seedSeq(sessionId, lastSeq);
    return session;
  }

  /** Replay persisted events for a session (for a resuming UI). */
  listEvents(sessionId: string): Promise<RuntimeEvent[]> {
    return this.cfg.store.listEvents(sessionId);
  }

  listSessions(): Promise<SessionRecord[]> {
    return this.cfg.store.listSessions();
  }

  resolveApproval(approvalId: string, decision: ApprovalDecision): boolean {
    return this.approvals.resolve(approvalId, decision);
  }

  cancelTurn(sessionId: string, turnId: string): void {
    const active = this.activeTurns.get(sessionId);
    if (active && active.turnId === turnId) {
      active.controller.abort();
    }
  }

  /**
   * Cancel whatever turn is currently active for a session, if any. A UI that
   * doesn't track turn ids (the TUI) uses this for its Esc/Ctrl-C interrupt.
   */
  cancelActiveTurn(sessionId: string): void {
    this.activeTurns.get(sessionId)?.controller.abort();
  }

  /**
   * Run one turn to completion. Persists the user message, drives the loop, and
   * always resolves — cancellation and failures are reported as terminal events,
   * not thrown to the caller.
   */
  async startTurn(sessionId: string, userText: string): Promise<void> {
    const session = await this.cfg.store.getSession(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);

    const controller = new AbortController();
    const turn = await this.cfg.store.createTurn(sessionId, userText);
    this.activeTurns.set(sessionId, { turnId: turn.id, controller });

    const log = childLogger({ sessionId, turnId: turn.id });

    await this.bus.emit({
      type: 'turn.started',
      sessionId,
      turnId: turn.id,
      userText,
    });
    await this.cfg.store.appendMessage({
      sessionId,
      turnId: turn.id,
      role: 'user',
      content: userText,
    });

    const turnController = new TurnController({
      store: this.cfg.store,
      bus: this.bus,
      provider: this.cfg.provider,
      registry: this.cfg.registry,
      policy: this.cfg.policy,
      contextBuilder: this.cfg.contextBuilder,
      scheduler: this.scheduler,
      approvals: this.approvals,
      logger: log,
      maxSteps: this.cfg.maxSteps,
      grantedTools: this.grantsFor(sessionId),
    });

    try {
      await turnController.run({
        sessionId,
        turnId: turn.id,
        workspaceRoot: session.cwd,
        mode: session.permissionMode,
        model: session.model,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof TurnCancelledError || controller.signal.aborted) {
        this.approvals.denyAll();
        await this.bus.emit({ type: 'turn.cancelled', sessionId, turnId: turn.id });
        await this.cfg.store.setTurnStatus(turn.id, 'cancelled', Date.now());
      } else {
        const code =
          err && typeof err === 'object' && 'code' in err
            ? String((err as { code: unknown }).code)
            : 'internal_error';
        const message = err instanceof Error ? err.message : String(err);
        log.error({ err }, 'turn failed');
        await this.bus.emit({
          type: 'turn.failed',
          sessionId,
          turnId: turn.id,
          errorCode: code,
          message,
        });
        await this.cfg.store.setTurnStatus(turn.id, 'failed', Date.now());
      }
    } finally {
      this.activeTurns.delete(sessionId);
    }
  }

  close(): void {
    this.approvals.denyAll();
    this.cfg.store.close();
  }
}
