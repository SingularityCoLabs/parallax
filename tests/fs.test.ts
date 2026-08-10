import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveWorkspacePath } from '../src/tools/fs/paths.ts';
import { FileStateCache } from '../src/tools/fs/fileState.ts';
import { createReadFileTool } from '../src/tools/fs/readFile.ts';
import { createListDirectoryTool } from '../src/tools/fs/listDirectory.ts';
import { createSearchFilesTool } from '../src/tools/fs/searchFiles.ts';
import type { ToolExecutionContext } from '../src/tools/core/index.ts';
import { getLogger } from '../src/observability/index.ts';

let root: string;
let outside: string;

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'parallax-fs-'));
  root = join(base, 'workspace');
  outside = join(base, 'outside');
  mkdirSync(root, { recursive: true });
  mkdirSync(outside, { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{\n  "name": "fixture"\n}\n');
  writeFileSync(join(root, 'src', 'app.ts'), 'export const hello = () => "world";\n');
  writeFileSync(join(outside, 'secret.txt'), 'TOP SECRET\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

function ctx(callId = 'c1'): ToolExecutionContext {
  return {
    callId,
    workspaceRoot: root,
    signal: new AbortController().signal,
    emitStdout: () => {},
    emitStderr: () => {},
    logger: getLogger(),
  };
}

describe('workspace path resolver', () => {
  it('resolves an in-workspace relative path', () => {
    const rp = resolveWorkspacePath(root, 'src/app.ts');
    expect(rp.outsideWorkspace).toBe(false);
    expect(rp.exists).toBe(true);
  });

  it('denies ../ traversal outside the workspace', () => {
    const rp = resolveWorkspacePath(root, '../outside/secret.txt');
    expect(rp.outsideWorkspace).toBe(true);
  });

  it('denies an absolute path outside the workspace', () => {
    const rp = resolveWorkspacePath(root, join(outside, 'secret.txt'));
    expect(rp.outsideWorkspace).toBe(true);
  });

  it('denies a symlink that points outside the workspace', () => {
    symlinkSync(outside, join(root, 'escape'));
    const rp = resolveWorkspacePath(root, 'escape/secret.txt');
    expect(rp.outsideWorkspace).toBe(true);
  });

  it('allows a new (non-existent) file under a valid parent', () => {
    const rp = resolveWorkspacePath(root, 'src/newfile.ts');
    expect(rp.outsideWorkspace).toBe(false);
    expect(rp.exists).toBe(false);
  });

  it('denies a new file whose parent is a symlink escaping the workspace', () => {
    symlinkSync(outside, join(root, 'escape'));
    const rp = resolveWorkspacePath(root, 'escape/newfile.txt');
    expect(rp.outsideWorkspace).toBe(true);
  });
});

describe('read_file', () => {
  it('reads a workspace file and records a fingerprint', async () => {
    const fileState = new FileStateCache();
    const tool = createReadFileTool({ fileState, maxBytes: 100_000 });
    const result = await tool.execute(ctx(), { path: 'package.json' });
    expect(result.ok).toBe(true);
    expect(result.modelContent).toContain('fixture');
    // Fingerprint recorded for the canonical path.
    const rp = resolveWorkspacePath(root, 'package.json');
    expect(fileState.get(rp.real)).toBeDefined();
  });

  it('denies reading a file outside the workspace', async () => {
    const fileState = new FileStateCache();
    const tool = createReadFileTool({ fileState, maxBytes: 100_000 });
    const result = await tool.execute(ctx(), { path: '../outside/secret.txt' });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('path_outside_workspace');
  });

  it('reports the escape via describe() so policy can deny before reading', async () => {
    const fileState = new FileStateCache();
    const tool = createReadFileTool({ fileState, maxBytes: 100_000 });
    const desc = await tool.describe!(ctx(), { path: '../outside/secret.txt' });
    expect(desc.outsideWorkspace).toBe(true);
  });

  it('honors line offset/limit', async () => {
    writeFileSync(join(root, 'multi.txt'), 'a\nb\nc\nd\ne\n');
    const tool = createReadFileTool({ fileState: new FileStateCache(), maxBytes: 100_000 });
    const result = await tool.execute(ctx(), { path: 'multi.txt', offset: 1, limit: 2 });
    expect(result.modelContent).toBe('b\nc');
  });
});

describe('list_directory', () => {
  it('lists workspace entries deterministically', async () => {
    const tool = createListDirectoryTool({ maxEntries: 100 });
    const result = await tool.execute(ctx(), { path: '.' });
    expect(result.ok).toBe(true);
    expect(result.modelContent).toContain('package.json');
    expect(result.modelContent).toContain('src/');
  });

  it('denies listing outside the workspace', async () => {
    const tool = createListDirectoryTool({ maxEntries: 100 });
    const result = await tool.execute(ctx(), { path: '../outside' });
    expect(result.error?.code).toBe('path_outside_workspace');
  });
});

describe('search_files', () => {
  it('finds matches with path:line:text', async () => {
    const tool = createSearchFilesTool({ maxResults: 100, maxFileBytes: 100_000 });
    const result = await tool.execute(ctx(), {
      path: '.',
      query: 'hello',
      regex: false,
      ignoreCase: false,
    });
    expect(result.ok).toBe(true);
    expect(result.modelContent).toMatch(/src\/app\.ts:1:/);
  });

  it('never returns matches from outside the workspace', async () => {
    const tool = createSearchFilesTool({ maxResults: 100, maxFileBytes: 100_000 });
    const result = await tool.execute(ctx(), {
      path: '.',
      query: 'SECRET',
      regex: false,
      ignoreCase: false,
    });
    expect(result.modelContent).toBe('no matches');
  });
});
