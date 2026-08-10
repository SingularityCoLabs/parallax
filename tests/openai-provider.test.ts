import { describe, it, expect } from 'vitest';
import {
  OpenAiCompatibleProvider,
  ProviderHttpError,
  type FetchLike,
} from '../src/providers/index.ts';
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

function dataFrame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

const baseRequest: ModelRequest = {
  model: 'meta/llama-3.3-70b-instruct',
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

describe('OpenAiCompatibleProvider', () => {
  it('sends an OpenAI-compatible request with system, tools, and auth', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl: FetchLike = (url, init) => {
      captured = { url, init };
      return Promise.resolve(
        sseResponse([dataFrame({ choices: [{ delta: { content: 'ok' } }] }), 'data: [DONE]\n\n']),
      );
    };
    const provider = new OpenAiCompatibleProvider({
      name: 'nvidia',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: 'nvapi-test',
      fetchImpl,
    });

    await collect(provider.stream(baseRequest, new AbortController().signal));

    expect(captured?.url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    const headers = captured?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer nvapi-test');
    const body = JSON.parse(captured?.init.body as string) as {
      model: string;
      stream: boolean;
      messages: Array<{ role: string; content: string }>;
      tools: Array<{ type: string; function: { name: string } }>;
      tool_choice: string;
    };
    expect(body.model).toBe('meta/llama-3.3-70b-instruct');
    expect(body.stream).toBe(true);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a test.' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' });
    expect(body.tools[0]?.function.name).toBe('read_file');
    expect(body.tool_choice).toBe('auto');
  });

  it('normalizes streamed text deltas, usage, and completion', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        sseResponse([
          dataFrame({ choices: [{ delta: { content: 'Hello ' } }] }),
          dataFrame({ choices: [{ delta: { content: 'world' } }] }),
          dataFrame({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
          dataFrame({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } }),
          'data: [DONE]\n\n',
        ]),
      );
    const provider = new OpenAiCompatibleProvider({
      name: 'nvidia',
      baseUrl: 'https://x/v1',
      apiKey: 'k',
      fetchImpl,
    });

    const events = await collect(provider.stream(baseRequest, new AbortController().signal));
    expect(events).toEqual([
      { type: 'text.delta', text: 'Hello ' },
      { type: 'text.delta', text: 'world' },
      { type: 'usage', inputTokens: 12, outputTokens: 3 },
      { type: 'completed', reason: 'stop' },
    ]);
  });

  it('accumulates streamed tool-call deltas into a completed ToolCall', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        sseResponse([
          dataFrame({
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: 'call_1', function: { name: 'read_file', arguments: '{"pa' } },
                  ],
                },
              },
            ],
          }),
          dataFrame({
            choices: [
              { delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.ts"}' } }] } },
            ],
          }),
          dataFrame({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
          'data: [DONE]\n\n',
        ]),
      );
    const provider = new OpenAiCompatibleProvider({
      name: 'nvidia',
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
    // The completed event carries the tool_calls finish reason.
    expect(events.at(-1)).toEqual({ type: 'completed', reason: 'tool_calls' });
  });

  it('throws ProviderHttpError with a helpful message on non-2xx', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(new Response('invalid api key', { status: 401 }));
    const provider = new OpenAiCompatibleProvider({
      name: 'nvidia',
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

  it('reports native tool-call capability', async () => {
    const provider = new OpenAiCompatibleProvider({
      name: 'nvidia',
      baseUrl: 'https://x/v1',
      apiKey: 'k',
    });
    const caps = await provider.getCapabilities('any');
    expect(caps.streaming).toBe(true);
    expect(caps.nativeToolCalls).toBe(true);
  });
});
