import { z } from 'zod';
import {
  ErrorCode,
  fail,
  ok,
  truncateMiddle,
  ToolExecutionError,
  type ToolDefinition,
} from '../core/index.ts';
import { assertPublicHttpUrl, fetchText, htmlToText, type FetchImpl } from './http.ts';

export interface WebFetchDeps {
  timeoutMs: number;
  /** Hard cap on bytes read from the response body. */
  maxBytes: number;
  /** Cap on characters returned to the model. */
  maxModelChars: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: FetchImpl;
}

const inputSchema = z.object({
  url: z.string().url(),
  /** Optional per-call cap on characters returned to the model. */
  maxChars: z.number().int().positive().max(200_000).optional(),
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  content: string;
  truncated: boolean;
}

/**
 * `web_fetch` (blueprint §8.4 network tool). Fetches a URL and returns readable
 * text — HTML is reduced to plain text. Risk is `network`, so the policy engine
 * ASKs in workspace mode and DENIes it in plan/read-only. All egress guardrails
 * (scheme, private-address/DNS-rebind, redirect re-validation, byte cap) live in
 * the shared `http.ts` core.
 */
export function createWebFetchTool(deps: WebFetchDeps): ToolDefinition<Input, Output> {
  return {
    name: 'web_fetch',
    description:
      'Fetch a public http(s) URL and return its content as text (HTML is converted to readable text). ' +
      'Use for reading a specific web page or API response. Local/private addresses are refused.',
    inputSchema,
    risk: 'network',
    resourceClass: 'network',
    describe(_ctx, input) {
      let host = input.url;
      try {
        host = new URL(input.url).host;
      } catch {
        /* fall back to the raw string; validation happens in execute */
      }
      return Promise.resolve({
        title: `Fetch ${host}`,
        detail: input.url,
        // Network egress is not a workspace path escape; the policy engine gates
        // it purely on the `network` risk.
        outsideWorkspace: false,
      });
    },
    async execute(ctx, input) {
      const maxChars = input.maxChars ?? deps.maxModelChars;
      try {
        await assertPublicHttpUrl(input.url);
        const res = await fetchText(input.url, {
          timeoutMs: deps.timeoutMs,
          maxBytes: deps.maxBytes,
          signal: ctx.signal,
          ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        });
        const isHtml = /html/i.test(res.contentType) || /^\s*<(!doctype|html)/i.test(res.body);
        const text = isHtml ? htmlToText(res.body) : res.body;
        const { text: bounded, truncated } = truncateMiddle(text, { maxChars });
        const output: Output = {
          url: input.url,
          finalUrl: res.finalUrl,
          status: res.status,
          contentType: res.contentType,
          content: bounded,
          truncated: truncated || res.truncated,
        };
        if (res.status >= 400) {
          return {
            ...fail(ctx.callId, ErrorCode.NetworkError, `HTTP ${res.status} for ${input.url}`),
            data: output,
            modelContent: `HTTP ${res.status}\n${bounded}`,
          };
        }
        return ok(ctx.callId, `fetched ${res.finalUrl} (${output.content.length} chars)`, output, {
          truncated: output.truncated,
          modelContent: bounded,
        });
      } catch (err) {
        if (err instanceof ToolExecutionError) {
          return fail(ctx.callId, err.code, err.message, { retryable: err.retryable });
        }
        return fail(
          ctx.callId,
          ErrorCode.NetworkError,
          err instanceof Error ? err.message : String(err),
        );
      }
    },
  };
}
