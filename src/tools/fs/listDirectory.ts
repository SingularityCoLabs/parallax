import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { ErrorCode, fail, ok, type ToolDefinition } from '../core/index.ts';
import { resolveWorkspacePath } from './paths.ts';

export interface ListDirectoryDeps {
  maxEntries: number;
}

const inputSchema = z.object({
  path: z.string().default('.'),
  depth: z.number().int().positive().max(10).optional(),
});

type Input = z.infer<typeof inputSchema>;

interface Entry {
  path: string;
  type: 'file' | 'directory' | 'other';
}

interface Output {
  root: string;
  entries: Entry[];
  truncated: boolean;
}

/** Directories skipped by default to avoid huge internal trees (blueprint §13.6). */
const IGNORED = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'coverage', '.parallax']);

/**
 * `list_directory` (blueprint §13.6). Deterministic sorted output, bounded by
 * entry count and depth, workspace-scoped, skipping massive internal dirs.
 */
export function createListDirectoryTool(deps: ListDirectoryDeps): ToolDefinition<Input, Output> {
  return {
    name: 'list_directory',
    description:
      'List files and directories within the workspace. Optional depth for recursion. Skips node_modules/.git and similar.',
    inputSchema,
    risk: 'read',
    resourceClass: 'pure_read',
    describe(ctx, input) {
      const rp = resolveWorkspacePath(ctx.workspaceRoot, input.path);
      return Promise.resolve({
        title: `List ${input.path}`,
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
          fail(ctx.callId, ErrorCode.FileNotFound, `Directory not found: ${input.path}`),
        );
      }
      if (!stat.isDirectory()) {
        return Promise.resolve(
          fail(ctx.callId, ErrorCode.NotAFile, `Not a directory: ${input.path}`),
        );
      }

      const maxDepth = input.depth ?? 1;
      const entries: Entry[] = [];
      let truncated = false;

      const walk = (absDir: string, depth: number): void => {
        if (truncated || depth > maxDepth) return;
        let names: string[];
        try {
          names = readdirSync(absDir).sort((a, b) => a.localeCompare(b));
        } catch {
          return;
        }
        for (const name of names) {
          if (entries.length >= deps.maxEntries) {
            truncated = true;
            return;
          }
          if (IGNORED.has(name)) continue;
          const abs = join(absDir, name);
          let est;
          try {
            est = statSync(abs);
          } catch {
            continue;
          }
          const type: Entry['type'] = est.isFile()
            ? 'file'
            : est.isDirectory()
              ? 'directory'
              : 'other';
          entries.push({ path: relative(rp.real, abs) || name, type });
          if (type === 'directory') walk(abs, depth + 1);
        }
      };
      walk(rp.real, 1);

      const output: Output = { root: input.path, entries, truncated };
      const lines = entries
        .map((e) => (e.type === 'directory' ? `${e.path}/` : e.path))
        .join('\n');
      return Promise.resolve(
        ok(ctx.callId, `listed ${entries.length} entries in ${input.path}`, output, {
          truncated,
          modelContent: lines || '(empty)',
        }),
      );
    },
  };
}
