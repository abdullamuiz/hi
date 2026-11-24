/**
 * Times for scheduled messages and quiet hours. Pure helpers (no Firebase), so they're
 * easy to test. Times use the phone's own clock and time zone.
 */

export interface QuickPick {
  id: 'tonight' | 'morning' | 'monday';
  label: string;
  at: number;
}

function at(base: Date, days: number, hour: number, minute = 0): number {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

/** Tonight 8pm (or tomorrow 8pm if it's later than 7:30pm), Tomorrow 8am, Next Monday 9am. */
export function quickPicks(now = Date.now()): QuickPick[] {
  const base = new Date(now);
  let tonight = at(base, 0, 20);
  const tonightLabel = tonight - now >= 30 * 60_000 ? 'Tonight 8 pm' : 'Tomorrow 8 pm';
  if (tonight - now < 30 * 60_000) tonight = at(base, 1, 20);
  const dow = base.getDay(); // 0 = Sunday
  const toMonday = ((8 - dow) % 7) || 7;
  return [
    { id: 'tonight', label: tonightLabel, at: tonight },
    { id: 'morning', label: 'Tomorrow 8 am', at: at(base, 1, 8) },
    { id: 'monday', label: 'Next Monday 9 am', at: at(base, toMonday, 9) },
  ];
}

/** "Today 8:00 pm", "Tomorrow 8:00 am", "Mon 3 Nov, 9:00 am". */
export function whenLabel(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const day0 = new Date(now); day0.setHours(0, 0, 0, 0);
  const day1 = new Date(ms); day1.setHours(0, 0, 0, 0);
  const days = Math.round((day1.getTime() - day0.getTime()) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}

/** Value for <input type="datetime-local"> (local time, minutes). */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/** Latest time a message can be scheduled for (rules allow up to a year). */
export const MAX_AHEAD_MS = 365 * 86_400_000;

/** null when fine, else why the time can't be used. */
export function scheduleProblem(ms: number | null, now = Date.now()): string | null {
  if (ms == null) return 'Pick a date and time.';
  if (ms <= now) return 'Pick a time in the future.';
  if (ms - now > MAX_AHEAD_MS) return 'Pick a time within a year.';
  return null;
}

// ---------------------------------------------------------------- quiet hours

export interface QuietHours {
  on: boolean;
  /** "HH:MM", 24-hour. */
  start: string;
  end: string;
  /** IANA time zone the hours are in (the phone's, when saved). */
  tz: string;
}

export const DEFAULT_QUIET: QuietHours = { on: false, start: '21:00', end: '07:00', tz: 'UTC' };

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const validHHMM = (s: string) => HHMM.test(s);
const minutesOf = (s: string) => { const m = HHMM.exec(s)!; return +m[1] * 60 + +m[2]; };

/** Minutes since midnight of `ms` in time zone `tz`. */
export function minutesInZone(ms: number, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
    const h = Number(parts.find((p) => p.type === 'hour')?.value);
    const m = Number(parts.find((p) => p.type === 'minute')?.value);
    return h * 60 + m;
  } catch {
    const d = new Date(ms);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }
}

/** Is `ms` inside the quiet window? Windows may cross midnight (21:00–07:00). */
export function isQuiet(ms: number, q: QuietHours | null | undefined): boolean {
  if (!q || !q.on || !validHHMM(q.start) || !validHHMM(q.end)) return false;
  const s = minutesOf(q.start);
  const e = minutesOf(q.end);
  if (s === e) return false;
  const now = minutesInZone(ms, q.tz || 'UTC');
  return s < e ? now >= s && now < e : now >= s || now < e;
}

export function normaliseQuiet(x: unknown): QuietHours {
  const q = (x && typeof x === 'object' ? x : {}) as Partial<QuietHours>;
  return {
    on: q.on === true,
    start: typeof q.start === 'string' && validHHMM(q.start) ? q.start : DEFAULT_QUIET.start,
    end: typeof q.end === 'string' && validHHMM(q.end) ? q.end : DEFAULT_QUIET.end,
    tz: typeof q.tz === 'string' && q.tz ? q.tz : DEFAULT_QUIET.tz,
  };
}

export const phoneZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

// ---------------------------------------------------------------- mute

export interface MuteState { muted: boolean; mutedUntil: number | null }

export function isMuted(m: Partial<MuteState> | undefined, now = Date.now()): boolean {
  return !!m && (m.muted === true || (typeof m.mutedUntil === 'number' && m.mutedUntil > now));
}

export type MuteChoice = '8h' | 'week' | 'always' | 'off';

/** What to store for a mute choice. */
export function muteFor(choice: MuteChoice, now = Date.now()): MuteState {
  switch (choice) {
    case '8h': return { muted: false, mutedUntil: now + 8 * 3_600_000 };
    case 'week': return { muted: false, mutedUntil: now + 7 * 86_400_000 };
    case 'always': return { muted: true, mutedUntil: null };
    default: return { muted: false, mutedUntil: null };
  }
}

export function muteLabel(m: Partial<MuteState> | undefined, now = Date.now()): string {
  if (!isMuted(m, now)) return '';
  if (m!.muted) return 'Muted';
  return `Muted until ${whenLabel(m!.mutedUntil!, now)}`;
}

// ---------------------------------------------------------------- urgent

export const URGENT_PER_DAY = 3;

/** UTC day key, e.g. "2026-11-24" (the server counts urgent messages per UTC day). */
export const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function urgentLeft(counter: { day?: string; count?: number } | null | undefined, now = Date.now()): number {
  if (!counter || counter.day !== dayKey(now)) return URGENT_PER_DAY;
  return Math.max(0, URGENT_PER_DAY - (counter.count || 0));
}
