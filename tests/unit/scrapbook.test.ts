import { describe, expect, it } from 'vitest';
import { activeCountdowns, countdownText, kindOf, matchesFilter, moveOrder, orderBetween, orderOf, sortScraps, topOrder } from '../../src/lib/scrapbook';

const ts = (ms: number) => ({ toMillis: () => ms }) as any;
const p = (id: string, order?: number, created = 0) => ({ id, order, createdAt: ts(created) });

describe('scrapbook board order', () => {
  it('older pins without an order fall back to their creation time', () => {
    expect(orderOf(p('a', undefined, 1234))).toBe(1234);
    expect(orderOf(p('a', 5, 1234))).toBe(5);
  });

  it('sorts highest first', () => {
    expect(sortScraps([p('a', 1), p('b', 3), p('c', 2)]).map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('a new pin goes on top', () => {
    expect(topOrder([p('a', 10), p('b', 5)], 3)).toBe(11);
    expect(topOrder([], 99)).toBe(99);
  });

  it('places between neighbours, or steps past the ends', () => {
    expect(orderBetween(10, 6)).toBe(8);
    expect(orderBetween(null, 6)).toBe(6 + 1024);
    expect(orderBetween(10, null)).toBe(10 - 1024);
    expect(orderBetween(null, null)).toBe(0);
  });

  it('moving an item gives one new value that sorts it into place', () => {
    const list = sortScraps([p('a', 40), p('b', 30), p('c', 20), p('d', 10)]); // a b c d
    const v = moveOrder(list, 'd', 1)!; // between a and b
    expect(v).toBe(35);
    const next = sortScraps(list.map((x) => (x.id === 'd' ? { ...x, order: v } : x))).map((x) => x.id);
    expect(next).toEqual(['a', 'd', 'b', 'c']);
    expect(moveOrder(list, 'a', 3)).toBe(10 - 1024); // to the bottom
    expect(moveOrder(list, 'c', 0)).toBe(40 + 1024); // to the top
    expect(moveOrder(list, 'b', 1)).toBeNull(); // no move
  });

  it('kinds and filters work for old pins too', () => {
    expect(kindOf({ dropId: 'd', messageId: null })).toBe('drop');
    expect(kindOf({ dropId: null, messageId: 'm' })).toBe('message');
    expect(kindOf({ kind: 'photo', dropId: null, messageId: 'm' })).toBe('photo');
    expect(matchesFilter({ kind: 'note', dropId: null, messageId: null }, 'note')).toBe(true);
    expect(matchesFilter({ dropId: 'd', messageId: null }, 'message')).toBe(false);
    expect(matchesFilter({ dropId: 'd', messageId: null }, 'all')).toBe(true);
  });
});

describe('countdown banner', () => {
  it('formats the time left', () => {
    const s = 1000, m = 60 * s, h = 60 * m, d = 24 * h;
    expect(countdownText(12 * d + 4 * h + 33 * m + 20 * s)).toBe('12d 4h 33m');
    expect(countdownText(4 * h + 3 * m)).toBe('4h 03m');
    expect(countdownText(2 * m + 5 * s)).toBe('2m 05s');
    expect(countdownText(0)).toBe('0s');
    expect(countdownText(-5)).toBe('0s');
  });

  it('shows upcoming countdowns (and for a day after), soonest first, minus dismissed', () => {
    const now = 1_000_000_000;
    const list = [
      { dropId: 'later', title: 'Trip', atMs: now + 10_000 },
      { dropId: 'soon', title: 'Party', atMs: now + 1_000 },
      { dropId: 'today', title: 'Gig', atMs: now - 3_600_000 },
      { dropId: 'old', title: 'Past', atMs: now - 2 * 86_400_000 },
      { dropId: 'bad', title: 'No date', atMs: NaN },
    ];
    expect(activeCountdowns(list, now).map((c) => c.dropId)).toEqual(['today', 'soon', 'later']);
    expect(activeCountdowns(list, now, new Set(['today'])).map((c) => c.dropId)).toEqual(['soon', 'later']);
  });
});
