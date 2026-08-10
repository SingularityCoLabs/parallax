import type { ApprovalDecision } from './approval.ts';
import type { PermissionMode } from './risk.ts';

/**
 * Commands are the input side of the runtime protocol (blueprint §10, §24). The
 * in-process facade exposes these as methods today; the same shapes can be sent
 * as data over stdio/JSON-RPC when a second client arrives (§47) without
 * reworking the loop.
 */
export interface CreateSessionCommand {
  type: 'session.create';
  cwd: string;
  permissionMode: PermissionMode;
  model?: string;
}

export interface StartTurnCommand {
  type: 'turn.start';
  sessionId: string;
  userText: string;
}

export interface CancelTurnCommand {
  type: 'turn.cancel';
  sessionId: string;
  turnId: string;
}

export interface ResolveApprovalCommand {
  type: 'approval.resolve';
  approvalId: string;
  decision: ApprovalDecision;
}

export type RuntimeCommand =
  CreateSessionCommand | StartTurnCommand | CancelTurnCommand | ResolveApprovalCommand;
