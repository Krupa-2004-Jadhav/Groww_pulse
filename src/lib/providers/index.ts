import { MarketDataProvider, HistoricalDataProvider } from "./types";
import { ReplayProvider } from "./replay";
import { TwelveDataProvider, TwelveDataHistorical } from "./twelvedata";
import { twelveDataRateLimiter } from "./rate-limiter";

export * from "./types";
export * from "./replay";
export * from "./twelvedata";
export * from "./errors";
export { twelveDataRateLimiter } from "./rate-limiter";

/**
 * The single place that decides which MarketDataProvider backs the app —
 * every route/job asks this for a provider instead of constructing one
 * itself (plan §0.2: "nothing else in the codebase calls an HTTP finance
 * endpoint directly").
 */
export function getMarketDataProvider(): MarketDataProvider {
  const mode = (process.env.MARKET_PROVIDER ?? "replay").toLowerCase();

  if (mode === "twelvedata") {
    const apiKey = process.env.TWELVEDATA_API_KEY;
    if (!apiKey) {
      throw new Error("MARKET_PROVIDER=twelvedata requires TWELVEDATA_API_KEY to be set");
    }
    return new TwelveDataProvider({ apiKey });
  }

  return getReplaySingleton();
}

export function getHistoricalDataProvider(): HistoricalDataProvider {
  const mode = (process.env.MARKET_PROVIDER ?? "replay").toLowerCase();

  if (mode === "twelvedata") {
    const apiKey = process.env.TWELVEDATA_API_KEY;
    if (!apiKey) {
      throw new Error("MARKET_PROVIDER=twelvedata requires TWELVEDATA_API_KEY to be set");
    }
    return new TwelveDataHistorical({ apiKey });
  }

  return getReplaySingleton();
}

// The replay provider carries per-symbol tick state (it's a stateful walk,
// not a stateless lookup) so demo mode and dev-mode both need ONE shared
// instance across requests, not a fresh one per call.
let replaySingleton: ReplayProvider | null = null;
function getReplaySingleton(): ReplayProvider {
  if (!replaySingleton) {
    replaySingleton = new ReplayProvider({ seed: process.env.REPLAY_SEED ?? "pulse-demo" });
  }
  return replaySingleton;
}

export function providerHealthStatus() {
  const mode = (process.env.MARKET_PROVIDER ?? "replay").toLowerCase();
  return {
    provider: mode,
    rateLimiter: mode === "twelvedata" ? twelveDataRateLimiter.status() : null,
  };
}
