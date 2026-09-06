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
import { ProviderRateLimitError, ProviderHttpError } from "./errors";
import { TwelveDataRateLimiter, twelveDataRateLimiter } from "./rate-limiter";

type FetchImpl = typeof fetch;

interface TwelveDataOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchImpl;
  rateLimiter?: TwelveDataRateLimiter;
}

interface RawQuote {
  symbol?: string;
  close?: string;
  open?: string;
  high?: string;
  low?: string;
  previous_close?: string;
  volume?: string;
  datetime?: string;
  timestamp?: number;
  last_quote_at?: number;
  status?: string;
  code?: number;
  message?: string;
}

/**
 * Live quotes via Twelve Data's /quote endpoint, batched as one HTTP
 * request per poll (symbols joined with commas) — this is what keeps a
 * 12-symbol universe under the 8 req/min ceiling regardless of how many
 * credits it costs (plan §1: "poll the deduplicated union... never per-user").
 */
export class TwelveDataProvider implements MarketDataProvider {
  readonly name = "twelvedata";

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchImpl;
  private readonly rateLimiter: TwelveDataRateLimiter;

  constructor(opts: TwelveDataOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? "https://api.twelvedata.com";
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.rateLimiter = opts.rateLimiter ?? twelveDataRateLimiter;
  }

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    if (symbols.length === 0) return [];

    await this.rateLimiter.waitForSlot();
    this.rateLimiter.reserveCredits(symbols.length);

    const url = `${this.baseUrl}/quote?symbol=${encodeURIComponent(symbols.join(","))}&apikey=${this.apiKey}`;
    const res = await this.fetchImpl(url);

    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after");
      throw new ProviderRateLimitError(this.name, retryAfter ? Number(retryAfter) * 1000 : undefined);
    }
    if (!res.ok) {
      throw new ProviderHttpError(this.name, res.status, await safeText(res));
    }

    const json = (await res.json()) as Record<string, RawQuote> | RawQuote;
    return mapQuotes(symbols, json, this.name);
  }
}

function mapQuotes(symbols: string[], json: Record<string, RawQuote> | RawQuote, source: string): Quote[] {
  const isMulti = symbols.length > 1;
  const entries: [string, RawQuote | undefined][] = isMulti
    ? symbols.map((s) => [s, (json as Record<string, RawQuote>)[s]])
    : [[symbols[0], json as RawQuote]];

  const quotes: Quote[] = [];
  for (const [symbol, data] of entries) {
    // A symbol-level error (bad ticker, no data) is skipped, not thrown —
    // one bad symbol in a 12-symbol batch must not take down the other 11.
    if (!data || data.status === "error" || data.code) continue;
    const price = numOrUndef(data.close);
    if (price === undefined) continue;

    quotes.push({
      symbol,
      price,
      dayOpen: numOrUndef(data.open),
      dayHigh: numOrUndef(data.high),
      dayLow: numOrUndef(data.low),
      prevClose: numOrUndef(data.previous_close),
      volume: numOrUndef(data.volume),
      asOf: resolveAsOf(data),
      source,
    });
  }
  return quotes;
}

function resolveAsOf(data: RawQuote): Date {
  if (data.last_quote_at) return new Date(data.last_quote_at * 1000);
  if (data.timestamp) return new Date(data.timestamp * 1000);
  if (data.datetime) return new Date(`${data.datetime}T00:00:00Z`);
  return new Date();
}

function numOrUndef(v: string | undefined): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

async function safeText(res: Response): Promise<string | undefined> {
  try {
    return await res.text();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------
// Historical / reference data — fetched once at seed time (Phase 3), never
// polled. Deliberately a separate class from TwelveDataProvider so the
// one-shot seed call pattern can't accidentally get looped into the live
// poller.
// ---------------------------------------------------------------------

interface RawBar {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

interface RawSplit {
  date: string;
  description: string;
  from_factor: number;
  to_factor: number;
}

interface RawDividend {
  ex_date: string;
  amount: number;
}

interface RawEarnings {
  date: string;
  eps_estimate: number | null;
  eps_actual: number | null;
  surprise_prc: number | null;
}

interface RawSymbolSearchResult {
  symbol: string;
  instrument_name: string;
  exchange: string;
  country: string;
}

export class TwelveDataHistorical implements HistoricalDataProvider {
  readonly name = "twelvedata";

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchImpl;
  private readonly rateLimiter: TwelveDataRateLimiter;

  constructor(opts: TwelveDataOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? "https://api.twelvedata.com";
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.rateLimiter = opts.rateLimiter ?? twelveDataRateLimiter;
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    await this.rateLimiter.waitForSlot();
    this.rateLimiter.reserveCredits(1);

    const query = new URLSearchParams({ ...params, apikey: this.apiKey });
    const res = await this.fetchImpl(`${this.baseUrl}${path}?${query.toString()}`);

    if (res.status === 429) throw new ProviderRateLimitError(this.name);
    if (!res.ok) throw new ProviderHttpError(this.name, res.status, await safeText(res));
    return (await res.json()) as T;
  }

  async getDailyBars(symbol: string, outputsize = 260): Promise<HistoricalBar[]> {
    const json = await this.get<{ values?: RawBar[]; status: string; message?: string }>("/time_series", {
      symbol,
      interval: "1day",
      outputsize: String(outputsize),
    });
    if (json.status === "error" || !json.values) return [];

    // Twelve Data returns newest-first; store chronologically (oldest first)
    // to match ReplayProvider and simplify rollup math downstream.
    return [...json.values].reverse().map((v) => ({
      symbol,
      date: new Date(`${v.datetime}T00:00:00Z`),
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
      volume: Number(v.volume),
    }));
  }

  async getSplits(symbol: string): Promise<SplitEvent[]> {
    const json = await this.get<{ splits?: RawSplit[] }>("/splits", { symbol });
    return (json.splits ?? []).map((s) => ({
      symbol,
      date: new Date(`${s.date}T00:00:00Z`),
      fromFactor: s.from_factor,
      toFactor: s.to_factor,
      description: s.description,
    }));
  }

  async getDividends(symbol: string): Promise<DividendEvent[]> {
    const json = await this.get<{ dividends?: RawDividend[] }>("/dividends", { symbol });
    return (json.dividends ?? []).map((d) => ({
      symbol,
      exDate: new Date(`${d.ex_date}T00:00:00Z`),
      amount: d.amount,
    }));
  }

  async getEarnings(symbol: string): Promise<EarningsEvent[]> {
    const json = await this.get<{ earnings?: RawEarnings[] }>("/earnings", { symbol });
    return (json.earnings ?? []).map((e) => ({
      symbol,
      date: new Date(`${e.date}T00:00:00Z`),
      epsEstimate: e.eps_estimate,
      epsActual: e.eps_actual,
      surprisePct: e.surprise_prc,
    }));
  }

  async searchSymbols(query: string): Promise<SymbolSearchResult[]> {
    const json = await this.get<{ data?: RawSymbolSearchResult[] }>("/symbol_search", { symbol: query });
    return (json.data ?? [])
      .filter((r) => r.country === "United States")
      .map((r) => ({ symbol: r.symbol, name: r.instrument_name, exchange: r.exchange, country: r.country }));
  }
}
