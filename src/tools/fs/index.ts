import type { ToolDefinition } from '../core/index.ts';
import type { FileStateCache } from './fileState.ts';
import { createReadFileTool } from './readFile.ts';
import { createListDirectoryTool } from './listDirectory.ts';
import { createSearchFilesTool } from './searchFiles.ts';
import { createWriteFileTool } from './writeFile.ts';
import { createEditFileTool } from './editFile.ts';

export { resolveWorkspacePath, canonicalizeRoot, type ResolvedPath } from './paths.ts';
export {
  FileStateCache,
  fingerprintFrom,
  hashContent,
  type FileFingerprint,
} from './fileState.ts';
export { createReadFileTool, type ReadFileDeps } from './readFile.ts';
export { createListDirectoryTool, type ListDirectoryDeps } from './listDirectory.ts';
export { createSearchFilesTool, type SearchFilesDeps } from './searchFiles.ts';
export { createWriteFileTool, type WriteFileDeps } from './writeFile.ts';
export { createEditFileTool, type EditFileDeps } from './editFile.ts';
export { lineDiff, type LineDiff } from './diff.ts';

export interface FsReadToolDeps {
  fileState: FileStateCache;
  maxFileReadBytes: number;
  maxDirEntries: number;
  maxSearchResults: number;
}

/** Build the read-only filesystem tool set (blueprint §13.2/§13.6/§13.7). */
export function createFsReadTools(deps: FsReadToolDeps): ToolDefinition<never, unknown>[] {
  return [
    createReadFileTool({ fileState: deps.fileState, maxBytes: deps.maxFileReadBytes }),
    createListDirectoryTool({ maxEntries: deps.maxDirEntries }),
    createSearchFilesTool({
      maxResults: deps.maxSearchResults,
      maxFileBytes: deps.maxFileReadBytes,
    }),
  ] as unknown as ToolDefinition<never, unknown>[];
}

export interface FsWriteToolDeps {
  fileState: FileStateCache;
  maxDiffChars: number;
}

/** Build the mutating filesystem tool set (blueprint §13.4/§13.5). */
export function createFsWriteTools(deps: FsWriteToolDeps): ToolDefinition<never, unknown>[] {
  return [
    createWriteFileTool({ fileState: deps.fileState }),
    createEditFileTool({ fileState: deps.fileState, maxDiffChars: deps.maxDiffChars }),
  ] as unknown as ToolDefinition<never, unknown>[];
}
