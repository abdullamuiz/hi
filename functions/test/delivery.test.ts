import { describe, expect, it } from 'vitest';
import { dayKeyIn, due, expiryMs, isMuted, isQuiet, scheduledToMessage, summaryText, urgentDecision } from '../src/delivery';

const utc = (h: number, m = 0) => Date.UTC(2026, 10, 24, h, m);

describe('quiet hours', () => {
  const q = { on: true, start: '21:00', end: '07:00', tz: 'UTC' };
  it('holds across midnight and lets through in the day', () => {
    expect(isQuiet(utc(23), q)).toBe(true);
    expect(isQuiet(utc(2), q)).toBe(true);
    expect(isQuiet(utc(7), q)).toBe(false);
    expect(isQuiet(utc(15), q)).toBe(false);
  });
  it('follows the saved zone and ignores bad settings', () => {
    expect(isQuiet(utc(17, 30), { ...q, tz: 'Indian/Maldives' })).toBe(true);
    expect(isQuiet(utc(23), { ...q, on: false })).toBe(false);
    expect(isQuiet(utc(23), { ...q, start: '9pm' })).toBe(false);
    expect(isQuiet(utc(23), undefined)).toBe(false);
  });
});

describe('urgent', () => {
  const now = utc(12);
  it('three a day, then held like any message', () => {
    let c: { day?: string; count?: number } | null = null;
    for (let i = 1; i <= 3; i++) {
      const d = urgentDecision(c, now);
      expect(d.allowed).toBe(true);
      expect(d.next.count).toBe(i);
      c = d.next;
    }
    expect(urgentDecision(c, now).allowed).toBe(false);
  });
  it('resets the next day', () => {
    expect(urgentDecision({ day: '2026-11-23', count: 3 }, now)).toEqual({ allowed: true, next: { day: '2026-11-24', count: 1 } });
  });
});

describe('held notifications', () => {
  it('summarise per sender, opening the latest chat', () => {
    expect(summaryText([])).toBeNull();
    const s = summaryText([
      { roomId: 'r1', tabId: 'general', from: 'Sam' },
      { roomId: 'r2', tabId: 'general', from: 'Alex' },
      { roomId: 'r1', tabId: 'trip', from: 'Sam' },
      { roomId: 'r1', tabId: 'general', from: 'Sam' },
    ])!;
    expect(s.body).toBe('3 messages from Sam, 1 from Alex');
    expect(s.roomId).toBe('r1');
    expect(s.tabId).toBe('general');
    expect(summaryText([{ roomId: 'r', tabId: 't', from: 'Sam' }])!.body).toBe('1 message from Sam');
  });
});

describe('scheduled delivery', () => {
  it('picks only due messages', () => {
    const items = [{ id: 'a', sendAtMs: 100 }, { id: 'b', sendAtMs: 200 }, { id: 'c', sendAtMs: 0 }];
    expect(due(items, 150).map((x) => x.id)).toEqual(['a']);
    expect(due(items, 200).map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('turns into a plain text message from the sender', () => {
    const { message, preview } = scheduledToMessage({ senderId: 'alice', text: 'Happy\n birthday!', replyTo: { msgId: 'm', snippet: 's', senderId: 'bob' } });
    expect(message).toEqual({ uid: 'alice', kind: 'text', text: 'Happy\n birthday!', scheduled: true, replyTo: { msgId: 'm', snippet: 's', senderId: 'bob' } });
    expect(preview).toBe('Happy birthday!');
    expect(scheduledToMessage({ senderId: 'a', text: 'x' }).message).not.toHaveProperty('replyTo');
  });
});

describe('mute', () => {
  it('for good or until a time', () => {
    expect(isMuted({ muted: true }, 5)).toBe(true);
    expect(isMuted({ muted: false, mutedUntilMs: 10 }, 5)).toBe(true);
    expect(isMuted({ muted: false, mutedUntilMs: 10 }, 15)).toBe(false);
    expect(isMuted(undefined, 5)).toBe(false);
  });
});

describe('expiryMs (scheduled delivery into a disappearing tab)', () => {
  const now = 1_700_000_000_000;
  it('follows the tab setting', () => {
    expect(expiryMs({ disappearing: true, ttlHours: 168 }, now)).toBe(now + 168 * 3_600_000);
    expect(expiryMs({ disappearing: true }, now)).toBe(now + 24 * 3_600_000);
    expect(expiryMs({ disappearing: true, ttlHours: 7 }, now)).toBe(now + 24 * 3_600_000);
  });
  it('is null for tabs that keep messages', () => {
    expect(expiryMs({ disappearing: false, ttlHours: 168 }, now)).toBeNull();
    expect(expiryMs(undefined, now)).toBeNull();
  });
});

describe('dayKeyIn (activity day for streaks)', () => {
  it('files a message under the room zone\'s day', () => {
    const ms = Date.parse('2026-03-01T20:30:00Z');
    expect(dayKeyIn(ms, 'Indian/Maldives')).toBe('2026-03-02');
    expect(dayKeyIn(ms, 'America/New_York')).toBe('2026-03-01');
    expect(dayKeyIn(ms, 'Not/AZone')).toBe('2026-03-01');
  });
});
