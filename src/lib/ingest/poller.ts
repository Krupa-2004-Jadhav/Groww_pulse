import { MarketDataProvider } from "@/lib/providers";
import { marketSession, pollCadenceMs } from "@/lib/market-hours";
import { getWatchedSymbols, upsertQuote, UpsertOutcome } from "./quotes";
import { recordPollSuccess, recordPollFailure } from "@/lib/health";

export interface PollResult {
  session: string;
  symbols: string[];
  outcomes: Record<string, UpsertOutcome>;
}

const MAX_BACKOFF_MS = 5 * 60_000;
const BASE_BACKOFF_MS = 5_000;

/**
 * Drives quote ingestion. Exposes `pollOnce()` as a standalone, directly
 * testable unit (Test Gate 2 calls it without any real timers); `start()`
 * wires it to a self-rescheduling loop for actual runtime use.
 */
export class IngestPoller {
  private consecutiveFailures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;

  constructor(private readonly provider: MarketDataProvider) {}

  /**
   * One ingestion cycle: fetch the deduplicated watched-symbol union, write
   * each quote idempotently. A provider failure is caught here — it never
   * throws out of pollOnce, and never touches quotes_latest, so a bad poll
   * degrades to "data goes stale" rather than "data goes wrong."
   */
  async pollOnce(): Promise<PollResult> {
    const session = marketSession();
    const symbols = await getWatchedSymbols();
    const outcomes: Record<string, UpsertOutcome> = {};

    if (symbols.length === 0) {
      recordPollSuccess();
      return { session, symbols, outcomes };
    }

    try {
      const quotes = await this.provider.getQuotes(symbols);
      for (const quote of quotes) {
        outcomes[quote.symbol] = await upsertQuote(quote);
      }
      recordPollSuccess();
      this.consecutiveFailures = 0;
    } catch (err) {
      this.consecutiveFailures += 1;
      recordPollFailure(err instanceof Error ? err.message : String(err));
      // Deliberately swallowed past this point: a provider outage must
      // degrade (stale data, visible in /health) rather than crash the
      // process or corrupt quotes_latest with partial/null data.
    }

    return { session, symbols, outcomes };
  }

  private currentBackoffMs(): number {
    if (this.consecutiveFailures === 0) return 0;
    return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (this.consecutiveFailures - 1));
  }

  private scheduleNext() {
    if (this.stopped) return;

    const session = marketSession();
    const cadence = pollCadenceMs(session);

    if (cadence === null) {
      // Market closed: stop polling entirely and re-check in a while
      // rather than busy-waiting — "weekend/holiday -> stop, serve last close" (plan Phase 2).
      this.timer = setTimeout(() => this.tick(), 5 * 60_000);
      return;
    }

    const delay = Math.max(cadence, this.currentBackoffMs());
    this.timer = setTimeout(() => this.tick(), delay);
  }

  private async tick() {
    await this.pollOnce();
    this.scheduleNext();
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    void this.tick();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
