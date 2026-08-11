/**
 * Shared provider error + HTTP helpers (blueprint §11, §25). Both the
 * OpenAI-compatible and Anthropic adapters surface non-2xx responses the same
 * way, so the error type lives here rather than inside one adapter.
 */

export class ProviderHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ProviderHttpError';
    this.status = status;
  }
}

/** Read up to 500 chars of an error body without throwing. */
export async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '<no body>';
  }
}
