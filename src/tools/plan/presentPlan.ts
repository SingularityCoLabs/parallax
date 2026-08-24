import { z } from 'zod';
import { PLAN_TOOL_NAME } from '../../protocol/index.ts';
import { ok, truncateMiddle, type ToolDefinition } from '../core/index.ts';

/**
 * `present_plan` (Claude Code's ExitPlanMode). The agent researches read-only in
 * `plan` mode, then calls this to present a concrete implementation plan for
 * approval. The tool itself has no side effects (risk `read`) — it just echoes
 * the plan so the TUI can render it (see PlanBlock). The *gate* behavior lives
 * outside the tool:
 *
 *   - PolicyEngine turns this one tool into an ASK when the session is in `plan`
 *     mode (it is a no-op ALLOW in other modes).
 *   - TurnController, on approval, flips the session from `plan` to `workspace`
 *     and emits `mode.changed`, so the same turn can start executing.
 *
 * Keeping the mode transition in the runtime (not the tool) respects the layer
 * boundary: a tool has no access to the session store or event bus.
 */

const inputSchema = z.object({
  /** The implementation plan, as Markdown. Shown to the user for approval. */
  plan: z.string().min(1),
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  plan: string;
}

export function createPresentPlanTool(deps: {
  maxModelChars: number;
}): ToolDefinition<Input, Output> {
  return {
    name: PLAN_TOOL_NAME,
    description:
      'Present a concrete implementation plan and ask the user for approval to start executing it. Use ' +
      'ONLY when in plan mode, after you have finished researching (reading files, searching). Approving ' +
      'the plan exits plan mode and switches to workspace mode so you can make changes; do not call it ' +
      'when already in workspace mode. Pass the full plan as Markdown in `plan`.',
    inputSchema,
    risk: 'read',
    resourceClass: 'pure_read',
    describe(_ctx, _input) {
      return Promise.resolve({
        title: 'Ready to code? Approve to exit plan mode and start executing',
      });
    },
    execute(ctx, input) {
      const modelContent = truncateMiddle(input.plan, { maxChars: deps.maxModelChars }).text;
      return Promise.resolve(
        ok(ctx.callId, 'presented plan for approval', { plan: input.plan }, { modelContent }),
      );
    },
  };
}
