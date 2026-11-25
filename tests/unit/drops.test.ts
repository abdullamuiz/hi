import { describe, expect, it, vi } from 'vitest';

// The registry uses Vite's import.meta.glob; under Vitest that works natively.
vi.mock('firebase/firestore', () => ({}));

describe('Drop registry', async () => {
  const { drops, getDrop, withDefaults } = await import('../../src/drops/registry');

  it('discovers every built-in Drop in tray order', () => {
    expect(drops.map((d) => d.type)).toEqual([
      'feeling-map', 'blind-reveal', 'gap-slider', 'tag-team-story', 'two-truths', 'predict-me', 'rank-it',
      'decision-wheel', 'watch-party', 'countdown', 'poll', 'this-or-that', 'time-capsule', 'mood-check', 'daily-question',
    ]);
    // The daily question is dropped by the app, not from the tray.
    expect(drops.filter((d) => d.hidden).map((d) => d.type)).toEqual(['daily-question']);
  });

  it('every Drop can describe itself for the scrapbook before anyone answers', () => {
    const p = { uid: 'a', name: 'A', isMe: true };
    const q = { uid: 'b', name: 'B', isMe: false };
    const api: any = {
      me: p, partner: q, createdBy: p,
      mine: () => undefined, theirs: () => undefined, iLocked: () => false, theyLocked: () => false, revealed: () => false,
      entries: [], myProgress: {}, theirProgress: {},
    };
    for (const d of drops) {
      const content = d.prepare ? d.prepare({ ...d.content, date: '2099-01-02', openOn: '2099-01-02' } as any) : d.content;
      expect(typeof content, d.type).toBe('object');
      expect(typeof d.pinDetail(content, api), d.type).toBe('string');
    }
  });

  it('date Drops refuse dates in the past', () => {
    const cap = getDrop('time-capsule')!;
    expect(cap.prepare!({ openOn: '2000-01-01', openAtMs: 0 })).toBe('Pick a date after today.');
    const ok = cap.prepare!({ openOn: '2099-03-04', openAtMs: 0 }) as any;
    expect(new Date(ok.openAtMs).getDate()).toBe(4);
    const cd = getDrop('countdown')!;
    expect(cd.prepare!({ title: 'x', date: 'nope', atMs: 0 })).toBe('Pick a date.');
  });

  it('every Drop has a valid definition', () => {
    for (const d of drops) {
      expect(d.type).toMatch(/^[a-z0-9-]{1,40}$/);
      expect(d.title).toBeTruthy();
      expect(d.trayDescription).toBeTruthy();
      expect(typeof d.Renderer).toBe('function');
      expect(typeof d.subtitle(d.content)).toBe('string');
      for (const f of d.setup || []) expect(f.key in d.content).toBe(true);
      // Content must be plain JSON: it is stored in Firestore as-is.
      expect(JSON.parse(JSON.stringify(d.content))).toEqual(d.content);
    }
  });

  it('fills missing content from defaults', () => {
    const gap = getDrop('gap-slider')!;
    expect(withDefaults(gap, { question: 'Pineapple on pizza?' })).toEqual({
      question: 'Pineapple on pizza?', left: 'Not at all', right: 'Every minute',
    });
  });

  it('seeds the story with its opening line', () => {
    const story = getDrop('tag-team-story')!;
    expect(story.initialEntries!({ opening: '  Once.  ', maxLines: 8 })).toEqual(['Once.']);
  });
});
