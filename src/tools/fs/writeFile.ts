import { z } from 'zod';
import { ErrorCode, fail, ok, type ToolDefinition } from '../core/index.ts';
import { resolveWorkspacePath } from './paths.ts';
import { fingerprintFrom, type FileStateCache } from './fileState.ts';
import { atomicWrite, readIfExists } from './atomicWrite.ts';
import { lineDiff } from './diff.ts';

export interface WriteFileDeps {
  fileState: FileStateCache;
}

const inputSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  path: string;
  created: boolean;
  bytesWritten: number;
}

/**
 * `write_file` (blueprint §13.4). Creates a new file or fully replaces an
 * existing one. Replacing an existing file requires it to have been read first
 * (stale-check, §13.3) so the model can't clobber external changes blindly.
 * Writes atomically (temp + rename).
 */
export function createWriteFileTool(deps: WriteFileDeps): ToolDefinition<Input, Output> {
  return {
    name: 'write_file',
    description:
      'Create a new file or completely replace an existing file within the workspace. Existing files must be read first.',
    inputSchema,
    risk: 'write',
    resourceClass: 'filesystem_write',
    describe(ctx, input) {
      const rp = resolveWorkspacePath(ctx.workspaceRoot, input.path);
      const existing = rp.exists ? (readIfExists(rp.real) ?? '') : undefined;
      const diff =
        existing !== undefined ? lineDiff(existing, input.content) : lineDiff('', input.content);
      return Promise.resolve({
        title: existing !== undefined ? `Overwrite ${input.path}` : `Create ${input.path}`,
        detail: `+${diff.added} -${diff.removed} lines`,
        paths: [rp.real],
        outsideWorkspace: rp.outsideWorkspace,
        diffPreview: diff.preview,
      });
    },
    execute(ctx, input) {
      const rp = resolveWorkspacePath(ctx.workspaceRoot, input.path);
      if (rp.outsideWorkspace) {
        return Promise.resolve(
          fail(ctx.callId, ErrorCode.PathOutsideWorkspace, `Path escapes workspace: ${input.path}`),
        );
      }

      let created = true;
      if (rp.exists) {
        created = false;
        // Replacing an existing file requires a fresh read (blueprint §13.3).
        const current = readIfExists(rp.real) ?? '';
        const stale = deps.fileState.checkFresh(rp.real, current);
        if (stale) {
          return Promise.resolve(fail(ctx.callId, ErrorCode.StaleFile, stale));
        }
      }

      atomicWrite(rp.real, input.content);
      deps.fileState.record(fingerprintFrom(rp.real, input.content));

      const bytesWritten = Buffer.byteLength(input.content);
      const output: Output = { path: input.path, created, bytesWritten };
      return Promise.resolve(
        ok(
          ctx.callId,
          `${created ? 'created' : 'overwrote'} ${input.path} (${bytesWritten} bytes)`,
          output,
          { modelContent: `${created ? 'Created' : 'Overwrote'} ${input.path}.` },
        ),
      );
    },
  };
}
