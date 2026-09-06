/**
 * US market-hours + NYSE holiday calendar, computed rather than a hardcoded
 * date list — holiday rules (nth-weekday-of-month, Easter/Good Friday via
 * the Gregorian computus) are stable across years, so this stays correct
 * without an annual update.
 *
 * Simplification, stated here rather than silently: early-close sessions
 * (day after Thanksgiving, Christmas Eve when a trading day) are not
 * modeled — they're treated as full sessions. Wrong for ~2 half-days/year,
 * acceptable for a "since you left" cadence decision.
 */

const ET_TIME_ZONE = "America/New_York";

interface EasternParts {
  year: number;
  month: number; // 1-12
  day: number;
  weekday: number; // 0=Sun..6=Sat
  hour: number;
  minute: number;
}

function easternParts(date: Date): EasternParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TIME_ZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdayMap[parts.weekday],
    // Intl renders midnight as "24:00" under hour12:false in some engines; normalize.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

/** Nth weekday of a month, e.g. nthWeekdayOfMonth(2026, 1, 1, 3) = 3rd Monday of January 2026. */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstWeekday = first.getUTCDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  return 1 + offset + (n - 1) * 7;
}

/** Last weekday of a month, e.g. Memorial Day = last Monday of May. */
function lastWeekdayOfMonth(year: number, month: number, weekday: number): number {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDate = new Date(Date.UTC(year, month - 1, lastDay));
  const lastDateWeekday = lastDate.getUTCDay();
  const offset = (lastDateWeekday - weekday + 7) % 7;
  return lastDay - offset;
}

/** Anonymous Gregorian algorithm (computus) — Easter Sunday's month/day for a given year. */
function easterMonthDay(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** If a fixed holiday falls on Sat/Sun, NYSE observes it the nearest weekday (Fri before / Mon after). */
function observedDate(year: number, month: number, day: number): { month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day));
  const weekday = d.getUTCDay();
  if (weekday === 6) {
    d.setUTCDate(d.getUTCDate() - 1); // Saturday -> observed Friday
  } else if (weekday === 0) {
    d.setUTCDate(d.getUTCDate() + 1); // Sunday -> observed Monday
  }
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function isNyseHoliday(year: number, month: number, day: number): boolean {
  const easter = easterMonthDay(year);
  const goodFriday = new Date(Date.UTC(year, easter.month - 1, easter.day));
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);

  const holidays = [
    observedDate(year, 1, 1), // New Year's Day
    { month: 1, day: nthWeekdayOfMonth(year, 1, 1, 3) }, // MLK Day — 3rd Monday of Jan
    { month: 2, day: nthWeekdayOfMonth(year, 2, 1, 3) }, // Presidents Day — 3rd Monday of Feb
    { month: goodFriday.getUTCMonth() + 1, day: goodFriday.getUTCDate() }, // Good Friday
    { month: 5, day: lastWeekdayOfMonth(year, 5, 1) }, // Memorial Day — last Monday of May
    observedDate(year, 6, 19), // Juneteenth
    observedDate(year, 7, 4), // Independence Day
    { month: 9, day: nthWeekdayOfMonth(year, 9, 1, 1) }, // Labor Day — 1st Monday of Sep
    { month: 11, day: nthWeekdayOfMonth(year, 11, 4, 4) }, // Thanksgiving — 4th Thursday of Nov
    observedDate(year, 12, 25), // Christmas
  ];

  return holidays.some((h) => h.month === month && h.day === day);
}

export type MarketSession = "open" | "pre-post" | "closed";

const REGULAR_OPEN_MINUTES = 9 * 60 + 30; // 9:30 ET
const REGULAR_CLOSE_MINUTES = 16 * 60; // 16:00 ET
const EXTENDED_OPEN_MINUTES = 4 * 60; // 04:00 ET pre-market
const EXTENDED_CLOSE_MINUTES = 20 * 60; // 20:00 ET post-market

export function isMarketOpen(date: Date = new Date()): boolean {
  return marketSession(date) === "open";
}

/**
 * Drives the ingest poller's cadence (plan Phase 2): "open" -> 10s,
 * "pre-post" -> a few minutes, "closed" -> stop polling, serve last close.
 */
export function marketSession(date: Date = new Date()): MarketSession {
  const p = easternParts(date);

  if (p.weekday === 0 || p.weekday === 6) return "closed";
  if (isNyseHoliday(p.year, p.month, p.day)) return "closed";

  const minutes = p.hour * 60 + p.minute;
  if (minutes >= REGULAR_OPEN_MINUTES && minutes < REGULAR_CLOSE_MINUTES) return "open";
  if (minutes >= EXTENDED_OPEN_MINUTES && minutes < EXTENDED_CLOSE_MINUTES) return "pre-post";
  return "closed";
}

export function pollCadenceMs(session: MarketSession): number | null {
  if (session === "open") return 10_000;
  if (session === "pre-post") return 3 * 60_000;
  return null; // null = don't poll
}
