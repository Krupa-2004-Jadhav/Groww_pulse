import { describe, it, expect, vi } from "vitest";
import { TwelveDataProvider } from "../twelvedata";
import { TwelveDataRateLimiter } from "../rate-limiter";
import { ProviderRateLimitError } from "../errors";

// Sample payloads captured from a real /quote call against the live API
// during development (see conversation record) — shapes only, values
// redacted/rounded. No live HTTP call happens in this test.
const SAMPLE_MULTI_QUOTE = {
  AAPL: {
    symbol: "AAPL",
    close: "319.97000",
    open: "328.31000",
    high: "328.92999",
    low: "317.85999",
    previous_close: "328.20999",
    volume: "39551800",
    datetime: "2026-09-04",
    timestamp: 1788528600,
    last_quote_at: 1788551940,
  },
  BADTICKER: {
    code: 400,
    message: "**symbol** not found",
    status: "error",
  },
};

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers,
      })
  );
}

function freshLimiter() {
  return new TwelveDataRateLimiter(8, 800);
}

describe("TwelveDataProvider — quote mapping (Phase 1, Test Gate 1)", () => {
  it("maps a sample /quote payload to Quote[] correctly", async () => {
    const fetchImpl = fakeFetch(200, SAMPLE_MULTI_QUOTE) as unknown as typeof fetch;
    const provider = new TwelveDataProvider({ apiKey: "test-key", fetchImpl, rateLimiter: freshLimiter() });

    const quotes = await provider.getQuotes(["AAPL", "BADTICKER"]);

    // The bad ticker is skipped, not thrown — one bad symbol in a batch
    // must not fail the whole request.
    expect(quotes).toHaveLength(1);
    const [aapl] = quotes;
    expect(aapl.symbol).toBe("AAPL");
    expect(aapl.price).toBe(319.97);
    expect(aapl.dayOpen).toBe(328.31);
    expect(aapl.prevClose).toBe(328.20999);
    expect(aapl.volume).toBe(39551800);
    expect(aapl.source).toBe("twelvedata");
    // last_quote_at (1788551940) takes priority over timestamp/datetime.
    expect(aapl.asOf.getTime()).toBe(1788551940 * 1000);
  });

  it("batches all requested symbols into a single HTTP call", async () => {
    const fetchImpl = fakeFetch(200, SAMPLE_MULTI_QUOTE) as unknown as typeof fetch;
    const provider = new TwelveDataProvider({ apiKey: "test-key", fetchImpl, rateLimiter: freshLimiter() });

    await provider.getQuotes(["AAPL", "BADTICKER"]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const calledUrl = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("symbol=AAPL%2CBADTICKER");
  });

  it("a single-symbol request handles Twelve Data's flat (non-keyed) response shape", async () => {
    const fetchImpl = fakeFetch(200, SAMPLE_MULTI_QUOTE.AAPL) as unknown as typeof fetch;
    const provider = new TwelveDataProvider({ apiKey: "test-key", fetchImpl, rateLimiter: freshLimiter() });

    const [quote] = await provider.getQuotes(["AAPL"]);
    expect(quote.price).toBe(319.97);
  });

  it("maps HTTP 429 to ProviderRateLimitError", async () => {
    const fetchImpl = fakeFetch(429, {}, { "retry-after": "30" }) as unknown as typeof fetch;
    const provider = new TwelveDataProvider({ apiKey: "test-key", fetchImpl, rateLimiter: freshLimiter() });

    await expect(provider.getQuotes(["AAPL"])).rejects.toThrow(ProviderRateLimitError);
  });

  it("returns [] for an empty symbol list without making an HTTP call", async () => {
    const fetchImpl = fakeFetch(200, {}) as unknown as typeof fetch;
    const provider = new TwelveDataProvider({ apiKey: "test-key", fetchImpl, rateLimiter: freshLimiter() });

    const quotes = await provider.getQuotes([]);
    expect(quotes).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("TwelveDataRateLimiter", () => {
  it("throws when a request would exceed the daily credit budget", () => {
    const limiter = new TwelveDataRateLimiter(8, 10);
    limiter.reserveCredits(8);
    expect(() => limiter.reserveCredits(5)).toThrow(/budget/);
  });

  it("allows requests within the budget", () => {
    const limiter = new TwelveDataRateLimiter(8, 10);
    expect(() => limiter.reserveCredits(10)).not.toThrow();
  });
});
