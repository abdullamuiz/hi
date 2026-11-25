import { beforeEach, describe, expect, it } from 'vitest';
import { cachedUrl, evictedBetween, evictMedia, isOncePath, mediaPathsOf, rememberUrl, trimLru } from '../../src/lib/mediaCache';

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};

describe('trimLru', () => {
  it('keeps the most recently used', () => {
    const { kept, dropped } = trimLru({ a: ['1', 1], b: ['2', 3], c: ['3', 2] } as Record<string, [string, number]>, 2);
    expect(Object.keys(kept).sort()).toEqual(['b', 'c']);
    expect(dropped).toEqual(['a']);
  });
  it('leaves small maps alone', () => {
    const m = { a: ['1', 1] } as Record<string, [string, number]>;
    expect(trimLru(m, 5)).toEqual({ kept: m, dropped: [] });
  });
});

describe('URL cache', () => {
  beforeEach(() => store.clear());
  it('remembers and forgets addresses', async () => {
    rememberUrl('rooms/r/photos/a/p.jpg', 'https://x/p');
    expect(cachedUrl('rooms/r/photos/a/p.jpg')).toBe('https://x/p');
    await evictMedia(['rooms/r/photos/a/p.jpg']);
    expect(cachedUrl('rooms/r/photos/a/p.jpg')).toBeNull();
  });
  it('never keeps view-once photos', () => {
    expect(isOncePath('rooms/r/once/a/t/m.jpg')).toBe(true);
    expect(isOncePath('rooms/r/photos/a/m.jpg')).toBe(false);
    rememberUrl('rooms/r/once/a/t/m.jpg', 'https://x/once');
    expect(cachedUrl('rooms/r/once/a/t/m.jpg')).toBeNull();
  });
});

describe('evictedBetween', () => {
  const ts = (ms: number) => ({ toMillis: () => ms });
  const photo = { path: 'p.jpg', thumbPath: 'p_t.jpg' };
  it('lists every media path of a message', () => {
    expect(mediaPathsOf({ photo, voice: { path: 'v.webm' } })).toEqual(['p.jpg', 'p_t.jpg', 'v.webm']);
  });
  it('forgets on delete for everyone, delete for me and a used-up view-once', async () => {
    const { seenOf } = await import('../../src/lib/mediaCache');
    const before = seenOf([{ id: 'a', photo }, { id: 'b', photo: { path: 'q.jpg' } }, { id: 'c', photo: { path: 'o.jpg' } }], 'me');
    const after = seenOf([{ id: 'a' }, { id: 'b', photo: { path: 'q.jpg' }, hiddenFor: ['me'] }, { id: 'c', photo: {} as any }], 'me');
    expect(evictedBetween(before, after).sort()).toEqual(['o.jpg', 'p.jpg', 'p_t.jpg', 'q.jpg']);
  });
  it('forgets expired messages but not ones that scrolled out of the window', async () => {
    const { seenOf } = await import('../../src/lib/mediaCache');
    const now = 1_000_000;
    const before = seenOf([{ id: 'old', photo: { path: 'old.jpg' } }, { id: 'gone', photo: { path: 'gone.jpg' }, expiresAt: ts(now - 1) }], 'me');
    expect(evictedBetween(before, new Map(), now)).toEqual(['gone.jpg']);
  });
});
