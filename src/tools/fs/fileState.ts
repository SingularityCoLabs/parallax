import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';

/** A snapshot of a file's identity at observation time (blueprint §13.3). */
export interface FileFingerprint {
  canonicalPath: string;
  mtimeMs: number;
  size: number;
  contentHash: string;
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function fingerprintFrom(canonicalPath: string, content: string): FileFingerprint {
  let mtimeMs = 0;
  let size = Buffer.byteLength(content);
  try {
    const st = statSync(canonicalPath);
    mtimeMs = st.mtimeMs;
    size = st.size;
  } catch {
    // File may not exist yet (new write); keep computed size.
  }
  return { canonicalPath, mtimeMs, size, contentHash: hashContent(content) };
}

/**
 * Tracks the last-observed state of files the agent has read, so an edit/write
 * can detect concurrent external modification and refuse to clobber it
 * (blueprint §13.3, Principle "read-before-write"). Keyed by canonical real path.
 * One instance per session, injected into fs tools by the composition root.
 */
export class FileStateCache {
  private readonly observed = new Map<string, FileFingerprint>();

  record(fingerprint: FileFingerprint): void {
    this.observed.set(fingerprint.canonicalPath, fingerprint);
  }

  get(canonicalPath: string): FileFingerprint | undefined {
    return this.observed.get(canonicalPath);
  }

  /**
   * Verify the on-disk file still matches what we last observed. Returns a
   * reason string if stale/unobserved, or undefined if the write may proceed.
   */
  checkFresh(canonicalPath: string, currentContent: string): string | undefined {
    const prior = this.observed.get(canonicalPath);
    if (!prior) {
      return 'file has not been read in this session; read it before editing';
    }
    const currentHash = hashContent(currentContent);
    if (currentHash !== prior.contentHash) {
      return 'file changed on disk since it was read; re-read before editing';
    }
    return undefined;
  }
}
