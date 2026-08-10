import { readFileSync, statSync } from 'node:fs';
import { z } from 'zod';
import { ErrorCode, fail, ok, truncateMiddle, type ToolDefinition } from '../core/index.ts';
import { resolveWorkspacePath } from './paths.ts';
import { fingerprintFrom, type FileStateCache } from './fileState.ts';

export interface ReadFileDeps {
  fileState: FileStateCache;
  maxBytes: number;
}

const inputSchema = z.object({
  path: z.string().min(1),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  path: string;
  content: string;
  sizeBytes: number;
  lineCount: number;
  truncated: boolean;
  fingerprint: string;
}

const NUL = 0;

/**
 * `read_file` (blueprint §13.2). Native TS read — bounded, workspace-scoped,
 * binary-aware. Records a fingerprint so a later edit can enforce
 * read-before-write (§13.3). Line offset/limit let the model page large files.
 */
export function createReadFileTool(deps: ReadFileDeps): ToolDefinition<Input, Output> {
  return {
    name: 'read_file',
    description:
      'Read a UTF-8 text file within the workspace. Supports optional line offset/limit. Records file state for safe later edits.',
    inputSchema,
    risk: 'read',
    resourceClass: 'pure_read',
    describe(ctx, input) {
      const rp = resolveWorkspacePath(ctx.workspaceRoot, input.path);
      return Promise.resolve({
        title: `Read ${input.path}`,
        paths: [rp.real],
        outsideWorkspace: rp.outsideWorkspace,
      });
    },
    execute(ctx, input) {
      const rp = resolveWorkspacePath(ctx.workspaceRoot, input.path);
      if (rp.outsideWorkspace) {
        return Promise.resolve(
          fail(ctx.callId, ErrorCode.PathOutsideWorkspace, `Path escapes workspace: ${input.path}`),
        );
      }
      let stat;
      try {
        stat = statSync(rp.real);
      } catch {
        return Promise.resolve(
          fail(ctx.callId, ErrorCode.FileNotFound, `File not found: ${input.path}`),
        );
      }
      if (!stat.isFile()) {
        return Promise.resolve(
          fail(ctx.callId, ErrorCode.NotAFile, `Not a regular file: ${input.path}`),
        );
      }

      const raw = readFileSync(rp.real);
      if (raw.includes(NUL)) {
        return Promise.resolve(
          fail(ctx.callId, ErrorCode.NotAFile, `Binary file not supported: ${input.path}`),
        );
      }

      let text = raw.toString('utf8');
      // Record the FULL-content fingerprint before any windowing/truncation, so
      // stale checks compare against the true on-disk content.
      const fingerprint = fingerprintFrom(rp.real, text);
      deps.fileState.record(fingerprint);

      let windowed = false;
      if (input.offset !== undefined || input.limit !== undefined) {
        const lines = text.split('\n');
        const start = input.offset ?? 0;
        const end = input.limit !== undefined ? start + input.limit : lines.length;
        text = lines.slice(start, end).join('\n');
        windowed = start > 0 || end < lines.length;
      }

      const { text: bounded, truncated } = truncateMiddle(text, { maxChars: deps.maxBytes });
      const lineCount = bounded.length === 0 ? 0 : bounded.split('\n').length;

      const output: Output = {
        path: input.path,
        content: bounded,
        sizeBytes: stat.size,
        lineCount,
        truncated: truncated || windowed,
        fingerprint: fingerprint.contentHash.slice(0, 12),
      };
      return Promise.resolve(
        ok(ctx.callId, `read ${input.path} (${lineCount} lines)`, output, {
          truncated: output.truncated,
          modelContent: bounded,
        }),
      );
    },
  };
}
