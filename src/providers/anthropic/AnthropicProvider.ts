import { newToolCallId, type ToolCall } from '../../protocol/index.ts';
import type { ModelEvent } from '../ModelEvent.ts';
import type { ModelRequest } from '../ModelRequest.ts';
import type { ModelCapabilities, ModelProvider } from '../ModelProvider.ts';
import { ProviderHttpError, redactSecrets, safeText } from '../errors.ts';
import { parseSseStream } from '../openai/sse.ts';
import { toMessagesRequest } from './messagesRequest.ts';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface AnthropicOptions {
  /** Provider label surfaced in events/sessions (usually "anthropic"). */
  name: string;
  /** Base URL, e.g. https://api.anthropic.com/v1 (no trailing slash needed). */
  baseUrl: string;
  apiKey: string;
  /** Required by Anthropic; defaults to 16k if not supplied. */
  maxTokens?: number;
  /** Anthropic API version header. */
  anthropicVersion?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: FetchLike;
}

interface StreamingToolCall {
  id: string;
  name: string;
  json: string;
}

const DEFAULT_MAX_TOKENS = 16_000;
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';

/**
 * A native Anthropic `/v1/messages` provider (blueprint §11). Anthropic is not
 * OpenAI-wire-compatible — different endpoint, `x-api-key` auth, and content
 * blocks for tool use/results — so it gets its own adapter. It still emits the
 * runtime's normalized `ModelEvent`s, so the turn loop is unchanged whether the
 * model is Claude, an OpenAI-compatible endpoint, or the fake provider.
 *
 * Streaming reuses the shared SSE line parser: Anthropic frames each event as a
 * `data: {json}` line whose payload carries its own `type`, so we dispatch on
 * that. No sampling or `thinking` parameters are sent, which keeps the adapter
 * valid across every current Claude model (Opus 4.8 rejects those fields).
 */
export class AnthropicProvider implements ModelProvider {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly maxTokens: number;
  private readonly anthropicVersion: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: AnthropicOptions) {
    this.name = options.name;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.anthropicVersion = options.anthropicVersion ?? DEFAULT_ANTHROPIC_VERSION;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  getCapabilities(_model: string): Promise<ModelCapabilities> {
    return Promise.resolve({
      streaming: true,
      nativeToolCalls: true,
      parallelToolCalls: true,
      vision: true,
      reasoningControls: true,
    });
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    const body = toMessagesRequest(request, { maxTokens: this.maxTokens });

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'x-api-key': this.apiKey,
          'anthropic-version': this.anthropicVersion,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      const msg = redactSecrets(err instanceof Error ? err.message : String(err), this.apiKey);
      throw new ProviderHttpError(0, `${this.name} request failed: ${msg}`);
    }

    if (!res.ok) {
      const detail = await safeText(res);
      throw new ProviderHttpError(res.status, `${this.name} API error ${res.status}: ${detail}`);
    }
    if (!res.body) {
      throw new ProviderHttpError(res.status, `${this.name} API returned no response body`);
    }

    // Tool-use blocks are addressed by their content-block index across deltas.
    const toolCalls = new Map<number, StreamingToolCall>();
    let reason = 'stop';
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;

    const reader = res.body.getReader();
    for await (const payload of parseSseStream(reader, signal)) {
      let event: AnthropicStreamEvent;
      try {
        event = JSON.parse(payload) as AnthropicStreamEvent;
      } catch {
        continue; // ignore malformed / keep-alive frames
      }

      switch (event.type) {
        case 'message_start':
          if (typeof event.message?.usage?.input_tokens === 'number') {
            inputTokens = event.message.usage.input_tokens;
          }
          break;
        case 'content_block_start':
          if (event.content_block?.type === 'tool_use' && typeof event.index === 'number') {
            toolCalls.set(event.index, {
              id: event.content_block.id ?? '',
              name: event.content_block.name ?? '',
              json: '',
            });
          }
          break;
        case 'content_block_delta': {
          const delta = event.delta;
          if (delta?.type === 'text_delta' && delta.text) {
            yield { type: 'text.delta', text: delta.text };
          } else if (
            delta?.type === 'input_json_delta' &&
            typeof event.index === 'number' &&
            delta.partial_json
          ) {
            const entry = toolCalls.get(event.index);
            if (entry) entry.json += delta.partial_json;
          }
          // thinking_delta and other block types are intentionally ignored.
          break;
        }
        case 'message_delta':
          if (event.delta?.stop_reason) reason = event.delta.stop_reason;
          if (typeof event.usage?.output_tokens === 'number') {
            outputTokens = event.usage.output_tokens;
          }
          break;
        case 'message_stop':
          // Terminal frame; the loop ends when the stream closes.
          break;
      }
    }

    // Emit assembled tool calls (in content-block index order) before completing.
    for (const [, tc] of [...toolCalls.entries()].sort((a, b) => a[0] - b[0])) {
      yield { type: 'tool_call.completed', call: assembleCall(tc) };
    }
    if (inputTokens !== undefined || outputTokens !== undefined) {
      yield {
        type: 'usage',
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
      };
    }
    yield { type: 'completed', reason: normalizeReason(reason) };
  }
}

function assembleCall(tc: StreamingToolCall): ToolCall {
  let args: unknown = {};
  if (tc.json.trim() !== '') {
    try {
      args = JSON.parse(tc.json);
    } catch {
      // Leave the raw string so the tool's schema validation reports a clear
      // error rather than silently succeeding on bad arguments.
      args = tc.json;
    }
  }
  return { id: tc.id || newToolCallId(), name: tc.name, arguments: args };
}

/** Map Anthropic stop reasons to the runtime's vocabulary (tool_use vs stop). */
function normalizeReason(reason: string): string {
  return reason === 'tool_use' ? 'tool_use' : reason;
}

interface AnthropicStreamEvent {
  type: string;
  index?: number;
  message?: { usage?: { input_tokens?: number } };
  content_block?: { type?: string; id?: string; name?: string };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  usage?: { output_tokens?: number };
}
