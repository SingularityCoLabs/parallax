import type { ApprovalDecision } from '../protocol/index.ts';

interface Pending {
  resolve: (decision: ApprovalDecision) => void;
  autoTimer?: NodeJS.Timeout;
}

/**
 * The ASK barrier (blueprint §9.2, §16, §24). When policy returns `ask`, the
 * turn loop registers the approval id here and awaits it; the UI resolves it via
 * the facade. This class holds no policy — it only bridges "runtime asked" and
 * "human/policy answered".
 *
 * Fail-closed: if a turn is cancelled or the runtime tears down, all pending
 * approvals resolve to `deny` (never silently `allow`). In non-interactive mode
 * the caller can configure `autoDeny` so an unanswered ASK denies rather than
 * hangs forever (§24 "fail closed").
 */
export class ApprovalGateway {
  private readonly pending = new Map<string, Pending>();
  private readonly autoDenyMs: number | undefined;

  constructor(options?: { autoDenyMs?: number }) {
    this.autoDenyMs = options?.autoDenyMs;
  }

  /** Await a decision for the given approval id. */
  wait(approvalId: string): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve) => {
      const entry: Pending = { resolve };
      if (this.autoDenyMs !== undefined) {
        entry.autoTimer = setTimeout(() => {
          this.settle(approvalId, 'deny');
        }, this.autoDenyMs);
        // Do not keep the process alive solely for the auto-deny timer.
        entry.autoTimer.unref?.();
      }
      this.pending.set(approvalId, entry);
    });
  }

  /** Resolve a specific approval (called by the facade when the UI answers). */
  resolve(approvalId: string, decision: ApprovalDecision): boolean {
    return this.settle(approvalId, decision);
  }

  /** Deny everything still pending (cancellation / teardown). Fail closed. */
  denyAll(): void {
    for (const id of [...this.pending.keys()]) {
      this.settle(id, 'deny');
    }
  }

  hasPending(approvalId: string): boolean {
    return this.pending.has(approvalId);
  }

  private settle(approvalId: string, decision: ApprovalDecision): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry) return false;
    if (entry.autoTimer) clearTimeout(entry.autoTimer);
    this.pending.delete(approvalId);
    entry.resolve(decision);
    return true;
  }
}
