import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { THEMES, isThemeId } from '../../src/lib/themes';

describe('themes', () => {
  it('only override colour tokens that exist in styles.css', async () => {
    const css = readFileSync('src/styles.css', 'utf8');
    const declared = new Set([...css.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]));
    const src = readFileSync('src/lib/themes.ts', 'utf8');
    for (const [, token] of src.matchAll(/'(--[a-z0-9-]+)':/g)) expect(declared.has(token), token).toBe(true);
  });
  it('lists unique, valid ids with the Hi theme first', () => {
    expect(THEMES[0].id).toBe('hi');
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    THEMES.forEach((t) => expect(isThemeId(t.id)).toBe(true));
    expect(isThemeId('neon')).toBe(false);
  });
});
