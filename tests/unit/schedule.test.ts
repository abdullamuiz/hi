import { describe, expect, it } from 'vitest';
import {
  fromLocalInput, isMuted, isQuiet, minutesInZone, muteFor, muteLabel, normaliseQuiet, quickPicks, scheduleProblem,
  toLocalInput, urgentLeft, dayKey,
} from '../../src/lib/schedule';
import { parseFailed, statuses } from '../../src/lib/delivery';

const local = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

describe('quick picks', () => {
  it('tonight, tomorrow morning, next Monday', () => {
    // Wednesday 26 Nov 2026, 10:00 local
    const now = local(2026, 11, 26, 10);
    const [tonight, morning, monday] = quickPicks(now);
    expect(tonight.label).toBe('Tonight 8 pm');
    expect(tonight.at).toBe(local(2026, 11, 26, 20));
    expect(morning.at).toBe(local(2026, 11, 27, 8));
    expect(monday.at).toBe(local(2026, 11, 30, 9));
  });
  it('late in the evening, "tonight" moves to tomorrow', () => {
    const [tonight] = quickPicks(local(2026, 11, 26, 19, 45));
    expect(tonight.label).toBe('Tomorrow 8 pm');
    expect(tonight.at).toBe(local(2026, 11, 27, 20));
  });
  it('on a Monday, next Monday is a week away', () => {
    const [, , monday] = quickPicks(local(2026, 11, 30, 10));
    expect(monday.at).toBe(local(2026, 12, 7, 9));
  });
  it('datetime-local round trip and validation', () => {
    const ms = local(2026, 12, 1, 9, 5);
    expect(toLocalInput(ms)).toBe('2026-12-01T09:05');
    expect(fromLocalInput('2026-12-01T09:05')).toBe(ms);
    expect(fromLocalInput('nope')).toBeNull();
    expect(scheduleProblem(null)).toMatch(/Pick/);
    expect(scheduleProblem(ms - 1, ms)).toMatch(/future/);
    expect(scheduleProblem(ms + 400 * 86_400_000, ms)).toMatch(/year/);
    expect(scheduleProblem(ms + 60_000, ms)).toBeNull();
  });
});

describe('quiet hours', () => {
  const q = { on: true, start: '21:00', end: '07:00', tz: 'UTC' };
  const utc = (h: number, m = 0) => Date.UTC(2026, 10, 24, h, m);
  it('crosses midnight', () => {
    expect(isQuiet(utc(22), q)).toBe(true);
    expect(isQuiet(utc(3), q)).toBe(true);
    expect(isQuiet(utc(6, 59), q)).toBe(true);
    expect(isQuiet(utc(7), q)).toBe(false);
    expect(isQuiet(utc(12), q)).toBe(false);
    expect(isQuiet(utc(21), q)).toBe(true);
  });
  it('same-day window, off, and equal ends', () => {
    expect(isQuiet(utc(13), { ...q, start: '12:00', end: '14:00' })).toBe(true);
    expect(isQuiet(utc(15), { ...q, start: '12:00', end: '14:00' })).toBe(false);
    expect(isQuiet(utc(22), { ...q, on: false })).toBe(false);
    expect(isQuiet(utc(22), { ...q, end: '21:00' })).toBe(false);
    expect(isQuiet(utc(22), null)).toBe(false);
  });
  it('uses the saved time zone', () => {
    // 17:30 UTC is 22:30 in the Maldives (UTC+5).
    expect(minutesInZone(utc(17, 30), 'Indian/Maldives')).toBe(22 * 60 + 30);
    expect(isQuiet(utc(17, 30), { ...q, tz: 'Indian/Maldives' })).toBe(true);
    expect(isQuiet(utc(17, 30), q)).toBe(false);
  });
  it('normalises bad data', () => {
    expect(normaliseQuiet({ on: 'yes', start: '25:00' })).toEqual({ on: false, start: '21:00', end: '07:00', tz: 'UTC' });
  });
});

describe('mute and urgent', () => {
  it('mute choices', () => {
    const now = 1_000_000;
    expect(isMuted(muteFor('8h', now), now + 1)).toBe(true);
    expect(isMuted(muteFor('8h', now), now + 9 * 3_600_000)).toBe(false);
    expect(isMuted(muteFor('always', now), now + 1e12)).toBe(true);
    expect(isMuted(muteFor('off', now), now)).toBe(false);
    expect(muteLabel(muteFor('always', now), now)).toBe('Muted');
    expect(muteLabel(muteFor('week', now), now)).toMatch(/^Muted until/);
  });
  it('three urgent messages a day', () => {
    const now = Date.UTC(2026, 10, 24, 12);
    expect(urgentLeft(null, now)).toBe(3);
    expect(urgentLeft({ day: dayKey(now), count: 2 }, now)).toBe(1);
    expect(urgentLeft({ day: dayKey(now), count: 5 }, now)).toBe(0);
    expect(urgentLeft({ day: '2026-11-23', count: 3 }, now)).toBe(3);
  });
});

describe('status ticks', () => {
  const msgs = [
    { id: 'a', uid: 'me', createdMs: 1000 },
    { id: 'b', uid: 'them', createdMs: 2000 },
    { id: 'c', uid: 'me', createdMs: 3000 },
    { id: 'd', uid: 'me', createdMs: 9000 },
    { id: 'e', uid: 'me', createdMs: 9500, pending: true },
  ];
  it('sending, sent and read; only the newest read one is labelled', () => {
    const s = statuses(msgs, 'me', 3500);
    expect(s.byId).toEqual({ a: 'read', c: 'read', d: 'sent', e: 'sending' });
    expect(s.lastReadId).toBe('c');
  });
  it('without read receipts everything stays "sent"', () => {
    const s = statuses(msgs, 'me', null);
    expect(s.byId.a).toBe('sent');
    expect(s.lastReadId).toBeNull();
  });
  it('failed list survives bad storage', () => {
    expect(parseFailed('{bad')).toEqual([]);
    expect(parseFailed(JSON.stringify([{ localId: 'x', text: 'hi', tabId: 'general' }, { nope: 1 }]))).toHaveLength(1);
  });
});
