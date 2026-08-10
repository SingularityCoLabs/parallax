/** Rough token estimate (blueprint §20.1). ~4 chars/token is good enough for
 * budgeting until a real tokenizer is wired per provider. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
