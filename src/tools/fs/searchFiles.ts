import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { ErrorCode, fail, ok, type ToolDefinition } from '../core/index.ts';
import { resolveWorkspacePath } from './paths.ts';

export interface SearchFilesDeps {
  maxResults: number;
  maxFileBytes: number;
}

const inputSchema = z.object({
  query: z.string().min(1),
  path: z.string().default('.'),
  regex: z.boolean().default(false),
  ignoreCase: z.boolean().default(false),
});

type Input = z.infer<typeof inputSchema>;

interface Match {
  path: string;
  line: number;
  text: string;
}

interface Output {
  matches: Match[];
  truncated: boolean;
}

const IGNORED = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'coverage', '.parallax']);
const NUL = 0;
const MAX_LINE_LEN = 500;

/**
 * `search_files` (blueprint §13.7). A structured, bounded, pure-TS content
 * search so the model gets a stable API instead of constructing shell grep.
 * Skips binary files and huge trees; results are capped and deterministic.
 */
export function createSearchFilesTool(deps: SearchFilesDeps): ToolDefinition<Input, Output> {
  return {
    name: 'search_files',
    description:
      'Search file contents within the workspace for a literal string or regex. Returns bounded path:line:text matches.',
    inputSchema,
    risk: 'read',
    resourceClass: 'pure_read',
    describe(ctx, input) {
      const rp = resolveWorkspacePath(ctx.workspaceRoot, input.path);
      return Promise.resolve({
        title: `Search "${input.query}" in ${input.path}`,
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
          fail(ctx.callId, ErrorCode.FileNotFound, `Path not found: ${input.path}`),
        );
      }

      let matcher: (line: string) => boolean;
      try {
        if (input.regex) {
          const re = new RegExp(input.query, input.ignoreCase ? 'i' : '');
          matcher = (line) => re.test(line);
        } else {
          const needle = input.ignoreCase ? input.query.toLowerCase() : input.query;
          matcher = (line) =>
            (input.ignoreCase ? line.toLowerCase() : line).includes(needle);
        }
      } catch (err) {
        return Promise.resolve(
          fail(
            ctx.callId,
            ErrorCode.ValidationError,
            `Invalid regex: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }

      const matches: Match[] = [];
      let truncated = false;

      const searchFile = (abs: string): void => {
        if (truncated) return;
        let raw: Buffer;
        try {
          const st = statSync(abs);
          if (st.size > deps.maxFileBytes) return;
          raw = readFileSync(abs);
        } catch {
          return;
        }
        if (raw.includes(NUL)) return;
        const lines = raw.toString('utf8').split('\n');
        for (let i = 0; i < lines.length; i += 1) {
          if (matches.length >= deps.maxResults) {
            truncated = true;
            return;
          }
          const line = lines[i]!;
          if (matcher(line)) {
            matches.push({
              path: relative(rp.real, abs),
              line: i + 1,
              text: line.length > MAX_LINE_LEN ? `${line.slice(0, MAX_LINE_LEN)}…` : line,
            });
          }
        }
      };

      const walk = (absDir: string): void => {
        if (truncated) return;
        let names: string[];
        try {
          names = readdirSync(absDir).sort((a, b) => a.localeCompare(b));
        } catch {
          return;
        }
        for (const name of names) {
          if (truncated) return;
          if (IGNORED.has(name)) continue;
          const abs = join(absDir, name);
          let est;
          try {
            est = statSync(abs);
          } catch {
            continue;
          }
          if (est.isDirectory()) walk(abs);
          else if (est.isFile()) searchFile(abs);
        }
      };

      if (stat.isDirectory()) walk(rp.real);
      else if (stat.isFile()) searchFile(rp.real);

      const output: Output = { matches, truncated };
      const rendered = matches.map((m) => `${m.path}:${m.line}: ${m.text}`).join('\n');
      return Promise.resolve(
        ok(ctx.callId, `${matches.length} match(es) for "${input.query}"`, output, {
          truncated,
          modelContent: rendered || 'no matches',
        }),
      );
    },
  };
}
