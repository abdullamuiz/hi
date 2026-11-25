/**
 * Pure helpers for scheduled messages, quiet hours and urgent messages (no Firebase),
 * so they can be unit-tested. Kept in step with src/lib/schedule.ts in the app.
 */

export interface QuietHours { on: boolean; start: string; end: string; tz: string }

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutesOf = (s: string) => { const m = HHMM.exec(s)!; return +m[1] * 60 + +m[2]; };

export function minutesInZone(ms: number, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
    return Number(parts.find((p) => p.type === 'hour')?.value) * 60 + Number(parts.find((p) => p.type === 'minute')?.value);
  } catch {
    const d = new Date(ms);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }
}

/** Is `ms` inside the person's quiet hours? Windows may cross midnight. */
export function isQuiet(ms: number, q: Partial<QuietHours> | null | undefined): boolean {
  if (!q || q.on !== true || typeof q.start !== 'string' || typeof q.end !== 'string') return false;
  if (!HHMM.test(q.start) || !HHMM.test(q.end)) return false;
  const s = minutesOf(q.start);
  const e = minutesOf(q.end);
  if (s === e) return false;
  const now = minutesInZone(ms, q.tz || 'UTC');
  return s < e ? now >= s && now < e : now >= s || now < e;
}

export const URGENT_PER_DAY = 3;
export const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Whether an urgent message may break through quiet hours, and the sender's new
 * daily count. Three a day (UTC days); after that it waits like any other message.
 */
export function urgentDecision(counter: { day?: string; count?: number } | null | undefined, now: number) {
  const day = dayKey(now);
  const used = counter && counter.day === day ? Number(counter.count || 0) : 0;
  if (used >= URGENT_PER_DAY) return { allowed: false, next: { day, count: used } };
  return { allowed: true, next: { day, count: used + 1 } };
}

export interface Held { roomId: string; tabId: string; from: string }

/** One notification for everything held during quiet hours: "3 messages from Sam, 1 from Alex". */
export function summaryText(held: Held[]): { title: string; body: string; roomId: string; tabId: string } | null {
  if (!held.length) return null;
  const counts = new Map<string, number>();
  held.forEach((h) => counts.set(h.from, (counts.get(h.from) || 0) + 1));
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([from, n], i) =>
    i === 0 ? `${n} message${n === 1 ? '' : 's'} from ${from}` : `${n} from ${from}`);
  const last = held[held.length - 1];
  return { title: 'While you were in quiet hours', body: parts.join(', '), roomId: last.roomId, tabId: last.tabId };
}

/** Scheduled messages that are due now (the list is small, so it's filtered here, not by an index). */
export function due<T extends { sendAtMs: number }>(items: T[], now: number): T[] {
  return items.filter((s) => s.sendAtMs > 0 && s.sendAtMs <= now);
}

/** The chat message a scheduled one becomes (createdAt is added by the caller). */
export function scheduledToMessage(s: { senderId: string; text: string; replyTo?: unknown }) {
  const text = String(s.text || '').slice(0, 4000);
  return {
    message: { uid: s.senderId, kind: 'text', text, scheduled: true, ...(s.replyTo ? { replyTo: s.replyTo } : {}) },
    preview: text.replace(/\s+/g, ' ').trim().slice(0, 120),
  };
}

/** Mute: for good, or until a time. */
export function isMuted(contact: { muted?: unknown; mutedUntilMs?: number | null } | undefined, now: number): boolean {
  return !!contact && (contact.muted === true || (typeof contact.mutedUntilMs === 'number' && contact.mutedUntilMs > now));
}

/** Disappearing tab: when a message sent now expires (ms), or null when the tab keeps messages. */
export function expiryMs(tab: { disappearing?: unknown; ttlHours?: unknown } | undefined, now: number): number | null {
  if (!tab || tab.disappearing !== true) return null;
  const h = [24, 168, 2160].includes(tab.ttlHours as number) ? (tab.ttlHours as number) : 24;
  return now + h * 3_600_000;
}

/** "YYYY-MM-DD" for `ms` in the room's zone (the activity day a message counts for). */
export function dayKeyIn(ms: number, tz?: string): string {
  let f: Intl.DateTimeFormat;
  try { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Indian/Maldives', year: 'numeric', month: '2-digit', day: '2-digit' }); }
  catch { f = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }); }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
