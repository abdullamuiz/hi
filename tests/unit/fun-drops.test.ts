import { describe, expect, it } from 'vitest';
import { knowTier, sliceAt, spottedLie, wheelLanding, wheelPick } from '../../src/drops/logic';
import { DARES, TRUTHS } from '../../src/drops/deck';

describe('Decision Wheel spin', () => {
  const ids = ['a1', 'b2', 'c3', 'd4', 'e5'];
  const index = wheelPick(ids);

  it('lands on the picked slice, identically on both phones', () => {
    const deg = wheelLanding(ids, index);
    expect(wheelLanding([...ids], index)).toBe(deg);
    expect(sliceAt(deg, ids.length)).toBe(index);
    expect(deg).toBeGreaterThan(4 * 360); // several full turns
  });

  it('works for every slice and wheel size', () => {
    for (let n = 2; n <= 12; n++) {
      const list = Array.from({ length: n }, (_, i) => `opt${n}-${i}`);
      for (let i = 0; i < n; i++) expect(sliceAt(wheelLanding(list, i), n)).toBe(i);
    }
  });
});

describe('Two Truths & a Lie', () => {
  it('spots the lie only with a matching guess', () => {
    expect(spottedLie(1, 1)).toBe(true);
    expect(spottedLie(1, 2)).toBe(false);
    expect(spottedLie(null, 1)).toBe(false);
  });
});

describe('Predict Me tiers', () => {
  it('names each band', () => {
    expect(knowTier(100).label).toBe('Mind reader');
    expect(knowTier(50).label).toBe('Getting there');
    expect(knowTier(0).emoji).toBe('🙈');
  });
});

describe('Truth or Dare deck', () => {
  it('has plenty of short, unique prompts', () => {
    for (const list of [TRUTHS, DARES]) {
      expect(list.length).toBeGreaterThanOrEqual(35);
      expect(new Set(list).size).toBe(list.length);
      for (const s of list) { expect(s.length).toBeGreaterThan(8); expect(s.length).toBeLessThanOrEqual(200); }
    }
  });
});
