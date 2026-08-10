import { newApprovalId, type ToolRisk } from '../protocol/index.ts';
import { classifyCommand } from './commandRisk.ts';
import type { PermissionContext, PermissionDecision } from './PermissionDecision.ts';

const READ_RISKS: ReadonlySet<ToolRisk> = new Set<ToolRisk>(['read']);

/**
 * Deterministic ALLOW / ASK / DENY engine (blueprint §16). The model proposes,
 * this decides (Principle 1). Rules, in order:
 *   1. Any path escaping the workspace → DENY (blueprint §17).
 *   2. read-only mode → allow reads, DENY every mutating/side-effecting tool.
 *   3. workspace mode → allow reads, ASK for writes/shell/destructive/network.
 * The engine never executes; it only classifies.
 */
export class PolicyEngine {
  evaluate(ctx: PermissionContext): PermissionDecision {
    if (ctx.outsideWorkspace) {
      return {
        kind: 'deny',
        reason: `${ctx.toolName}: path escapes the workspace root (${ctx.workspaceRoot})`,
      };
    }

    const isRead = READ_RISKS.has(ctx.risk);

    if (ctx.mode === 'read-only') {
      if (isRead) return { kind: 'allow', reason: 'read-only mode: reads permitted' };
      return {
        kind: 'deny',
        reason: `read-only mode: ${ctx.toolName} (${ctx.risk}) is blocked`,
      };
    }

    // workspace mode (default)
    if (isRead) {
      return { kind: 'allow', reason: 'workspace-scoped read' };
    }

    const command = ctx.command;
    const risk = command ? classifyCommand(command) : { destructive: false, reasons: [] };
    const detailParts = [ctx.actionDetail].filter((s): s is string => Boolean(s));
    if (risk.destructive) detailParts.push(`⚠ ${risk.reasons.join(', ')}`);

    return {
      kind: 'ask',
      reason: `workspace mode: ${ctx.risk} action requires approval`,
      approval: {
        id: newApprovalId(),
        toolCallId: ctx.toolCallId,
        toolName: ctx.toolName,
        title: ctx.actionTitle,
        ...(detailParts.length > 0 ? { detail: detailParts.join(' — ') } : {}),
        ...(ctx.diffPreview !== undefined ? { diffPreview: ctx.diffPreview } : {}),
        risk: ctx.risk,
      },
    };
  }
}
