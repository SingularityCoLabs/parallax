import { writeFileSync, renameSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { newToolCallId } from '../../protocol/index.ts';

/**
 * Write content atomically: write to a sibling temp file then rename over the
 * target (blueprint §13.4). Rename is atomic on the same filesystem, so readers
 * never observe a half-written file. Creates parent directories as needed.
 */
export function atomicWrite(canonicalPath: string, content: string): void {
  const dir = dirname(canonicalPath);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(canonicalPath)}.${newToolCallId()}.tmp`);
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, canonicalPath);
}

/** Read a file as UTF-8, or return undefined if it does not exist. */
export function readIfExists(canonicalPath: string): string | undefined {
  try {
    return readFileSync(canonicalPath, 'utf8');
  } catch {
    return undefined;
  }
}
