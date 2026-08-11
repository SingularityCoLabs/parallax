import { describe, it, expect } from 'vitest';
import { AnthropicProvider, ProviderHttpError } from '../src/providers/index.ts';
import type { FetchLike } from '../src/providers/index.ts';
import type { ModelEvent, ModelRequest } from '../src/providers/index.ts';

/** Build a Response whose body streams the given SSE frames. */
function sseResponse(frames: string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
  return new Response(body, { status });
}

/** Anthropic frames each event as `event: <t>\ndata: {json}\n\n`. */
function frame(obj: unknown): string {
  const type = (obj as { type: string }).type;
  return `event: ${type}\ndata: ${JSON.stringify(obj)}\n\n`;
}

const baseRequest: ModelRequest = {
  model: 'claude-opus-4-8',
  system: 'You are a test.',
  messages: [{ role: 'user', content: 'hi' }],
  tools: [
    {
      name: 'read_file',
      description: 'read a file',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  ],
};

async function collect(it: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const out: ModelEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('AnthropicProvider', () => {
  it('sends an Anthropic /messages request with system, tools, and auth', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl: FetchLike = (url, init) => {
      captured = { url, init };
      return Promise.resolve(
        sseResponse([
          frame({ type: 'message_start', message: { usage: { input_tokens: 5 } } }),
          frame({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'ok' },
          }),
          frame({ type: 'message_stop' }),
        ]),
      );
    };
    const provider = new AnthropicProvider({
      name: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'sk-ant-test',
      maxTokens: 1234,
      fetchImpl,
    });

    await collect(provider.stream(baseRequest, new AbortController().signal));

    expect(captured?.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = captured?.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(captured?.init.body as string) as {
      model: string;
      stream: boolean;
      max_tokens: number;
      system: string;
      messages: Array<{ role: string; content: unknown }>;
      tools: Array<{ name: string; input_schema: unknown }>;
    };
    expect(body.model).toBe('claude-opus-4-8');
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(1234);
    // System is top-level, not a message.
    expect(body.system).toBe('You are a test.');
    expect(body.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'hi' }] });
    expect(body.tools[0]?.name).toBe('read_file');
    expect(body.tools[0]?.input_schema).toEqual(baseRequest.tools[0]?.parameters);
    // No sampling / thinking params (Opus 4.8 would 400 on those).
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('thinking');
  });

  it('groups consecutive tool results into a single user turn and alternates roles', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl: FetchLike = (url, init) => {
      captured = { url, init };
      return Promise.resolve(sseResponse([frame({ type: 'message_stop' })]));
    };
    const provider = new AnthropicProvider({
      name: 'anthropic',
      baseUrl: 'https://x/v1',
      apiKey: 'k',
      fetchImpl,
    });

    const request: ModelRequest = {
      model: 'claude-opus-4-8',
      system: '',
      tools: [],
      messages: [
        { role: 'user', content: 'do it' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 't1', name: 'read_file', arguments: { path: 'a' } },
            { id: 't2', name: 'read_file', arguments: { path: 'b' } },
          ],
        },
        { role: 'tool', toolCallId: 't1', content: 'A' },
        { role: 'tool', toolCallId: 't2', content: 'B' },
      ],
    };

    await collect(provider.stream(request, new AbortController().signal));
    const body = JSON.parse(captured?.init.body as string) as {
      messages: Array<{ role: string; content: Array<{ type: string }> }>;
    };
    // user → assistant(tool_use x2) → user(tool_result x2) — 3 messages, alternating.
    expect(body.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(body.messages[1]?.content.map((b) => b.type)).toEqual(['tool_use', 'tool_use']);
    expect(body.messages[2]?.content).toEqual([
      { type: 'tool_result', tool_use_id: 't1', content: 'A' },
      { type: 'tool_result', tool_use_id: 't2', content: 'B' },
    ]);
    // No empty text block on the tool-only assistant turn.
    expect(body.messages[1]?.content.some((b) => b.type === 'text')).toBe(false);
  });

  it('normalizes streamed text deltas, usage, and completion', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        sseResponse([
          frame({ type: 'message_start', message: { usage: { input_tokens: 12 } } }),
          frame({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }),
          frame({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'Hello ' },
          }),
          frame({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'world' },
          }),
          frame({
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 3 },
          }),
          frame({ type: 'message_stop' }),
        ]),
      );
    const provider = new AnthropicProvider({
      name: 'anthropic',
      baseUrl: 'https://x/v1',
      apiKey: 'k',
      fetchImpl,
    });

    const events = await collect(provider.stream(baseRequest, new AbortController().signal));
    expect(events).toEqual([
      { type: 'text.delta', text: 'Hello ' },
      { type: 'text.delta', text: 'world' },
      { type: 'usage', inputTokens: 12, outputTokens: 3 },
      { type: 'completed', reason: 'end_turn' },
    ]);
  });

  it('accumulates streamed tool-call input_json deltas into a completed ToolCall', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        sseResponse([
          frame({
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: 'call_1', name: 'read_file' },
          }),
          frame({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '{"pa' },
          }),
          frame({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: 'th":"a.ts"}' },
          }),
          frame({ type: 'message_delta', delta: { stop_reason: 'tool_use' } }),
          frame({ type: 'message_stop' }),
        ]),
      );
    const provider = new AnthropicProvider({
      name: 'anthropic',
      baseUrl: 'https://x/v1',
      apiKey: 'k',
      fetchImpl,
    });

    const events = await collect(provider.stream(baseRequest, new AbortController().signal));
    const toolEvent = events.find((e) => e.type === 'tool_call.completed');
    expect(toolEvent).toEqual({
      type: 'tool_call.completed',
      call: { id: 'call_1', name: 'read_file', arguments: { path: 'a.ts' } },
    });
    expect(events.at(-1)).toEqual({ type: 'completed', reason: 'tool_use' });
  });

  it('throws ProviderHttpError with a helpful message on non-2xx', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(new Response('invalid x-api-key', { status: 401 }));
    const provider = new AnthropicProvider({
      name: 'anthropic',
      baseUrl: 'https://x/v1',
      apiKey: 'bad',
      fetchImpl,
    });
    await expect(async () => {
      for await (const _ of provider.stream(baseRequest, new AbortController().signal)) {
        /* drain */
      }
    }).rejects.toThrowError(ProviderHttpError);
  });

  it('reports native tool-call and vision capabilities', async () => {
    const provider = new AnthropicProvider({
      name: 'anthropic',
      baseUrl: 'https://x/v1',
      apiKey: 'k',
    });
    const caps = await provider.getCapabilities('claude-opus-4-8');
    expect(caps.streaming).toBe(true);
    expect(caps.nativeToolCalls).toBe(true);
    expect(caps.vision).toBe(true);
  });
});
