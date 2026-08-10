import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ToolRegistry, ok, type ToolDefinition } from '../src/tools/core/index.ts';
import { UnknownToolError } from '../src/tools/core/errors.ts';

const echoTool: ToolDefinition<{ text: string }, { echoed: string }> = {
  name: 'echo',
  description: 'Echo the given text',
  inputSchema: z.object({ text: z.string() }),
  risk: 'read',
  resourceClass: 'pure_read',
  execute(ctx, input) {
    return Promise.resolve(ok(ctx.callId, 'echoed', { echoed: input.text }));
  },
};

describe('ToolRegistry', () => {
  it('registers, looks up, and lists tools', () => {
    const r = new ToolRegistry();
    r.register(echoTool);
    expect(r.has('echo')).toBe(true);
    expect(r.get('echo').name).toBe('echo');
    expect(r.list().map((t) => t.name)).toEqual(['echo']);
  });

  it('throws UnknownToolError for missing tools', () => {
    const r = new ToolRegistry();
    expect(() => r.get('nope')).toThrow(UnknownToolError);
  });

  it('rejects duplicate registration', () => {
    const r = new ToolRegistry();
    r.register(echoTool);
    expect(() => r.register(echoTool)).toThrow(/already registered/);
  });

  it('exports JSON-schema tool definitions for the model', () => {
    const r = new ToolRegistry();
    r.register(echoTool);
    const schemas = r.modelSchemas();
    expect(schemas).toHaveLength(1);
    const schema = schemas[0]!;
    expect(schema.name).toBe('echo');
    expect(schema.description).toBe('Echo the given text');
    // JSON Schema object with a required string `text` property.
    const params = schema.parameters as {
      type: string;
      properties: Record<string, { type: string }>;
      required?: string[];
    };
    expect(params.type).toBe('object');
    expect(params.properties.text?.type).toBe('string');
    expect(params.required).toContain('text');
  });
});
