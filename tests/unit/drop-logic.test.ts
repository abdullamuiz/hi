import { describe, expect, it } from 'vitest';
import {
  agreement, DAILY_QUESTIONS, dailyQuestionFor, dayKey, decodeReaction, encodeReaction, hash, parseDay,
  sharedMoments, splitPair, timeLeft, wheelPick,
} from '../../src/drops/logic';

describe('Drop helpers', () => {
  it('hash is stable', () => {
    expect(hash('abc')).toBe(hash('abc'));
    expect(hash('abc')).not.toBe(hash('abd'));
  });

  it('agreement: identical, reversed and in between', () => {
    expect(agreement([0, 1, 2, 3], [0, 1, 2, 3])).toBe(100);
    expect(agreement([0, 1, 2, 3], [3, 2, 1, 0])).toBe(0);
    expect(agreement([0, 1, 2, 3], [1, 0, 2, 3])).toBe(75);
  });

  it('wheel picks the same option on both phones', () => {
    const ids = ['x1', 'y2', 'z3'];
    expect(wheelPick(ids)).toBe(wheelPick([...ids]));
    expect(wheelPick(ids)).toBeGreaterThanOrEqual(0);
    expect(wheelPick(ids)).toBeLessThan(3);
    expect(wheelPick([])).toBe(-1);
  });

  it('watch party reactions round-trip and line up', () => {
    expect(decodeReaction('a', encodeReaction('laugh', 12.7))).toEqual({ uid: 'a', code: 'laugh', minute: 12 });
    expect(decodeReaction('a', 'hello')).toBeNull();
    const rx = [
      { uid: 'a', code: 'laugh', minute: 10 }, { uid: 'b', code: 'wow', minute: 11 },
      { uid: 'a', code: 'sad', minute: 40 }, { uid: 'b', code: 'sad', minute: 60 },
    ];
    expect(sharedMoments(rx, 'a', 'b')).toEqual([10]);
  });

  it('dates and time left', () => {
    expect(new Date(parseDay('2026-02-03')).getMonth()).toBe(1);
    expect(parseDay('2026-02-31')).toBeNaN();
    expect(dayKey(new Date(2026, 0, 5))).toBe('20260105');
    expect(timeLeft(0)).toBe('Today');
    expect(timeLeft(3 * 86400000 + 2 * 3600000)).toBe('3 days 2 hours');
    expect(timeLeft(90 * 60000)).toBe('1 hour 30 min');
  });

  it('splits This or That pairs', () => {
    expect(splitPair('Tea / Coffee')).toEqual(['Tea', 'Coffee']);
    expect(splitPair('Solo')).toEqual(['Solo', '…']);
  });

  it('daily question: ~60 of them, same for both phones, varies by chat and day', () => {
    expect(DAILY_QUESTIONS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(DAILY_QUESTIONS).size).toBe(DAILY_QUESTIONS.length);
    expect(dailyQuestionFor('room1', '20260101')).toBe(dailyQuestionFor('room1', '20260101'));
    const week = new Set(['01', '02', '03', '04', '05', '06', '07'].map((d) => dailyQuestionFor('room1', `202601${d}`)));
    expect(week.size).toBeGreaterThan(3);
  });
});

describe('thread unread', async () => {
  const { threadUnread } = await import('../../src/data/threads');
  const at = (ms: number) => ({ toMillis: () => ms });
  it('only counts the other person’s replies since I looked', () => {
    const m: any = { id: 'm1', thread: { count: 2, lastAt: at(1000), lastBy: 'bob', lastId: 'r' } };
    expect(threadUnread(m, 'alice', 500)).toBe(true);
    expect(threadUnread(m, 'alice', 1500)).toBe(false);
    expect(threadUnread({ ...m, thread: { ...m.thread, lastBy: 'alice' } }, 'alice', 0)).toBe(false);
    expect(threadUnread({ id: 'x' } as any, 'alice', 0)).toBe(false);
  });
});
