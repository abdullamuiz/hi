import { describe, expect, it } from 'vitest';
import { addDays, computeStreak, dayKeyIn, daysBetween, dayWindow, sameDayAgo, type DayMap } from '../../src/lib/streak';
import { nextMilestone, reachedMilestones } from '../../src/lib/milestones';
import { computeRewind, emojisIn, gapLabel, rewindPeriod, wordsIn, type RewindMessage } from '../../src/lib/rewind';

const A = 'alice';
const B = 'bob';
/** Builds a DayMap from a string: one char per day from `start`. b = both, a = only me, . = nobody. */
function days(start: string, pattern: string): DayMap {
  const out: DayMap = {};
  [...pattern].forEach((c, i) => {
    const d = addDays(start, i);
    if (c === 'b') out[d] = [A, B];
    if (c === 'a') out[d] = [A];
    if (c === 'o') out[d] = [B];
  });
  return out;
}
const S = '2026-01-01';
const at = (pattern: string) => addDays(S, pattern.length - 1);

describe('day keys', () => {
  it('uses the room time zone, not UTC', () => {
    const ms = Date.parse('2026-03-01T20:30:00Z');
    expect(dayKeyIn(ms, 'UTC')).toBe('2026-03-01');
    expect(dayKeyIn(ms, 'Indian/Maldives')).toBe('2026-03-02'); // UTC+5
    expect(dayKeyIn(ms, 'America/Los_Angeles')).toBe('2026-03-01');
  });
  it('does calendar arithmetic across months and leap years', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-01-30', '2026-03-01')).toBe(30);
  });
  it('finds where a day starts and ends in a zone', () => {
    const [s, e] = dayWindow('2026-06-10', 'Indian/Maldives');
    expect(new Date(s).toISOString()).toBe('2026-06-09T19:00:00.000Z');
    expect(e - s).toBe(86_400_000);
  });
  it('steps back years and months, clamping Feb 29', () => {
    expect(sameDayAgo('2028-02-29', 1, 'year')).toBe('2027-02-28');
    expect(sameDayAgo('2026-03-31', 1, 'month')).toBe('2026-02-28');
    expect(sameDayAgo('2026-01-15', 2, 'month')).toBe('2025-11-15');
  });
});

describe('hot streak', () => {
  it('counts days on which both of us sent something', () => {
    const p = 'bbbb';
    const r = computeStreak(days(S, p), A, B, S, at(p));
    expect(r.count).toBe(4);
    expect(r.best).toBe(4);
    expect(r.runStart).toBe(S);
    expect(r.today).toEqual({ me: true, them: true });
  });
  it('only one of us is not enough', () => {
    const p = 'bbab';
    expect(computeStreak(days(S, p), A, B, S, at(p)).count).toBe(3);
  });
  it('today is pending, not a miss', () => {
    const p = 'bbb.';
    const r = computeStreak(days(S, p), A, B, S, at(p));
    expect(r.count).toBe(3);
    expect(r.today).toEqual({ me: false, them: false });
    const half = computeStreak(days(S, 'bbba'), A, B, S, at('bbba'));
    expect(half.today).toEqual({ me: true, them: false });
  });
  it('skips one missed day a week for free', () => {
    const p = 'bbb.bb';
    const r = computeStreak(days(S, p), A, B, S, at(p));
    expect(r.count).toBe(5);
    expect(r.skippedOn).toBe(addDays(S, 3));
    expect(r.skipAvailable).toBe(false);
  });
  it('two missed days in a row end it (best is kept)', () => {
    const p = 'bbbb..bb';
    const r = computeStreak(days(S, p), A, B, S, at(p));
    expect(r.count).toBe(2);
    expect(r.best).toBe(4);
  });
  it('a second miss within 7 days of the last skip ends it', () => {
    const p = 'bb.bbb.bb';
    expect(computeStreak(days(S, p), A, B, S, at(p)).count).toBe(2);
  });
  it('the skip comes back after a week', () => {
    const p = 'bb.bbbbbbb.bb';
    const r = computeStreak(days(S, p), A, B, S, at(p));
    expect(r.count).toBe(11);
    expect(r.best).toBe(11);
  });
  it('days before the streak was turned on do not count', () => {
    const p = 'bbbbbb';
    expect(computeStreak(days(S, p), A, B, addDays(S, 4), at(p)).count).toBe(2);
  });
  it('a missed first day is no skip', () => {
    const p = '.bb';
    const r = computeStreak(days(S, p), A, B, S, at(p));
    expect(r.count).toBe(2);
    expect(r.skippedOn).toBeNull();
  });
});

