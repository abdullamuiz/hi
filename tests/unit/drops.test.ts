import { describe, expect, it, vi } from 'vitest';

// The registry uses Vite's import.meta.glob; under Vitest that works natively.
vi.mock('firebase/firestore', () => ({}));

describe('Drop registry', async () => {
  const { drops, getDrop, withDefaults } = await import('../../src/drops/registry');

  it('discovers every built-in Drop in tray order', () => {
    expect(drops.map((d) => d.type)).toEqual([
      'feeling-map', 'blind-reveal', 'gap-slider', 'tag-team-story', 'two-truths', 'truth-or-dare', 'predict-me', 'rank-it',
      'decision-wheel', 'watch-party', 'countdown', 'rewind', 'poll', 'this-or-that', 'time-capsule', 'mood-check', 'daily-question',
      'session',
    ]);
    // The daily question is dropped by the app; Sessions have their own tray section.
    expect(drops.filter((d) => d.hidden).map((d) => d.type)).toEqual(['daily-question', 'session']);
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
      for (const f of d.setup || []) {
        // A secret pick isn't stored in content; the fields it picks among are.
        if (f.kind === 'secret') { expect(f.key in d.content).toBe(false); f.from.forEach((k) => expect(k in d.content).toBe(true)); }
        else expect(f.key in d.content).toBe(true);
      }
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

describe('Rewind Drop', async () => {
  const { getDrop } = await import('../../src/drops/registry');
  it('recaps last month early in a month, otherwise this month so far', () => {
    const def = getDrop('rewind')!;
    const c = def.prepare!({ ...def.content }) as any;
    expect(c.to).toBeGreaterThan(c.from);
    expect(c.label).toMatch(/^[A-Z][a-z]+( so far| \d{4})?$/);
    expect(c.auto).toBe(false);
    expect(def.pinDetail(c, {} as any)).toBe(`${c.label} recap`);
  });
});

describe('Notes to self tray', () => {
  it('offers only solo Drops in Notes to self, and every visible Drop elsewhere', async () => {
    const { drops, trayDrops } = await import('../../src/drops/registry');
    const solo = trayDrops(drops, true).map((d) => d.type).sort();
    expect(solo).toEqual(['countdown', 'decision-wheel', 'time-capsule']);
    expect(trayDrops(drops, false).length).toBe(drops.filter((d) => !d.hidden).length);
    // Nothing hidden ever shows, and no hidden-answer game is offered alone.
    expect(trayDrops(drops, true).some((d) => d.hidden)).toBe(false);
    expect(solo).not.toContain('blind-reveal');
  });
});
