import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ToolSchema } from '../../protocol/index.ts';
import type { ToolDefinition } from './Tool.ts';
import { UnknownToolError } from './errors.ts';

/**
 * Internal storage shape for a heterogeneous tool set. Using `never` as the
 * input parameter means a validated `inputSchema.parse()` result (also `never`)
 * flows into `execute()` without casts in the turn loop, while `register()`
 * accepts concretely-typed tools via a boundary cast.
 */
type StoredTool = ToolDefinition<never, unknown>;

/**
 * The registry the agent loop consults instead of a per-tool switch statement
 * (blueprint §12). It also projects tools into model-facing JSON-Schema
 * definitions via `modelSchemas()`.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, StoredTool>();

  register<I, O>(tool: ToolDefinition<I, O>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool as unknown as StoredTool);
  }

  registerAll(tools: readonly ToolDefinition<unknown, unknown>[]): void {
    for (const tool of tools) this.register(tool);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): StoredTool {
    const tool = this.tools.get(name);
    if (!tool) throw new UnknownToolError(name);
    return tool;
  }

  list(): readonly StoredTool[] {
    return [...this.tools.values()];
  }

  /** JSON-Schema tool definitions advertised to the model (blueprint §12.1). */
  modelSchemas(): ToolSchema[] {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.inputSchema, { target: 'openApi3' }),
    }));
  }
}

export type { StoredTool };
