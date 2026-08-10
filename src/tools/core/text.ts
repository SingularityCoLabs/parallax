/**
 * Bounded text truncation (blueprint §20.1, §25.2). A dependency-free utility
 * used by both tools (to bound output) and the context builder (to bound the
 * model-visible view), so it lives in the low-level `tools/core`. Keeps head and
 * tail so the model sees both the start and the (usually most relevant) end.
 */
export interface TruncateOptions {
  maxChars: number;
  /** Fraction of the budget kept from the tail (0..1). Default 0.3. */
  tailFraction?: number;
}

export interface TruncateResult {
  text: string;
  truncated: boolean;
  originalLength: number;
}

export function truncateMiddle(input: string, options: TruncateOptions): TruncateResult {
  const { maxChars } = options;
  if (input.length <= maxChars) {
    return { text: input, truncated: false, originalLength: input.length };
  }
  const tailFraction = options.tailFraction ?? 0.3;
  const marker = '\n… [truncated] …\n';
  const budget = Math.max(0, maxChars - marker.length);
  const tail = Math.floor(budget * tailFraction);
  const head = budget - tail;
  const text = input.slice(0, head) + marker + input.slice(input.length - tail);
  return { text, truncated: true, originalLength: input.length };
}
