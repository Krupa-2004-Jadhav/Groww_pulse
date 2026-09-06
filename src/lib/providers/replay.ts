import {
  MarketDataProvider,
  HistoricalDataProvider,
  Quote,
  HistoricalBar,
  SplitEvent,
  DividendEvent,
  EarningsEvent,
  SymbolSearchResult,
} from "./types";

export type ScriptedEvent =
  | { type: "gap"; symbol: string; atTick: number; pct: number }
  | { type: "spike"; symbol: string; atTick: number; pct: number }
  | { type: "split"; symbol: string; atTick: number; fromFactor: number; toFactor: number }
  | { type: "volume-surge"; symbol: string; atTick: number; multiplier: number }
  | { type: "feed-outage"; symbol: string; fromTick: number; toTick: number }
  | { type: "duplicate-tick"; symbol: string; atTick: number }
  | { type: "out-of-order-tick"; symbol: string; atTick: number; asOfOffsetMs: number };

interface ReplayProviderOptions {
  seed: string;
  script?: ScriptedEvent[];
  /** ms advanced per tick; defaults to 10s, matching the plan's market-open poll cadence. */
  tickIntervalMs?: number;
  /** Anchor wall-clock time for tick 0; defaults to now. Fix this in tests for reproducible asOf values. */
  startTime?: Date;
}

const BASE_PRICE_MIN = 20;
const BASE_PRICE_RANGE = 480;
const STEP_VOLATILITY = 0.015; // ~1.5% per tick — deliberately punchy so a short demo shows movement
const DEFAULT_DAILY_OUTPUTSIZE = 260; // matches getDailyBars' default and historical-seed.ts's default — kept as one constant so the two can't silently drift apart