describe('milestones', () => {
  const base = { streak: 0, runStart: '', messages: 0, startedOn: '', todayKey: '2026-05-01', partner: 'Sam' };
  it('celebrates streaks, message counts and the anniversary', () => {
    const r = reachedMilestones({ ...base, streak: 31, runStart: '2026-04-01', messages: 1200, startedOn: '2025-05-01' });
    expect(r.map((m) => m.id)).toEqual(['anniv-1', 'streak-30-2026-04-01', 'streak-7-2026-04-01', 'msgs-1000', 'msgs-100']);
  });
  it('no anniversary on other days or in the first year', () => {
    expect(reachedMilestones({ ...base, startedOn: '2025-05-02' })).toEqual([]);
    expect(reachedMilestones({ ...base, startedOn: '2026-05-01' })).toEqual([]);
  });
  it('shows the biggest unseen one and marks the rest seen', () => {
    const r = reachedMilestones({ ...base, messages: 1500 });
    const first = nextMilestone(r, new Set());
    expect(first.show?.id).toBe('msgs-1000');
    expect(first.mark).toEqual(['msgs-1000', 'msgs-100']);
    expect(nextMilestone(r, new Set(first.mark)).show).toBeNull();
  });
  it('a new streak run celebrates again', () => {
    const a = reachedMilestones({ ...base, streak: 7, runStart: '2026-04-25' });
    const b = reachedMilestones({ ...base, streak: 7, runStart: '2026-06-01' });
    expect(a[0].id).not.toBe(b[0].id);
  });
});

describe('rewind', () => {
  it('finds emojis, including joined and skin-tone ones', () => {
    expect(emojisIn('so good 😂😂 👍🏽 ❤️ 👨‍👩‍👧')).toEqual(['😂', '😂', '👍🏽', '❤️', '👨‍👩‍👧']);
  });
  it('keeps meaningful words only', () => {
    expect(wordsIn("I'm SO excited for the beach trip!! https://x.com/beach 2026")).toEqual(['excited', 'beach', 'trip']);
    expect(wordsIn('Café, café… CAFÉ')).toEqual(['café', 'café', 'café']);
  });
  it('adds up a period', () => {
    const t0 = Date.parse('2026-04-01T08:00:00Z');
    const h = 3_600_000;
    const m = (i: number, uid: string, text: string, extra: Partial<RewindMessage> = {}): RewindMessage =>
      ({ id: `m${i}`, tabId: 'general', uid, kind: 'text', text, ms: t0 + i * h, ...extra });
    const msgs: RewindMessage[] = [
      m(0, A, 'first beach plan 😂'),
      m(1, B, 'beach beach 😂❤️'),
      m(2, A, '', { kind: 'drop', dropId: 'd1' }),
      m(3, B, '', { kind: 'photo', photoPath: 'p/1.jpg' }),
      m(30, A, 'next day 🌴', { tabId: 'trip' }),
      m(31, B, 'yes', { tabId: 'trip' }),
      m(32, B, 'gone', { deleted: true }),
      m(500, A, 'outside the period'),
    ];
    const s = computeRewind(msgs, { from: t0, to: t0 + 100 * h, label: 'April' }, A, B, { d1: 'poll' }, 'UTC');
    expect(s.total).toBe(6);
    expect(s.perPerson).toEqual({ [A]: 3, [B]: 3 });
    expect(s.topEmojis[0]).toEqual({ emoji: '😂', n: 2 });
    expect(s.topWords[0]).toEqual({ word: 'beach', n: 3 });
    expect(s.drops).toBe(1);
    expect(s.topDrop).toEqual({ type: 'poll', n: 1 });
    expect(s.photos).toEqual(['p/1.jpg']);
    expect(s.longestRun).toBe(2);
    expect(s.busiestDay).toEqual({ key: '2026-04-01', n: 4 });
    expect(s.first?.text).toBe('first beach plan 😂');
    expect(s.topTab).toEqual({ tabId: 'general', n: 4 });
    expect(s.biggestGapMs).toBe(27 * h);
    expect(gapLabel(s.biggestGapMs)).toBe('27 hours');
  });
  it('builds month and year periods in the room zone', () => {
    const now = Date.parse('2026-01-10T12:00:00Z');
    expect(rewindPeriod('last-month', now, 'UTC').label).toBe('December 2025');
    const p = rewindPeriod('this-month', now, 'UTC');
    expect(p.label).toBe('January so far');
    expect(new Date(p.from).toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(rewindPeriod('this-year', now, 'UTC').label).toBe('2026');
  });
});
