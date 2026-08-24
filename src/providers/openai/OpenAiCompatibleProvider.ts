import { newToolCallId, type ToolCall } from '../../protocol/index.ts';
import type { ModelEvent } from '../ModelEvent.ts';
import type { ModelRequest } from '../ModelRequest.ts';
import type { ModelCapabilities, ModelProvider } from '../ModelProvider.ts';
import { ProviderHttpError, providerHttpError, redactSecrets, safeText } from '../errors.ts';
import { toChatRequest } from './chatRequest.ts';
import { parseSseStream } from './sse.ts';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface OpenAiCompatibleOptions {
  /** Provider label surfaced in events/sessions (e.g. "nvidia"). */
  name: string;
  /** OpenAI-compatible base URL, e.g. https://integrate.api.nvidia.com/v1 */
  baseUrl: string;
  apiKey: string;
  temperature?: number;
  maxTokens?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: FetchLike;
}

interface StreamingToolCall {
  id: string;
  name: string;
  args: string;
}

/**
 * An OpenAI-compatible chat/completions provider (blueprint §11). Works against
 * any endpoint that speaks the OpenAI wire format — NVIDIA NIM
 * (integrate.api.nvidia.com), a local NIM container, or OpenAI itself — by
 * changing `baseUrl`/`apiKey`/model. Streams natively and assembles streamed
 * tool-call deltas into completed `ToolCall`s before the runtime sees them, so
 * the turn loop stays vendor-agnostic.
 */
export class OpenAiCompatibleProvider implements ModelProvider {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly temperature: number | undefined;
  private readonly maxTokens: number | undefined;
  private readonly fetchImpl: FetchLike;

  constructor(options: OpenAiCompatibleOptions) {
    this.name = options.name;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.temperature = options.temperature;
    this.maxTokens = options.maxTokens;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  getCapabilities(_model: string): Promise<ModelCapabilities> {
    return Promise.resolve({
      streaming: true,
      nativeToolCalls: true,
      parallelToolCalls: true,
      vision: false,
      reasoningControls: false,
    });
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    const body = toChatRequest(request, {
      ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
      ...(this.maxTokens !== undefined ? { maxTokens: this.maxTokens } : {}),
    });

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      // Never let a transport error carry the key (undici's invalid-header-value
      // TypeError echoes the Authorization value verbatim).
      const msg = redactSecrets(err instanceof Error ? err.message : String(err), this.apiKey);
      throw new ProviderHttpError(0, `${this.name} request failed: ${msg}`);
    }

    if (!res.ok) {
      const detail = await safeText(res);
      throw providerHttpError(this.name, res.status, detail);
    }
    if (!res.body) {
      throw new ProviderHttpError(res.status, `${this.name} API returned no response body`);
    }

    const toolCalls = new Map<number, StreamingToolCall>();
    let reason = 'stop';
    let usage: { inputTokens?: number; outputTokens?: number } | undefined;

    const reader = res.body.getReader();
    for await (const payload of parseSseStream(reader, signal)) {
      let chunk: ChatChunk;
      try {
        chunk = JSON.parse(payload) as ChatChunk;
      } catch {
        continue; // ignore malformed keep-alive/comment frames
      }

      const choice = chunk.choices?.[0];
      const delta = choice?.delta;
      if (delta?.content) {
        yield { type: 'text.delta', text: delta.content };
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const entry = toolCalls.get(tc.index) ?? { id: '', name: '', args: '' };
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name = tc.function.name;
          if (tc.function?.arguments) entry.args += tc.function.arguments;
          toolCalls.set(tc.index, entry);
        }
      }
      if (choice?.finish_reason) reason = choice.finish_reason;
      if (chunk.usage) {
        usage = {
          ...(typeof chunk.usage.prompt_tokens === 'number'
            ? { inputTokens: chunk.usage.prompt_tokens }
            : {}),
          ...(typeof chunk.usage.completion_tokens === 'number'
            ? { outputTokens: chunk.usage.completion_tokens }
            : {}),
        };
      }
    }

    // Emit assembled tool calls (in stream index order) before completing.
    for (const [, tc] of [...toolCalls.entries()].sort((a, b) => a[0] - b[0])) {
      yield { type: 'tool_call.completed', call: assembleCall(tc) };
    }
    if (usage) yield { type: 'usage', ...usage };
    yield { type: 'completed', reason };
  }
}

function assembleCall(tc: StreamingToolCall): ToolCall {
  let args: unknown = {};
  if (tc.args.trim() !== '') {
    try {
      args = JSON.parse(tc.args);
    } catch {
      // Leave the raw string so the tool's schema validation reports a clear
      // error rather than silently succeeding on bad arguments.
      args = tc.args;
    }
  }
  return { id: tc.id || newToolCallId(), name: tc.name, arguments: args };
}

interface ChatChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}
