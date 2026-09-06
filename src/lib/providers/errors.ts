/** Shared provider error taxonomy — the ingest worker (Phase 2) branches on these to decide backoff vs. hard failure. */

export class ProviderRateLimitError extends Error {
  constructor(
    public readonly provider: string,
    public readonly retryAfterMs?: number
  ) {
    super(`${provider} rate limited${retryAfterMs ? ` (retry after ${retryAfterMs}ms)` : ""}`);
    this.name = "ProviderRateLimitError";
  }
}

export class ProviderHttpError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status: number,
    public readonly body?: string
  ) {
    super(`${provider} HTTP ${status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    this.name = "ProviderHttpError";
  }
}
