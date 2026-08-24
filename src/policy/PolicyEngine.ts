import { newApprovalId, PLAN_TOOL_NAME, type ToolRisk } from '../protocol/index.ts';
import { classifyCommand } from './commandRisk.ts';
import type { PermissionContext, PermissionDecision } from './PermissionDecision.ts';

const READ_RISKS: ReadonlySet<ToolRisk> = new Set<ToolRisk>(['read']);

/**
 * Deterministic ALLOW / ASK / DENY engine (blueprint §16). The model proposes,
 * this decides (Principle 1). Rules, in order:
 *   1. Any path escaping the workspace → DENY (blueprint §17). Always first.
 *   2. `bypass` mode → ALLOW everything (the escape guardrail above still holds).
 *   3. The `present_plan` gate: ASK in plan mode, ALLOW elsewhere.
 *   4. read-only / plan mode → allow reads, DENY every mutating/side-effecting tool.
 *   5. workspace mode → allow reads, ASK for writes/shell/destructive/network.
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

    // `bypass` auto-approves every in-workspace action with no prompt. The
    // workspace-escape DENY above is the one guardrail that still applies, so a
    // tool can never reach outside the workspace root even here.
    if (ctx.mode === 'bypass') {
      return { kind: 'allow', reason: 'bypass mode: auto-approved (no prompts)' };
    }

    // The plan-mode "exit gate". `present_plan` has no side effects of its own
    // (risk `read`), but in plan mode it is the deliberate hand-off point: we ASK
    // so approving it can flip the session to workspace mode (TurnController). In
    // any other mode there is nothing to switch, so it is a plain ALLOW.
    if (ctx.toolName === PLAN_TOOL_NAME) {
      if (ctx.mode !== 'plan') {
        return { kind: 'allow', reason: `${ctx.toolName}: plan presented (no mode change)` };
      }
      return {
        kind: 'ask',
        reason: 'plan mode: approve to exit plan mode and start executing',
        approval: {
          id: newApprovalId(),
          toolCallId: ctx.toolCallId,
          toolName: ctx.toolName,
          title: ctx.actionTitle,
          ...(ctx.actionDetail !== undefined ? { detail: ctx.actionDetail } : {}),
          risk: ctx.risk,
        },
      };
    }

    const isRead = READ_RISKS.has(ctx.risk);

    // `plan` gates identically to `read-only` (no side effects); it differs only
    // in intent — the agent researches and proposes rather than acting.
    if (ctx.mode === 'read-only' || ctx.mode === 'plan') {
      if (isRead) return { kind: 'allow', reason: `${ctx.mode} mode: reads permitted` };
      return {
        kind: 'deny',
        reason: `${ctx.mode} mode: ${ctx.toolName} (${ctx.risk}) is blocked`,
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
