/**
 * The one interface all market data flows through (plan §0.2). Nothing
 * outside `lib/providers/*` may call an HTTP finance endpoint directly —
 * grep for `fetch(` or `axios` outside this directory as a lint-by-hand
 * check if that invariant is ever in doubt.
 */

export interface Quote {
  symbol: string;
  price: number;
  dayOpen?: number;
  dayHigh?: number;
  dayLow?: number;
  prevClose?: number;
  volume?: number;
  asOf: Date; // when the price happened, per the provider
  source: string;
}

export interface MarketDataProvider {
  readonly name: string;
  getQuotes(symbols: string[]): Promise<Quote[]>;
}

/** One day's OHLCV bar, pre-adjustment. Adjustment factor is applied by the caller. */
export interface HistoricalBar {
  symbol: string;
  date: Date; // calendar date, no time component
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SplitEvent {
  symbol: string;
  date: Date;
  fromFactor: number;
  toFactor: number;
  description: string;
}

export interface DividendEvent {
  symbol: string;
  exDate: Date;
  amount: number;
}

export interface EarningsEvent {
  symbol: string;
  date: Date;
  epsEstimate: number | null;
  epsActual: number | null;
  surprisePct: number | null;
}

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  country: string;
}

/**
 * Historical/reference data is fetched once at seed time (plan §1), not
 * polled — a deliberately separate interface from the live-quote poller so
 * the two very different call patterns (one-shot seed vs. rate-limited
 * recurring poll) can't accidentally get conflated.
 */
export interface HistoricalDataProvider {
  readonly name: string;
  getDailyBars(symbol: string, outputsize?: number): Promise<HistoricalBar[]>;
  getSplits(symbol: string): Promise<SplitEvent[]>;
  getDividends(symbol: string): Promise<DividendEvent[]>;
  getEarnings(symbol: string): Promise<EarningsEvent[]>;
  searchSymbols(query: string): Promise<SymbolSearchResult[]>;
}
