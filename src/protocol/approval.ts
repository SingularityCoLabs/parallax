import { z } from 'zod';
import { toolRiskSchema, type ToolRisk } from './risk.ts';

/** How a human (or policy) resolved an ASK decision. */
export type ApprovalDecision = 'allow_once' | 'deny';

export const approvalDecisionSchema: z.ZodType<ApprovalDecision> = z.enum(['allow_once', 'deny']);

/**
 * Everything a UI needs to render an approval prompt for a proposed side effect
 * (blueprint §16.1, §23.2). Carries a human-facing title/detail and an optional
 * diff preview for edits — never raw secrets.
 */
export interface ApprovalRequest {
  id: string;
  toolCallId: string;
  toolName: string;
  risk: ToolRisk;
  title: string;
  detail?: string;
  diffPreview?: string;
}

export const approvalRequestSchema = z.object({
  id: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  risk: toolRiskSchema,
  title: z.string(),
  detail: z.string().optional(),
  diffPreview: z.string().optional(),
});
