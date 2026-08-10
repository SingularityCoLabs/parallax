import type { Config } from '../config/index.ts';
import { HostExecutor } from '../executor/index.ts';
import {
  FileStateCache,
  createReadFileTool,
  createListDirectoryTool,
  createSearchFilesTool,
  createWriteFileTool,
  createEditFileTool,
} from '../tools/fs/index.ts';
import { createShellTool } from '../tools/shell/index.ts';
import type { ToolRegistry } from '../tools/core/index.ts';

/**
 * Builds the full v0.1 tool set and returns a `registerTools` callback for
 * `createRuntime`. This is composition-root wiring (blueprint §7.1 `app`): it is
 * the only place that knows every concrete tool + its dependencies (shared
 * per-session file-state cache, host executor). The CLI never touches this.
 */
export function defaultToolset(config: Config): {
  registerTools: (registry: ToolRegistry) => void;
  fileState: FileStateCache;
} {
  const fileState = new FileStateCache();
  const executor = new HostExecutor();

  const registerTools = (registry: ToolRegistry): void => {
    registry.register(createReadFileTool({ fileState, maxBytes: config.maxFileReadBytes }));
    registry.register(createListDirectoryTool({ maxEntries: config.maxDirEntries }));
    registry.register(
      createSearchFilesTool({
        maxResults: config.maxSearchResults,
        maxFileBytes: config.maxFileReadBytes,
      }),
    );
    registry.register(createWriteFileTool({ fileState }));
    registry.register(
      createEditFileTool({ fileState, maxDiffChars: config.maxToolResultChars }),
    );
    registry.register(
      createShellTool({
        executor,
        defaultTimeoutMs: config.shellTimeoutMs,
        maxOutputBytes: config.shellMaxOutputBytes,
        maxModelChars: config.maxToolResultChars,
      }),
    );
  };

  return { registerTools, fileState };
}
