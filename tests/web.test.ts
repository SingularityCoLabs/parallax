import { describe, it, expect } from 'vitest';
import { createWebFetchTool } from '../src/tools/web/webFetch.ts';
import { createWebSearchTool } from '../src/tools/web/webSearch.ts';
import { assertPublicHttpUrl, htmlToText } from '../src/tools/web/http.ts';
import type { ToolExecutionContext } from '../src/tools/core/index.ts';
import { getLogger } from '../src/observability/index.ts';

function ctx(signal?: AbortSignal): ToolExecutionContext {
  return {
    callId: 'c1',
    workspaceRoot: process.cwd(),
    signal: signal ?? new AbortController().signal,
    emitStdout: () => {},
    emitStderr: () => {},
    logger: getLogger(),
  };
}

/** A fetch stub that serves canned responses by URL and records the last body. */
function fakeFetch(
  handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>,
): typeof globalThis.fetch {
  return ((input: string | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init))) as unknown as typeof globalThis.fetch;
}

const FETCH_DEPS = { timeoutMs: 1000, maxBytes: 1_000_000, maxModelChars: 16_000 };

describe('assertPublicHttpUrl (SSRF guard)', () => {
  it('accepts a public IP literal without a DNS lookup', async () => {
    const url = await assertPublicHttpUrl('http://1.1.1.1/path');
    expect(url.hostname).toBe('1.1.1.1');
  });

  it.each([
    'http://localhost/',
    'http://127.0.0.1/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://172.16.0.1/',
    'http://169.254.169.254/latest/meta-data/', // cloud metadata
    'http://[::1]/',
    'http://foo.internal/',
    'http://bar.local/',
  ])('rejects the local/private target %s', async (u) => {
    await expect(assertPublicHttpUrl(u)).rejects.toThrow(/local|private|internal|loopback/i);
  });

  it.each(['file:///etc/passwd', 'ftp://example.com/x', 'gopher://x'])(
    'rejects the non-http scheme %s',
    async (u) => {
      await expect(assertPublicHttpUrl(u)).rejects.toThrow(/scheme/i);
    },
  );
});

describe('htmlToText', () => {
  it('strips scripts/styles/tags and decodes entities', () => {
    const out = htmlToText(
      '<html><head><style>a{}</style><script>bad()</script></head><body><h1>Hi &amp; bye</h1><p>Line&nbsp;1</p></body></html>',
    );
    expect(out).not.toMatch(/bad\(\)/);
    expect(out).not.toMatch(/<[^>]+>/);
    expect(out).toMatch(/Hi & bye/);
    expect(out).toMatch(/Line 1/);
  });
});

describe('web_fetch tool', () => {
  const tool = createWebFetchTool(FETCH_DEPS);

  it('is a network-risk tool (policy gates it)', () => {
    expect(tool.risk).toBe('network');
    expect(tool.resourceClass).toBe('network');
  });

  it('fetches a page and converts HTML to text', async () => {
    const fetchImpl = fakeFetch(
      () =>
        new Response('<html><body><p>Hello world</p></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    );
    const t = createWebFetchTool({ ...FETCH_DEPS, fetchImpl });
    const res = await t.execute(ctx(), { url: 'http://1.1.1.1/' });
    expect(res.ok).toBe(true);
    expect(res.data?.content).toMatch(/Hello world/);
    expect(res.data?.content).not.toMatch(/<p>/);
  });

  it('refuses a private URL before making any request', async () => {
    let called = false;
    const fetchImpl = fakeFetch(() => {
      called = true;
      return new Response('nope');
    });
    const t = createWebFetchTool({ ...FETCH_DEPS, fetchImpl });
    const res = await t.execute(ctx(), { url: 'http://127.0.0.1/secret' });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('network_error');
    expect(called).toBe(false);
  });

  it('re-validates redirects and refuses a redirect to a private address', async () => {
    const fetchImpl = fakeFetch((url) => {
      if (url.startsWith('http://1.1.1.1')) {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/' },
        });
      }
      return new Response('should not reach here', { status: 200 });
    });
    const t = createWebFetchTool({ ...FETCH_DEPS, fetchImpl });
    const res = await t.execute(ctx(), { url: 'http://1.1.1.1/redirect' });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('network_error');
    expect(res.summary).toMatch(/private|loopback/i);
  });

  it('reports HTTP error status as a failure but keeps the body', async () => {
    const fetchImpl = fakeFetch(() => new Response('not found', { status: 404 }));
    const t = createWebFetchTool({ ...FETCH_DEPS, fetchImpl });
    const res = await t.execute(ctx(), { url: 'http://1.1.1.1/missing' });
    expect(res.ok).toBe(false);
    expect(res.data?.status).toBe(404);
  });

  it('times out when the request hangs', async () => {
    const fetchImpl = ((_input: string | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      })) as unknown as typeof globalThis.fetch;
    const t = createWebFetchTool({ ...FETCH_DEPS, timeoutMs: 10, fetchImpl });
    const res = await t.execute(ctx(), { url: 'http://1.1.1.1/slow' });
    expect(res.ok).toBe(false);
    expect(res.summary).toMatch(/timed out/i);
  });

  it('describes the action with the host for the approval prompt', async () => {
    const desc = await tool.describe!(ctx(), { url: 'https://example.com/a/b?c=d' });
    expect(desc.title).toContain('example.com');
    expect(desc.outsideWorkspace).toBe(false);
  });
});

describe('web_search tool', () => {
  const baseDeps = {
    getApiKey: () => 'test-key',
    timeoutMs: 1000,
    maxResults: 5,
    maxModelChars: 16_000,
  };

  it('is a network-risk tool', () => {
    const tool = createWebSearchTool(baseDeps);
    expect(tool.risk).toBe('network');
  });

  it('returns an answer and results from Tavily', async () => {
    const fetchImpl = fakeFetch(
      () =>
        new Response(
          JSON.stringify({
            answer: 'The answer is 42.',
            results: [
              { title: 'A', url: 'https://a.example', content: 'aaa' },
              { title: 'B', url: 'https://b.example', content: 'bbb' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const tool = createWebSearchTool({ ...baseDeps, fetchImpl });
    const res = await tool.execute(ctx(), { query: 'meaning of life' });
    expect(res.ok).toBe(true);
    expect(res.data?.answer).toMatch(/42/);
    expect(res.data?.results).toHaveLength(2);
    expect(res.modelContent).toMatch(/a\.example/);
  });

  it('fails clearly when no API key is configured', async () => {
    const tool = createWebSearchTool({ ...baseDeps, getApiKey: () => undefined });
    const res = await tool.execute(ctx(), { query: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('missing_credential');
    expect(res.summary).toMatch(/TAVILY_API_KEY/);
  });

  it('surfaces a Tavily auth error', async () => {
    const fetchImpl = fakeFetch(() => new Response('unauthorized', { status: 401 }));
    const tool = createWebSearchTool({ ...baseDeps, fetchImpl });
    const res = await tool.execute(ctx(), { query: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('network_error');
    expect(res.summary).toMatch(/401/);
  });

  it('passes the query and key in the request body', async () => {
    let sentBody: unknown;
    const fetchImpl = fakeFetch((_url, init) => {
      sentBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const tool = createWebSearchTool({ ...baseDeps, fetchImpl });
    await tool.execute(ctx(), { query: 'hello', maxResults: 3 });
    expect(sentBody).toMatchObject({ api_key: 'test-key', query: 'hello', max_results: 3 });
  });
});
