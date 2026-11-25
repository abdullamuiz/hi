import type { Message, Tab } from '../types';

/** Choices for a disappearing tab, in hours. */
export const TTL_OPTIONS = [
  { hours: 24, label: '24 hours' },
  { hours: 168, label: '7 days' },
  { hours: 2160, label: '90 days' },
] as const;

export const DEFAULT_TTL = 24;

export const validTtl = (h: unknown): number =>
  TTL_OPTIONS.some((o) => o.hours === h) ? (h as number) : DEFAULT_TTL;

export const ttlLabel = (hours: number) => TTL_OPTIONS.find((o) => o.hours === hours)?.label || `${hours} hours`;

/** Hours a new message in this tab lives for, or 0 when the tab keeps messages. */
export const tabTtl = (t: Pick<Tab, 'disappearing' | 'ttlHours'> | undefined | null): number =>
  t?.disappearing ? validTtl(t.ttlHours) : 0;

/** When a message sent at `now` expires (ms), or null for a tab that keeps messages. */
export const expiryFor = (ttlHours: number, now = Date.now()): number | null =>
  ttlHours > 0 ? now + ttlHours * 3_600_000 : null;

const ms = (t: unknown): number => {
  const x = t as { toMillis?: () => number } | null | undefined;
  return x && typeof x.toMillis === 'function' ? x.toMillis() : 0;
};

/** Expired messages are hidden at once; the TTL policy deletes them within about a day. */
export const isExpired = (m: Pick<Message, 'expiresAt'>, now = Date.now()) => {
  const at = ms(m.expiresAt);
  return at > 0 && at <= now;
};

export const notExpired = <T extends Pick<Message, 'expiresAt'>>(msgs: T[], now = Date.now()) =>
  msgs.filter((m) => !isExpired(m, now));

/** "Alice turned on disappearing messages (7 days)" / "You turned off disappearing messages". */
export function systemText(m: Pick<Message, 'system' | 'ttlHours'>, who: string): string {
  if (m.system === 'disappearing') {
    const h = Number(m.ttlHours || 0);
    return h > 0
      ? `${who} turned on disappearing messages (${ttlLabel(h)})`
      : `${who} turned off disappearing messages`;
  }
  return '';
}
