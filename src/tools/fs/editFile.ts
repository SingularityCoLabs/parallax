import { statSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { ErrorCode, fail, ok, truncateMiddle, type ToolDefinition } from '../core/index.ts';
import { resolveWorkspacePath } from './paths.ts';
import { fingerprintFrom, type FileStateCache } from './fileState.ts';
import { atomicWrite } from './atomicWrite.ts';
import { lineDiff } from './diff.ts';

export interface EditFileDeps {
  fileState: FileStateCache;
  maxDiffChars: number;
}

const inputSchema = z.object({
  path: z.string().min(1),
  oldText: z.string().min(1),
  newText: z.string(),
  replaceAll: z.boolean().default(false),
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  path: string;
  replacements: number;
  linesAdded: number;
  linesRemoved: number;
  diff: string;
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

/**
 * `edit_file` (blueprint §13.5). Exact-match replacement — the simplest correct
 * editor. Requires the file to have been read (stale-check, §13.3), the target
 * text to exist, and (unless `replaceAll`) to be unique. Writes atomically and
 * returns a diff. Fuzzy/AST edits are explicit future work.
 */
export function createEditFileTool(deps: EditFileDeps): ToolDefinition<Input, Output> {
  const computeEdit = (
    ctx: { workspaceRoot: string },
    input: Input,
  ): { current: string; next: string; count: number } | { error: string } => {
    let current: string;
    try {
      const rp = resolveWorkspacePath(ctx.workspaceRoot, input.path);
      current = readFileSync(rp.real, 'utf8');
    } catch {
      return { error: 'unreadable' };
    }
    const count = countOccurrences(current, input.oldText);
    if (count === 0) return { current, next: current, count: 0 };
    const next = input.replaceAll
      ? current.split(input.oldText).join(input.newText)
      : current.replace(input.oldText, input.newText);
    return { current, next, count };
  };

  return {
    name: 'edit_file',
    description:
      'Replace an exact snippet of text in a workspace file. The file must be read first. By default the snippet must match exactly once; set replaceAll to replace every occurrence.',
    inputSchema,
    risk: 'write',
    resourceClass: 'filesystem_write',
    describe(ctx, input) {
      const rp = resolveWorkspacePath(ctx.workspaceRoot, input.path);
      const result = computeEdit(ctx, input);
      if ('error' in result) {
        return Promise.resolve({
          title: `Edit ${input.path}`,
          detail: 'file cannot be read (edit will fail)',
          paths: [rp.real],
          outsideWorkspace: rp.outsideWorkspace,
        });
      }
      if (result.count === 0) {
        return Promise.resolve({
          title: `Edit ${input.path}`,
          detail: 'target text not found (edit will fail)',
          paths: [rp.real],
          outsideWorkspace: rp.outsideWorkspace,
        });
      }
      const diff = lineDiff(result.current, result.next);
      return Promise.resolve({
        title: `Edit ${input.path}`,
        detail: `+${diff.added} -${diff.removed} lines, ${result.count} match(es)`,
        paths: [rp.real],
        outsideWorkspace: rp.outsideWorkspace,
        diffPreview: truncateMiddle(diff.preview, { maxChars: deps.maxDiffChars }).text,
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
        return Promise.resolve(fail(ctx.callId, ErrorCode.NotAFile, `Not a file: ${input.path}`));
      }

      const current = readFileSync(rp.real, 'utf8');

      // Read-before-write: must be observed and unchanged (blueprint §13.3).
      const stale = deps.fileState.checkFresh(rp.real, current);
      if (stale) {
        return Promise.resolve(fail(ctx.callId, ErrorCode.StaleFile, stale));
      }

      const count = countOccurrences(current, input.oldText);
      if (count === 0) {
        return Promise.resolve(
          fail(ctx.callId, ErrorCode.MatchNotFound, `oldText not found in ${input.path}`),
        );
      }
      if (count > 1 && !input.replaceAll) {
        return Promise.resolve(
          fail(
            ctx.callId,
            ErrorCode.MatchNotUnique,
            `oldText matches ${count} times in ${input.path}; make it unique or set replaceAll`,
          ),
        );
      }

      const next = input.replaceAll
        ? current.split(input.oldText).join(input.newText)
        : current.replace(input.oldText, input.newText);
      const diff = lineDiff(current, next);

      atomicWrite(rp.real, next);
      deps.fileState.record(fingerprintFrom(rp.real, next));

      const output: Output = {
        path: input.path,
        replacements: input.replaceAll ? count : 1,
        linesAdded: diff.added,
        linesRemoved: diff.removed,
        diff: truncateMiddle(diff.preview, { maxChars: deps.maxDiffChars }).text,
      };
      return Promise.resolve(
        ok(
          ctx.callId,
          `edited ${input.path} (+${diff.added} -${diff.removed})`,
          output,
          {
            modelContent: `Edited ${input.path}: ${output.replacements} replacement(s), +${diff.added} -${diff.removed} lines.`,
          },
        ),
      );
    },
  };
}
