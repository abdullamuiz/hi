import { describe, expect, it, vi } from 'vitest';

// The registry uses Vite's import.meta.glob; under Vitest that works natively.
vi.mock('firebase/firestore', () => ({}));

describe('Drop registry', async () => {
  const { drops, getDrop, withDefaults } = await import('../../src/drops/registry');

  it('discovers all four built-in Drops in tray order', () => {
    expect(drops.map((d) => d.type)).toEqual(['feeling-map', 'blind-reveal', 'gap-slider', 'tag-team-story']);
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
