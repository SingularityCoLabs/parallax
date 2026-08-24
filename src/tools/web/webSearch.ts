import { z } from 'zod';
import { ErrorCode, fail, ok, truncateMiddle, type ToolDefinition } from '../core/index.ts';
import type { FetchImpl } from './http.ts';

export interface WebSearchDeps {
  /**
   * Resolve the Tavily API key lazily (env `TAVILY_API_KEY`, then the on-disk
   * credentials store). A thunk — not a value — so a key entered mid-session is
   * picked up without rebuilding the toolset.
   */
  getApiKey: () => string | undefined;
  timeoutMs: number;
  maxResults: number;
  maxModelChars: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: FetchImpl;
}

const TAVILY_URL = 'https://api.tavily.com/search';

const inputSchema = z.object({
  query: z.string().min(1),
  maxResults: z.number().int().positive().max(10).optional(),
});

type Input = z.infer<typeof inputSchema>;

const tavilyResponseSchema = z.object({
  answer: z.string().optional().nullable(),
  results: z
    .array(
      z.object({
        title: z.string().optional().nullable(),
        url: z.string(),
        content: z.string().optional().nullable(),
      }),
    )
    .default([]),
});

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface Output {
  query: string;
  answer?: string;
  results: SearchResult[];
}

/** Render results as the numbered list the model reads. */
function renderResults(answer: string | undefined, results: SearchResult[]): string {
  const lines: string[] = [];
  if (answer) lines.push(`Answer: ${answer}`, '');
  results.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.title || r.url}`);
    lines.push(`   ${r.url}`);
    if (r.snippet) lines.push(`   ${r.snippet}`);
  });
  return lines.join('\n').trim() || 'No results.';
}

/**
 * `web_search` (blueprint §8.4 network tool). Queries the web via Tavily and
 * returns a synthesized answer plus ranked results. Risk is `network` (policy
 * ASKs in workspace, DENIes in plan/read-only). The endpoint is a fixed, trusted
 * host, so no SSRF guard is needed here (unlike `web_fetch`); a timeout and
 * cancellation are still honored.
 */
export function createWebSearchTool(deps: WebSearchDeps): ToolDefinition<Input, Output> {
  return {
    name: 'web_search',
    description:
      'Search the web for current information and return a short answer plus ranked results (title, URL, ' +
      'snippet). Use for facts likely outside your training data or that may have changed. Requires a ' +
      'Tavily API key (TAVILY_API_KEY).',
    inputSchema,
    risk: 'network',
    resourceClass: 'network',
    describe(_ctx, input) {
      return Promise.resolve({ title: `Web search: ${input.query}`, outsideWorkspace: false });
    },
    async execute(ctx, input) {
      const apiKey = deps.getApiKey();
      if (!apiKey) {
        return fail(
          ctx.callId,
          ErrorCode.MissingCredential,
          'Web search needs a Tavily API key. Set TAVILY_API_KEY (get one at https://tavily.com), then retry.',
        );
      }
      const doFetch = deps.fetchImpl ?? globalThis.fetch;
      const timeoutCtrl = new AbortController();
      const timer = setTimeout(() => timeoutCtrl.abort(), deps.timeoutMs);
      const signal = ctx.signal
        ? AbortSignal.any([timeoutCtrl.signal, ctx.signal])
        : timeoutCtrl.signal;
      try {
        const res = await doFetch(TAVILY_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'user-agent': 'parallax' },
          body: JSON.stringify({
            api_key: apiKey,
            query: input.query,
            max_results: input.maxResults ?? deps.maxResults,
            include_answer: true,
          }),
          signal,
        });
        if (!res.ok) {
          const detail = res.status === 401 ? ' (check TAVILY_API_KEY)' : '';
          return fail(
            ctx.callId,
            ErrorCode.NetworkError,
            `Tavily responded ${res.status}${detail}`,
          );
        }
        const parsed = tavilyResponseSchema.safeParse(await res.json());
        if (!parsed.success) {
          return fail(ctx.callId, ErrorCode.NetworkError, 'Unexpected response from Tavily');
        }
        const results: SearchResult[] = parsed.data.results.map((r) => ({
          title: r.title ?? '',
          url: r.url,
          snippet: r.content ?? '',
        }));
        const answer = parsed.data.answer ?? undefined;
        const output: Output = { query: input.query, results, ...(answer ? { answer } : {}) };
        const modelContent = truncateMiddle(renderResults(answer, results), {
          maxChars: deps.maxModelChars,
        }).text;
        return ok(
          ctx.callId,
          `searched: ${input.query} (${results.length} result${results.length === 1 ? '' : 's'})`,
          output,
          { modelContent },
        );
      } catch (err) {
        if (ctx.signal?.aborted) {
          return fail(ctx.callId, ErrorCode.Cancelled, 'Search cancelled');
        }
        if (timeoutCtrl.signal.aborted) {
          return fail(
            ctx.callId,
            ErrorCode.NetworkError,
            `Search timed out after ${deps.timeoutMs}ms`,
          );
        }
        return fail(
          ctx.callId,
          ErrorCode.NetworkError,
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
