/**
 * Single-process rate/credit governor for Twelve Data's free Basic plan
 * (plan §1): 8 requests/minute, 800 credits/day, ~1 credit per symbol on
 * most endpoints. This is intentionally in-memory, not distributed — the
 * whole point of "one deployable, no Redis" (plan §2) is that a single
 * process owns all outbound calls to the provider.
 */
export class TwelveDataRateLimiter {
  private requestTimestamps: number[] = [];
  private creditsSpentToday = 0;
  private dayKey = utcDayKey(new Date());

  constructor(
    private readonly maxRequestsPerMinute = 8,
    private readonly maxCreditsPerDay = 800
  ) {}

  private rollDayIfNeeded(now: Date) {
    const key = utcDayKey(now);
    if (key !== this.dayKey) {
      this.dayKey = key;
      this.creditsSpentToday = 0;
    }
  }

  /** Blocks (via delay) until a request slot is free under the 8/min ceiling. */
  async waitForSlot(): Promise<void> {
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter((t) => now - t < 60_000);

    if (this.requestTimestamps.length < this.maxRequestsPerMinute) {
      this.requestTimestamps.push(now);
      return;
    }

    const oldest = this.requestTimestamps[0];
    const waitMs = 60_000 - (now - oldest) + 50; // small buffer past the window edge
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return this.waitForSlot();
  }

  /** Throws rather than silently over-spending — a caller should fall back or skip, never guess. */
  reserveCredits(count: number): void {
    this.rollDayIfNeeded(new Date());
    if (this.creditsSpentToday + count > this.maxCreditsPerDay) {
      throw new Error(
        `Twelve Data daily credit budget exhausted: ${this.creditsSpentToday}/${this.maxCreditsPerDay} spent, ${count} requested`
      );
    }
    this.creditsSpentToday += count;
  }

  status() {
    this.rollDayIfNeeded(new Date());
    return {
      requestsInLastMinute: this.requestTimestamps.length,
      maxRequestsPerMinute: this.maxRequestsPerMinute,
      creditsSpentToday: this.creditsSpentToday,
      maxCreditsPerDay: this.maxCreditsPerDay,
    };
  }
}

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Process-wide singleton: every TwelveData call, live or historical, shares
// one budget — that's the whole reason this exists as a governor rather
// than a per-provider counter.
export const twelveDataRateLimiter = new TwelveDataRateLimiter();
