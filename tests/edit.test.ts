import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStateCache } from '../src/tools/fs/fileState.ts';
import { createReadFileTool } from '../src/tools/fs/readFile.ts';
import { createWriteFileTool } from '../src/tools/fs/writeFile.ts';
import { createEditFileTool } from '../src/tools/fs/editFile.ts';
import { lineDiff } from '../src/tools/fs/diff.ts';
import type { ToolExecutionContext } from '../src/tools/core/index.ts';
import { getLogger } from '../src/observability/index.ts';

let root: string;
let fileState: FileStateCache;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'parallax-edit-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'app.ts'), 'export const x = 1;\nexport const y = 2;\n');
  fileState = new FileStateCache();
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function ctx(): ToolExecutionContext {
  return {
    callId: 'c1',
    workspaceRoot: root,
    signal: new AbortController().signal,
    emitStdout: () => {},
    emitStderr: () => {},
    logger: getLogger(),
  };
}

async function readInto(path: string) {
  const read = createReadFileTool({ fileState, maxBytes: 100_000 });
  await read.execute(ctx(), { path });
}

describe('lineDiff', () => {
  it('counts added and removed lines', () => {
    const d = lineDiff('a\nb\nc\n', 'a\nB\nc\n');
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.preview).toContain('- b');
    expect(d.preview).toContain('+ B');
  });
});

describe('edit_file', () => {
  it('refuses to edit a file that was not read (stale)', async () => {
    const edit = createEditFileTool({ fileState, maxDiffChars: 4000 });
    const result = await edit.execute(ctx(), {
      path: 'src/app.ts',
      oldText: 'export const x = 1;',
      newText: 'export const x = 42;',
      replaceAll: false,
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('stale_file');
  });

  it('edits after a read and writes atomically', async () => {
    await readInto('src/app.ts');
    const edit = createEditFileTool({ fileState, maxDiffChars: 4000 });
    const result = await edit.execute(ctx(), {
      path: 'src/app.ts',
      oldText: 'export const x = 1;',
      newText: 'export const x = 42;',
      replaceAll: false,
    });
    expect(result.ok).toBe(true);
    expect(readFileSync(join(root, 'src', 'app.ts'), 'utf8')).toContain('x = 42');
  });

  it('rejects when the target text is missing', async () => {
    await readInto('src/app.ts');
    const edit = createEditFileTool({ fileState, maxDiffChars: 4000 });
    const result = await edit.execute(ctx(), {
      path: 'src/app.ts',
      oldText: 'not present',
      newText: 'x',
      replaceAll: false,
    });
    expect(result.error?.code).toBe('match_not_found');
  });

  it('rejects a non-unique match unless replaceAll', async () => {
    writeFileSync(join(root, 'dup.ts'), 'a\na\n');
    await readInto('dup.ts');
    const edit = createEditFileTool({ fileState, maxDiffChars: 4000 });
    const notUnique = await edit.execute(ctx(), {
      path: 'dup.ts',
      oldText: 'a',
      newText: 'b',
      replaceAll: false,
    });
    expect(notUnique.error?.code).toBe('match_not_unique');

    await readInto('dup.ts');
    const all = await edit.execute(ctx(), {
      path: 'dup.ts',
      oldText: 'a',
      newText: 'b',
      replaceAll: true,
    });
    expect(all.ok).toBe(true);
    expect(readFileSync(join(root, 'dup.ts'), 'utf8')).toBe('b\nb\n');
  });

  it('detects external modification between read and edit (stale)', async () => {
    await readInto('src/app.ts');
    // Simulate an external editor changing the file after the agent read it.
    writeFileSync(join(root, 'src', 'app.ts'), 'export const x = 999;\n');
    const edit = createEditFileTool({ fileState, maxDiffChars: 4000 });
    const result = await edit.execute(ctx(), {
      path: 'src/app.ts',
      oldText: 'export const x = 1;',
      newText: 'export const x = 2;',
      replaceAll: false,
    });
    expect(result.error?.code).toBe('stale_file');
  });

  it('exposes a diff preview via describe()', async () => {
    await readInto('src/app.ts');
    const edit = createEditFileTool({ fileState, maxDiffChars: 4000 });
    const desc = await edit.describe!(ctx(), {
      path: 'src/app.ts',
      oldText: 'export const x = 1;',
      newText: 'export const x = 42;',
      replaceAll: false,
    });
    expect(desc.diffPreview).toContain('+ export const x = 42;');
    expect(desc.outsideWorkspace).toBe(false);
  });
});

describe('write_file', () => {
  it('creates a new file', async () => {
    const write = createWriteFileTool({ fileState });
    const result = await write.execute(ctx(), { path: 'new/note.txt', content: 'hello\n' });
    expect(result.ok).toBe(true);
    expect(readFileSync(join(root, 'new', 'note.txt'), 'utf8')).toBe('hello\n');
  });

  it('requires a read before overwriting an observed file that changed', async () => {
    await readInto('src/app.ts');
    writeFileSync(join(root, 'src', 'app.ts'), 'changed externally\n');
    const write = createWriteFileTool({ fileState });
    const result = await write.execute(ctx(), { path: 'src/app.ts', content: 'new content\n' });
    expect(result.error?.code).toBe('stale_file');
  });

  it('denies writing outside the workspace', async () => {
    const write = createWriteFileTool({ fileState });
    const result = await write.execute(ctx(), { path: '../escape.txt', content: 'x' });
    expect(result.error?.code).toBe('path_outside_workspace');
  });
});
