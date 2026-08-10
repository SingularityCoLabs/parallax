import type { ToolResult } from '../protocol/index.ts';
import type { StoredTool, ToolExecutionContext } from '../tools/core/index.ts';
import { ErrorCode, fail } from '../tools/core/index.ts';

/**
 * Executes approved tool calls. v0.1 is strictly sequential (blueprint §18.1 —
 * correctness over concurrency); the interface leaves room to add
 * resource-scoped parallelism later without touching the turn loop. Wraps every
 * execution so a thrown tool error becomes a structured failed ToolResult
 * rather than crashing the turn.
 */
export class Scheduler {
  async execute(
    tool: StoredTool,
    input: never,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const start = Date.now();
    if (context.signal.aborted) {
      return fail(context.callId, ErrorCode.Cancelled, 'Cancelled before execution', {
        durationMs: 0,
      });
    }
    try {
      const result = await tool.execute(context, input);
      // Backfill duration if the tool didn't set it.
      if (!result.durationMs) {
        return { ...result, durationMs: Date.now() - start };
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : ErrorCode.InternalError;
      const retryable =
        err && typeof err === 'object' && 'retryable' in err
          ? Boolean((err as { retryable: unknown }).retryable)
          : false;
      return fail(context.callId, code, message, {
        retryable,
        durationMs: Date.now() - start,
      });
    }
  }
}
