import { describe, expect, it } from 'vitest';
import { findLink } from '../../src/lib/links';
import { fitWithin } from '../../src/lib/image';
import { dayLabel, lastSeenLabel } from '../../src/lib/time';
import { firstName, initial } from '../../src/lib/names';

describe('findLink', () => {
  it('finds a URL, its domain and the remaining text', () => {
    expect(findLink('Rewatching this https://www.youtube.com/watch?v=abc before we talk')).toEqual({
      url: 'https://www.youtube.com/watch?v=abc', domain: 'youtube.com', isVideo: true, rest: 'Rewatching this before we talk',
    });
  });
  it('normalises www. links and trims trailing punctuation', () => {
    const l = findLink('see www.example.com/page.');
    expect(l?.url).toBe('https://www.example.com/page');
    expect(l?.isVideo).toBe(false);
  });
  it('returns null for plain text', () => {
    expect(findLink('no links here')).toBeNull();
  });
});

describe('fitWithin', () => {
  it('scales the long side to 1600 and keeps aspect', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 6000)).toEqual({ width: 800, height: 1600 });
  });
  it('never upscales', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe('time labels', () => {
  const now = new Date(2026, 10, 23, 15, 0).getTime();
  it('labels days', () => {
    expect(dayLabel(now - 60_000, now)).toBe('Today');
    expect(dayLabel(now - 86_400_000, now)).toBe('Yesterday');
  });
  it('labels presence', () => {
    expect(lastSeenLabel(now - 30_000, now)).toBe('online');
    expect(lastSeenLabel(now - 10 * 60_000, now)).toBe('seen 10m ago');
    expect(lastSeenLabel(null, now)).toBe('offline');
  });
});

describe('names', () => {
  it('uses the first name or the e-mail local part', () => {
    expect(firstName('Sam Rivera')).toBe('Sam');
    expect(firstName('alex@example.com')).toBe('alex');
    expect(firstName('', 'Them')).toBe('Them');
    expect(initial('bob')).toBe('B');
  });
});
