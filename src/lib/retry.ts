export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Thrown by provider adapters. `kind` drives retry and billing decisions. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public kind:
      | "rejected" // provider refused the request: definitely not started
      | "uncertain" // may have been accepted: could be billed
      | "transient" // safe-to-retry read failure (network, 5xx, 429)
      | "fatal", // read failure that retrying will not fix (401/403/404)
    public status?: number,
    public retryAfterMs?: number,
  ) {
    super(message);
  }
}

/**
 * Retry READ operations (polling, downloads, model lists) with exponential
 * backoff. Never use this around a generation submission: it could duplicate
 * charges.
 */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  opts: { tries: number; baseMs: number; sleep: Sleep },
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < opts.tries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable =
        err instanceof ProviderError && err.kind === "transient";
      if (!retryable || attempt === opts.tries - 1) break;
      const wait = Math.max(
        (err as ProviderError).retryAfterMs ?? 0,
        opts.baseMs * 2 ** attempt,
      );
      await opts.sleep(wait);
    }
  }
  throw lastErr;
}
