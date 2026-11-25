/**
 * Hot streak: the days on which both people sent something, counted in the room's
 * time zone so both phones agree on where a day starts.
 *
 * Forgiving by design: one missed day a week is skipped over automatically (it doesn't
 * add to the count, but it doesn't break it either). Two missed days in a row, or a
 * second miss within 7 days of the last skip, end the streak. Today never breaks it:
 * it's still "pending" until it's over.
 */

const fmt = new Map<string, Intl.DateTimeFormat>();

/** "YYYY-MM-DD" for `ms` in time zone `tz` (falls back to the phone's zone). */
export function dayKeyIn(ms: number, tz?: string): string {
  const k = tz || '';
  let f = fmt.get(k);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch {
      f = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });
    }
    fmt.set(k, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

const toUTC = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Calendar arithmetic on day keys. */
export function addDays(key: string, n: number): string {
  return new Date(toUTC(key) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUTC(b) - toUTC(a)) / 86_400_000);
}

/** Day key → uids who sent something that day. */
export type DayMap = Record<string, readonly string[]>;

export interface StreakResult {
  /** Current streak in days (skip days don't count). */
  count: number;
  /** Longest streak since it was turned on. */
  best: number;
  /** First day of the current run ('' when the count is 0). */
  runStart: string;
  /** Who has sent something today. */
  today: { me: boolean; them: boolean };
  /** The free skip day can still be used this week. */
  skipAvailable: boolean;
  /** The last day the skip covered, if it was in the current run. */
  skippedOn: string | null;
}

export const SKIP_EVERY_DAYS = 7;

export function computeStreak(days: DayMap, me: string, them: string, sinceKey: string, todayKey: string): StreakResult {
  const both = (d: string) => { const u = days[d] || []; return u.includes(me) && u.includes(them); };
  let cur = 0;
  let best = 0;
  let runStart = '';
  let lastSkip: string | null = null;
  let missRun = 0;
  const span = Math.min(Math.max(0, daysBetween(sinceKey, todayKey)), 3660);
  for (let i = 0; i <= span; i++) {
    const d = addDays(sinceKey, i);
    if (both(d)) {
      if (cur === 0) runStart = d;
      cur++;
      missRun = 0;
      best = Math.max(best, cur);
    } else if (d === todayKey) {
      // Today isn't over yet.
    } else {
      missRun++;
      const skipFree = lastSkip == null || daysBetween(lastSkip, d) >= SKIP_EVERY_DAYS;
      if (cur > 0 && missRun === 1 && skipFree) {
        lastSkip = d;
      } else {
        cur = 0;
        runStart = '';
        lastSkip = null;
      }
    }
  }
  const t = days[todayKey] || [];
  return {
    count: cur,
    best,
    runStart,
    today: { me: t.includes(me), them: t.includes(them) },
    skipAvailable: lastSkip == null || daysBetween(lastSkip, todayKey) >= SKIP_EVERY_DAYS,
    skippedOn: cur > 0 ? lastSkip : null,
  };
}

/** Offset of `tz` from UTC at `ms`, in milliseconds (e.g. +5h for Maldives). */
export function tzOffsetMs(ms: number, tz?: string): number {
  try {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || undefined, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
    const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
    return asUTC - Math.floor(ms / 1000) * 1000;
  } catch {
    return -new Date(ms).getTimezoneOffset() * 60_000;
  }
}

/** [start, end) in ms of day `key` in zone `tz`. */
export function dayWindow(key: string, tz?: string): [number, number] {
  const utc = toUTC(key);
  const start = utc - tzOffsetMs(utc, tz);
  const next = toUTC(addDays(key, 1));
  return [start, next - tzOffsetMs(next, tz)];
}

/** The same calendar day `n` years (or months) earlier; Feb 29 falls back to Feb 28. */
export function sameDayAgo(key: string, n: number, unit: 'year' | 'month'): string {
  let [y, m, d] = key.split('-').map(Number);
  if (unit === 'year') y -= n;
  else { m -= n; while (m < 1) { m += 12; y -= 1; } }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
