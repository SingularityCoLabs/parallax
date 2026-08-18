import { z } from 'zod';
import { toolRiskSchema, type ToolRisk } from './risk.ts';

/**
 * How a human (or policy) resolved an ASK decision.
 * - `allow_once`: permit this one action.
 * - `allow_always`: permit and *remember* — subsequent calls to the same tool in
 *   this session skip the ASK barrier (Claude Code's "don't ask again").
 * - `deny`: refuse this action.
 */
export type ApprovalDecision = 'allow_once' | 'allow_always' | 'deny';

export const approvalDecisionSchema: z.ZodType<ApprovalDecision> = z.enum([
  'allow_once',
  'allow_always',
  'deny',
]);

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
