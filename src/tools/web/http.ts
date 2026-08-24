import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { ErrorCode, ToolExecutionError } from '../core/index.ts';

/**
 * Shared HTTP core for the network tools (`web_fetch`, `web_search`), with the
 * egress guardrails those tools must not skip (blueprint Principle 1 — the model
 * proposes a URL, the runtime decides what is reachable). Everything here is
 * dependency-free and uses the global `fetch` (Node ≥22), matching
 * `config/modelsDev.ts`.
 *
 * SSRF posture: only `http`/`https`, and never a host that resolves to a
 * loopback / private / link-local address — which blocks `localhost`, RFC1918
 * ranges, and the cloud metadata endpoint (169.254.169.254). DNS is resolved and
 * *every* answer checked, so a public name that points at a private IP (DNS
 * rebinding) is refused too, and redirects are followed manually with the same
 * check re-applied at each hop.
 */

export type FetchImpl = typeof globalThis.fetch;

export interface FetchTextOptions {
  timeoutMs: number;
  maxBytes: number;
  signal?: AbortSignal | undefined;
  fetchImpl?: FetchImpl | undefined;
  /** Extra request headers (e.g. a User-Agent). */
  headers?: Record<string, string> | undefined;
}

export interface FetchTextResult {
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
  truncated: boolean;
}

const MAX_REDIRECTS = 5;

function netError(message: string): ToolExecutionError {
  return new ToolExecutionError(ErrorCode.NetworkError, message, false);
}

/** Parse an IPv4 dotted-quad to a 32-bit unsigned int, or `undefined`. */
function ipv4ToInt(ip: string): number | undefined {
  const parts = ip.split('.');
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const n = Number(part);
    if (n > 255) return undefined;
    value = value * 256 + n;
  }
  return value >>> 0;
}

/** True for loopback / private / link-local / reserved IPv4 addresses. */
function isPrivateIPv4(ip: string): boolean {
  const v = ipv4ToInt(ip);
  if (v === undefined) return true; // unparseable → treat as unsafe
  const inRange = (base: string, maskBits: number): boolean => {
    const b = ipv4ToInt(base)!;
    const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
    return (v & mask) === (b & mask);
  };
  return (
    inRange('0.0.0.0', 8) || // "this" network
    inRange('10.0.0.0', 8) || // private
    inRange('100.64.0.0', 10) || // carrier-grade NAT
    inRange('127.0.0.0', 8) || // loopback
    inRange('169.254.0.0', 16) || // link-local + cloud metadata (169.254.169.254)
    inRange('172.16.0.0', 12) || // private
    inRange('192.0.0.0', 24) || // IETF protocol assignments
    inRange('192.168.0.0', 16) || // private
    inRange('198.18.0.0', 15) || // benchmarking
    inRange('224.0.0.0', 4) || // multicast
    inRange('240.0.0.0', 4) // reserved / broadcast
  );
}

/** True for loopback / unique-local / link-local / multicast IPv6 addresses. */
function isPrivateIPv6(ip: string): boolean {
  const addr = ip.toLowerCase();
  if (addr === '::1' || addr === '::') return true;
  // IPv4-mapped (::ffff:a.b.c.d) — defer to the IPv4 check.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mapped) return isPrivateIPv4(mapped[1]!);
  const head = addr.split(':')[0] ?? '';
  const first = parseInt(head || '0', 16);
  if (Number.isNaN(first)) return true;
  if (first >= 0xfc00 && first <= 0xfdff) return true; // fc00::/7 unique-local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

function isPrivateAddress(ip: string): boolean {
  return isIP(ip) === 6 ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

/**
 * Validate a URL for outbound fetching and return the parsed `URL`, or throw a
 * `NetworkError`. Rejects non-HTTP(S) schemes and any host that is — or resolves
 * to — a non-public address.
 */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw netError(`Invalid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw netError(`Unsupported URL scheme "${url.protocol}" (only http/https)`);
  }
  const host = url.hostname.toLowerCase();
  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) {
    throw netError(`Refusing to fetch a local address: ${url.hostname}`);
  }
  if (host.endsWith('.local') || host.endsWith('.internal')) {
    throw netError(`Refusing to fetch an internal address: ${url.hostname}`);
  }
  // IPv6 literals arrive bracketed from `URL.hostname` (e.g. "[::1]"); strip the
  // brackets so `isIP`/the range checks see the bare address.
  const ipHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (isIP(ipHost)) {
    if (isPrivateAddress(ipHost)) {
      throw netError(`Refusing to fetch a private/loopback address: ${url.hostname}`);
    }
    return url;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw netError(`Could not resolve host: ${url.hostname}`);
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw netError(`Host resolves to a private/loopback address: ${url.hostname}`);
  }
  return url;
}

/** Read a response body as UTF-8, stopping once `maxBytes` is reached. */
async function readCapped(
  res: Response,
  maxBytes: number,
): Promise<{ body: string; truncated: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) return { body: '', truncated: false };
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (total + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, Math.max(0, maxBytes - total)));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  return { body: Buffer.concat(chunks).toString('utf8'), truncated };
}

/**
 * Fetch a URL as text with a timeout, a byte cap, and manual redirect following
 * (re-validating every hop with `assertPublicHttpUrl`). Honors an external abort
 * signal (turn cancellation) distinctly from the timeout.
 */
export async function fetchText(raw: string, options: FetchTextOptions): Promise<FetchTextResult> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  let current = await assertPublicHttpUrl(raw);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const timeoutCtrl = new AbortController();
    const timer = setTimeout(() => timeoutCtrl.abort(), options.timeoutMs);
    const signals: AbortSignal[] = [timeoutCtrl.signal];
    if (options.signal) signals.push(options.signal);
    const signal = signals.length === 1 ? signals[0]! : AbortSignal.any(signals);

    let res: Response;
    try {
      res = await doFetch(current, {
        redirect: 'manual',
        signal,
        headers: { 'user-agent': 'parallax', ...(options.headers ?? {}) },
      });
    } catch (err) {
      if (options.signal?.aborted) {
        throw new ToolExecutionError(ErrorCode.Cancelled, 'Request cancelled', false);
      }
      if (timeoutCtrl.signal.aborted) {
        throw netError(`Request timed out after ${options.timeoutMs}ms: ${current.toString()}`);
      }
      throw netError(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }

    // Manual redirect handling (undici exposes the 3xx + Location).
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) break; // 3xx without a target — treat as final
      if (hop === MAX_REDIRECTS) throw netError(`Too many redirects: ${raw}`);
      current = await assertPublicHttpUrl(new URL(location, current).toString());
      continue;
    }

    const { body, truncated } = await readCapped(res, options.maxBytes);
    return {
      finalUrl: current.toString(),
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      body,
      truncated,
    };
  }
  throw netError(`Too many redirects: ${raw}`);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' ',
};

/** Decode the handful of HTML entities that survive tag-stripping. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Reduce an HTML document to readable plain text — dependency-free and lossy by
 * design (this feeds a language model, not a browser). Drops script/style,
 * turns block boundaries into newlines, strips remaining tags, decodes entities,
 * and collapses runaway whitespace.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
      .replace(/<\/(p|div|section|article|li|tr|h[1-6]|header|footer)>/gi, '\n')
      .replace(/<(br|hr)\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim();
}
