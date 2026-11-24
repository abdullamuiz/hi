import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MODES, PALETTES, normalisePrefs } from '../../src/lib/themes';

describe('themes', () => {
  it('only override colour tokens that exist in styles.css', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    const declared = new Set([...css.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]));
    const src = readFileSync('src/lib/themes.ts', 'utf8');
    for (const [, token] of src.matchAll(/'(--[a-z0-9-]+)':/g)) expect(declared.has(token), token).toBe(true);
  });

  it('every palette has a light and a dark version, Hi first', () => {
    expect(PALETTES.map((p) => p.id)).toEqual(['hi', 'classic', 'blossom', 'forest']);
    expect(MODES.map((m) => m.id)).toEqual(['light', 'dark', 'system']);
    const src = readFileSync('src/lib/themes.ts', 'utf8');
    for (const p of PALETTES) expect(src).toMatch(new RegExp(`${p.id}: \\{ light: \\w+, dark: \\w+ \\}`));
  });

  it('reads older saved themes', () => {
    expect(normalisePrefs('midnight')).toEqual({ palette: 'hi', mode: 'dark' });
    expect(normalisePrefs('dark')).toEqual({ palette: 'hi', mode: 'dark' });
    expect(normalisePrefs('system')).toEqual({ palette: 'hi', mode: 'system' });
    expect(normalisePrefs('forest')).toEqual({ palette: 'forest', mode: 'light' });
    expect(normalisePrefs({ palette: 'blossom', mode: 'dark' })).toEqual({ palette: 'blossom', mode: 'dark' });
    expect(normalisePrefs({ palette: 'neon', mode: 'dark' })).toBeNull();
    expect(normalisePrefs('neon')).toBeNull();
  });
});
