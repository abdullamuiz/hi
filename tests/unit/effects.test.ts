import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ARRIVAL_WINDOW_MS, EFFECTS, effectDef, isEffect, pickArrival, previewFor, suggestEffect } from '../../src/lib/effects';

describe('effect list', () => {
  it('has the SPEC screen and bubble effects, and matches the rules allowlist', () => {
    expect(EFFECTS.filter((e) => e.kind === 'screen').map((e) => e.code)).toEqual(['confetti', 'balloons', 'fireworks', 'glow']);
    expect(EFFECTS.filter((e) => e.kind === 'bubble').map((e) => e.code)).toEqual(['shout', 'whisper', 'slow', 'spotlight', 'sealed', 'echo']);
    const rules = readFileSync('firestore.rules', 'utf8');
    const list = rules.match(/incoming\(\)\.effect in \[([^\]]+)\]/)![1];
    const codes = [...list.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(new Set(codes)).toEqual(new Set(EFFECTS.map((e) => e.code)));
  });

  it('looks effects up safely', () => {
    expect(effectDef('confetti')?.label).toBe('Confetti');
    expect(effectDef('nope')).toBeNull();
    expect(effectDef(undefined)).toBeNull();
    expect(isEffect('sealed')).toBe(true);
    expect(isEffect('Sealed')).toBe(false);
    expect(isEffect(3)).toBe(false);
  });

  it('keeps sealed and whispered text out of previews', () => {
    expect(previewFor('secret', 'sealed')).toBe('✉️ Sealed message');
    expect(previewFor('secret', 'whisper')).toBe('🤫 Whisper');
    expect(previewFor('yay', 'confetti')).toBe('yay');
    expect(previewFor('yay', null)).toBe('yay');
  });
});

describe('keyword suggestions', () => {
  it('suggests the matching effect', () => {
    expect(suggestEffect('Happy birthday!!')).toBe('balloons');
    expect(suggestEffect('omg CONGRATS 🎉')).toBe('confetti');
    expect(suggestEffect('Congratulations on the job')).toBe('confetti');
    expect(suggestEffect('well   done you')).toBe('confetti');
    expect(suggestEffect('thank you so much')).toBe('glow');
    expect(suggestEffect('Happy New Year from Malé')).toBe('fireworks');
  });

  it('only matches whole words and ignores accents and case', () => {
    expect(suggestEffect('congratsulations')).toBeNull();
    expect(suggestEffect('unthank you')).toBeNull();
    expect(suggestEffect('Mabroük')).toBe('confetti');
    expect(suggestEffect('see you tomorrow')).toBeNull();
    expect(suggestEffect('')).toBeNull();
    expect(suggestEffect('hb')).toBeNull();
  });
});

describe('playing on arrival', () => {
  const now = 1_000_000_000;
  it('plays the newest fresh, unplayed effect and marks every fresh one', () => {
    const items = [
      { id: 'a', effect: 'confetti' as const, createdMs: now - 5000 },
      { id: 'b', effect: 'balloons' as const, createdMs: now - 1000 },
      { id: 'c', effect: 'glow' as const, createdMs: now - ARRIVAL_WINDOW_MS - 1 },
    ];
    const r = pickArrival(items, new Set(), now);
    expect(r.play?.id).toBe('b');
    expect(r.mark.sort()).toEqual(['a', 'b']);
  });

  it('never replays what this device already played', () => {
    const items = [{ id: 'a', effect: 'confetti' as const, createdMs: now }];
    expect(pickArrival(items, new Set(['a']), now)).toEqual({ play: null, mark: [] });
  });

  it('old messages only play when tapped', () => {
    const items = [{ id: 'old', effect: 'fireworks' as const, createdMs: now - ARRIVAL_WINDOW_MS - 10 }];
    expect(pickArrival(items, new Set(), now).play).toBeNull();
  });
});
