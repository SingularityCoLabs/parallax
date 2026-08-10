import type { z } from 'zod';
import type { Logger } from '../../observability/index.ts';
import type { ResourceClass, ToolResult, ToolRisk } from '../../protocol/index.ts';

/**
 * Per-call runtime concerns handed to a tool at execution time (blueprint §8.4).
 * Tool-specific dependencies (file-state cache, executor) are injected at
 * construction instead, so this context stays generic across all tools.
 */
export interface ToolExecutionContext {
  callId: string;
  /** Canonical absolute workspace root; tools must scope side effects to it. */
  workspaceRoot: string;
  /** Aborted when the turn is cancelled (blueprint §15.2). Tools must honor it. */
  signal: AbortSignal;
  /** Stream partial output to the UI (used by the shell tool). */
  emitStdout: (text: string) => void;
  emitStderr: (text: string) => void;
  logger: Logger;
}

/**
 * A tool's declaration of *what it would do* with a given (already-validated)
 * input, produced before any side effect. The policy engine consumes this to
 * detect workspace escapes and to build approval prompts; the runtime uses
 * `title`/`detail`/`diffPreview` for the approval UI (blueprint §9.2 "normalize
 * resource/path/command" step, §16.1). Resolving paths here keeps the tool as
 * the single source of truth for canonicalization.
 */
export interface ToolActionDescriptor {
  /** Short human label, e.g. "Edit src/app.ts" or "Run `pnpm test`". */
  title: string;
  detail?: string;
  /** Canonical absolute paths this action would touch. */
  paths?: string[];
  /** True if any touched path escapes the workspace root. */
  outsideWorkspace?: boolean;
  /** The command line, for shell actions. */
  command?: string;
  /** Preview diff for edits/writes (never contains secrets). */
  diffPreview?: string;
}

/**
 * A typed capability (blueprint Principle 3 / §8.4). `inputSchema` validates
 * arguments before anything else runs; `risk` + `resourceClass` feed the policy
 * engine deterministically. `execute` receives already-validated input.
 * Optional `describe` runs before policy to normalize/resolve the action.
 */
export interface ToolDefinition<I = unknown, O = unknown> {
  name: string;
  description: string;
  // Input type is `unknown` so schemas using `.default()`/transforms (where the
  // parsed output differs from the raw input) still satisfy the field.
  inputSchema: z.ZodType<I, z.ZodTypeDef, unknown>;
  risk: ToolRisk;
  resourceClass: ResourceClass;
  describe?(context: ToolExecutionContext, input: I): Promise<ToolActionDescriptor>;
  execute(context: ToolExecutionContext, input: I): Promise<ToolResult<O>>;
}

/** Convenience constructor for a successful result. */
export function ok<T>(
  callId: string,
  summary: string,
  data: T,
  extra?: { truncated?: boolean; durationMs?: number; modelContent?: string },
): ToolResult<T> {
  const result: ToolResult<T> = {
    callId,
    ok: true,
    summary,
    data,
    durationMs: extra?.durationMs ?? 0,
  };
  if (extra?.truncated !== undefined) result.truncated = extra.truncated;
  if (extra?.modelContent !== undefined) result.modelContent = extra.modelContent;
  return result;
}

/** Convenience constructor for a failed result. */
export function fail(
  callId: string,
  code: string,
  message: string,
  extra?: { retryable?: boolean; durationMs?: number },
): ToolResult<never> {
  return {
    callId,
    ok: false,
    summary: message,
    error: { code, message, retryable: extra?.retryable ?? false },
    durationMs: extra?.durationMs ?? 0,
  };
}
