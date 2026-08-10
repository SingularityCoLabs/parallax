import type { ApprovalRequest, PermissionMode, ToolRisk } from '../protocol/index.ts';

/**
 * Deterministic authorization decision (blueprint §16.1, Principle 1). The model
 * never produces this — only the policy engine does, from tool metadata and the
 * normalized action.
 */
export type PermissionDecision =
  | { kind: 'allow'; reason: string }
  | { kind: 'ask'; reason: string; approval: ApprovalRequest }
  | { kind: 'deny'; reason: string };

/**
 * Inputs to a policy evaluation (blueprint §16.4). `outsideWorkspace` and
 * `command` come from the tool's ToolActionDescriptor, computed before any side
 * effect.
 */
export interface PermissionContext {
  sessionId: string;
  turnId: string;
  workspaceRoot: string;
  mode: PermissionMode;
  toolName: string;
  toolCallId: string;
  risk: ToolRisk;
  outsideWorkspace: boolean;
  /** Human-facing action summary (from ToolActionDescriptor.title). */
  actionTitle: string;
  actionDetail?: string;
  diffPreview?: string;
  command?: string;
}