/** FNV-1a → murmur fmix32 finalizer. Cheap, deterministic, well-distributed. Not cryptographic — doesn't need to be. */
function seededUnit(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function stepReturn(seed: string, symbol: string, tick: number): number {
  return (seededUnit(`${seed}:${symbol}:step:${tick}`) - 0.5) * 2 * STEP_VOLATILITY;
}

function basePrice(seed: string, symbol: string): number {
  return BASE_PRICE_MIN + seededUnit(`${seed}:${symbol}:base`) * BASE_PRICE_RANGE;
}

function baseVolume(seed: string, symbol: string): number {
  return 500_000 + seededUnit(`${seed}:${symbol}:vol`) * 4_500_000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export class ProviderOutageError extends Error {
  constructor(
    public readonly symbol: string,
    public readonly provider: string
  ) {
    super(`${provider} feed outage for ${symbol}`);
    this.name = "ProviderOutageError";
  }
}

/**
 * Deterministic seeded random walk + scripted event injection (plan §0.1,
 * §1). Every price/volume is a pure function of (seed, symbol, tick) — two
 * ReplayProviders with the same seed produce byte-identical sequences
 * regardless of process/call order, which is what Test Gate 1 checks.
 *
 * Used in ALL automated tests and as the demo-mode market source
 * (MARKET_PROVIDER=replay) — never a substitute for real data outside those
 * two contexts. `source: "replay"` on every emitted Quote/bar labels it as
 * simulated, per plan §0.1's requirement that synthetic data always be
 * clearly marked.
 */
export class ReplayProvider implements MarketDataProvider, HistoricalDataProvider {
  readonly name = "replay";

  private readonly seed: string;
  private readonly script: ScriptedEvent[];
  private readonly tickIntervalMs: number;
  private readonly startTime: number;
  private readonly tickCounters = new Map<string, number>();

  constructor(opts: ReplayProviderOptions) {
    this.seed = opts.seed;
    this.script = opts.script ?? [];
    this.tickIntervalMs = opts.tickIntervalMs ?? 10_000;
    this.startTime = (opts.startTime ?? new Date()).getTime();
  }

  /**
   * The live-quote walk's starting price: the LAST close of the historical
   * daily walk (`${symbol}:daily` key), not an independent basePrice().
   * Without this, the live and historical series are uncorrelated, and a
   * symbol's first live quote can drift arbitrarily far from its own
   * seeded "previous close" — producing nonsense like a fabricated
   * 40-sigma "crash" the moment a symbol is added. Caught live against the
   * running dev server, not assumed — see conversation record.
   */
  private liveAnchor(symbol: string): number {
    return this.priceAtTick(`${symbol}:daily`, DEFAULT_DAILY_OUTPUTSIZE - 1);
  }

  private priceAtTick(symbol: string, tick: number): number {
    const isDailyKey = symbol.endsWith(":daily");
    let price = isDailyKey ? basePrice(this.seed, symbol) : this.liveAnchor(symbol);

    for (let t = 0; t <= tick; t++) {
      price *= 1 + stepReturn(this.seed, symbol, t);
      for (const evt of this.script) {
        if (evt.symbol !== symbol || !("atTick" in evt) || evt.atTick !== t) continue;
        if (evt.type === "gap" || evt.type === "spike") price *= 1 + evt.pct;
        if (evt.type === "split") price *= evt.toFactor / evt.fromFactor;
      }
    }
    return Math.max(0.01, price);
  }

  /** Product of any scripted 'gap' events' (1+pct) at this exact tick — a gap is an at-the-open, single-tick phenomenon, unlike 'spike' which folds into the ongoing walk via priceAtTick. */
  private gapFactorAtTick(symbol: string, tick: number): number {
    let factor = 1;
    for (const evt of this.script) {
      if (evt.symbol === symbol && evt.type === "gap" && evt.atTick === tick) {
        factor *= 1 + evt.pct;
      }
    }
    return factor;
  }

  private volumeAtTick(symbol: string, tick: number): number {
    let volume = baseVolume(this.seed, symbol) * (0.7 + seededUnit(`${this.seed}:${symbol}:volnoise:${tick}`) * 0.6);
    for (const evt of this.script) {
      if (evt.type === "volume-surge" && evt.symbol === symbol && evt.atTick === tick) {
        volume *= evt.multiplier;
      }
    }
    return Math.round(volume);
  }

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    const quotes: Quote[] = [];

    for (const symbol of symbols) {
      // The tick always advances, outage or not — an outage means THIS
      // call has no data, not that time stopped. (An earlier version froze
      // the counter mid-outage, which meant the "pending" tick could never
      // reach `toTick` and the outage never actually ended — caught by the
      // Phase 10 demo scenario test, not assumed.)
      const tick = (this.tickCounters.get(symbol) ?? -1) + 1;
      this.tickCounters.set(symbol, tick);

      const outage = this.script.find(
        (e): e is Extract<ScriptedEvent, { type: "feed-outage" }> =>
          e.type === "feed-outage" && e.symbol === symbol && tick >= e.fromTick && tick < e.toTick
      );
      if (outage) {
        throw new ProviderOutageError(symbol, this.name);
      }

      const price = this.priceAtTick(symbol, tick);
      // tick 0's "previous close" is the continuity anchor itself (the
      // historical series' last close) — using `price` here (as an earlier
      // version did) would make dayOpen/prevClose both equal the
      // POST-gap/spike price on the very first live tick, silently hiding
      // any scripted gap from ever being observable in the OHLC fields.
      const prevPrice = tick === 0 ? this.liveAnchor(symbol) : this.priceAtTick(symbol, tick - 1);
      // dayOpen carries any scripted gap independently of prevClose — real
      // OHLC data lets an open differ from the prior close; a Quote model
      // where they're always equal (an earlier version of this file) makes
      // a "gap" signal structurally undetectable, since gap = (open -
      // prevClose) / prevClose is definitionally 0 when open == prevClose.
      const dayOpen = prevPrice * this.gapFactorAtTick(symbol, tick);
      const volume = this.volumeAtTick(symbol, tick);

      let asOf = new Date(this.startTime + tick * this.tickIntervalMs);

      if (this.script.some((e) => e.type === "duplicate-tick" && e.symbol === symbol && e.atTick === tick)) {
        // Repeats the previous tick's timestamp — exercises idempotent-write handling downstream.
        asOf = new Date(this.startTime + Math.max(0, tick - 1) * this.tickIntervalMs);
      }
      const outOfOrder = this.script.find(
        (e): e is Extract<ScriptedEvent, { type: "out-of-order-tick" }> =>
          e.type === "out-of-order-tick" && e.symbol === symbol && e.atTick === tick
      );
      if (outOfOrder) {
        asOf = new Date(asOf.getTime() + outOfOrder.asOfOffsetMs);
      }

      quotes.push({
        symbol,
        price: round2(price),
        dayOpen: round2(dayOpen),
        dayHigh: round2(Math.max(price, dayOpen, prevPrice) * 1.002),
        dayLow: round2(Math.min(price, dayOpen, prevPrice) * 0.998),
        prevClose: round2(prevPrice),
        volume,
        asOf,
        source: this.name,
      });
    }

    return quotes;
  }

  // ---- HistoricalDataProvider ----
  // Uses a separate namespace (`${symbol}:daily`) from the live-quote walk
  // above so seeding history and polling live quotes never share state.

  async getDailyBars(symbol: string, outputsize = DEFAULT_DAILY_OUTPUTSIZE): Promise<HistoricalBar[]> {
    const key = `${symbol}:daily`;
    const bars: HistoricalBar[] = [];
    const today = new Date(this.startTime);

    // Oldest first: tick 0 is `outputsize - 1` calendar days ago.
    for (let daysAgo = outputsize - 1; daysAgo >= 0; daysAgo--) {
      const tick = outputsize - 1 - daysAgo;
      const price = this.priceAtTick(key, tick);
      const prevPrice = tick === 0 ? price : this.priceAtTick(key, tick - 1);
      const date = new Date(today);
      date.setUTCDate(date.getUTCDate() - daysAgo);
      date.setUTCHours(0, 0, 0, 0);

      bars.push({
        symbol,
        date,
        open: round2(prevPrice),
        high: round2(Math.max(price, prevPrice) * 1.004),
        low: round2(Math.min(price, prevPrice) * 0.996),
        close: round2(price),
        volume: this.volumeAtTick(key, tick),
      });
    }

    return bars;
  }

  async getSplits(symbol: string): Promise<SplitEvent[]> {
    const key = `${symbol}:daily`;
    return this.script
      .filter((e): e is Extract<ScriptedEvent, { type: "split" }> => e.type === "split" && e.symbol === key)
      .map((e) => ({
        symbol,
        date: new Date(this.startTime + e.atTick * this.tickIntervalMs),
        fromFactor: e.fromFactor,
        toFactor: e.toFactor,
        description: `${e.fromFactor}-for-${e.toFactor} split (simulated)`,
      }));
  }

  async getDividends(): Promise<DividendEvent[]> {
    return [];
  }

  async getEarnings(): Promise<EarningsEvent[]> {
    return [];
  }

  async searchSymbols(query: string): Promise<SymbolSearchResult[]> {
    const upper = query.toUpperCase();
    return REPLAY_UNIVERSE.filter((s) => s.symbol.includes(upper) || s.name.toUpperCase().includes(upper));
  }
}

const REPLAY_UNIVERSE: SymbolSearchResult[] = [
  { symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", country: "US" },
  { symbol: "MSFT", name: "Microsoft Corporation", exchange: "NASDAQ", country: "US" },
  { symbol: "TSLA", name: "Tesla, Inc.", exchange: "NASDAQ", country: "US" },
  { symbol: "NVDA", name: "NVIDIA Corporation", exchange: "NASDAQ", country: "US" },
  { symbol: "AMZN", name: "Amazon.com, Inc.", exchange: "NASDAQ", country: "US" },
  { symbol: "GOOGL", name: "Alphabet Inc.", exchange: "NASDAQ", country: "US" },
  { symbol: "META", name: "Meta Platforms, Inc.", exchange: "NASDAQ", country: "US" },
  { symbol: "JPM", name: "JPMorgan Chase & Co.", exchange: "NYSE", country: "US" },
];
