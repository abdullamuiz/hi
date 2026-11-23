/**
 * Colour themes. Each theme overrides the CSS custom properties declared in
 * src/styles.css (":root" there is the "Hi" theme). Chosen per person; saved on
 * this device and in users/{uid} so it follows you to other devices.
 */
export type ThemeId = 'hi' | 'dark' | 'system' | 'classic' | 'blossom' | 'forest';
export type Mode = 'light' | 'dark';

type Tokens = Record<string, string>;

const HI: Tokens = {}; // the defaults in styles.css

const CLASSIC: Tokens = {
  '--me': '#2F5BEA', '--on-me': '#FFFFFF', '--me-dark': '#1E3FB0',
  '--them': '#F2A15F', '--on-them': '#16181D',
  '--ink': '#16181D', '--on-ink': '#FFFFFF',
  '--ground': '#F5F6FA', '--surface': '#FFFFFF',
  '--line': '#E3E5EC', '--line-2': '#DADDE5', '--hair': '#EEF0F4', '--soft': '#F7F8FB', '--pill': '#E9EBF1',
  '--muted': '#5B606B', '--body-2': '#3A3E47',
  '--their-bubble': '#FFF1E4', '--note-bg': '#FFF4EA', '--note-fg': '#6B4A2E',
  '--media': '#1C2233', '--chip-bg': '#F0F1F5', '--sel-bg': '#EEF2FE',
  '--reveal-ink': '#B9C6F7', '--bar-soft': '#9AA0AD',
  '--desk': '#E9EBF1', '--photo-bg': '#DCE6F5',
};

/** Hi Dark: the navy ground with alabaster text and the teal accent. */
const DARK: Tokens = {
  '--me': '#54B5C6', '--on-me': '#1B2036', '--me-dark': '#7FCAD7',
  '--them': '#F2EFE6', '--on-them': '#252C48',
  '--ink': '#F2EFE6', '--on-ink': '#252C48',
  '--ground': '#252C48', '--surface': '#2E365A',
  '--line': '#3C4569', '--line-2': '#4A5479', '--hair': '#353E62', '--soft': '#2A3254', '--pill': '#353E62',
  '--muted': '#AEB4C8', '--body-2': '#D9DCE6',
  '--their-bubble': '#3A4470', '--note-bg': '#33406A', '--note-fg': '#BFE6EE',
  '--media': '#1B2036', '--chip-bg': '#353E62', '--sel-bg': '#2F4A66',
  '--reveal-ink': '#1E7F93', '--bar-soft': '#7E86A3',
  '--sun': '#F2B45F', '--cloud': '#D9DCE6', '--storm': '#B7BCFF',
  '--desk': '#1B2036', '--photo-bg': '#34406A',
};

const BLOSSOM: Tokens = {
  '--me': '#B83F72', '--on-me': '#FFFFFF', '--me-dark': '#8E2C57',
  '--them': '#E9A23B', '--on-them': '#2B1E2A',
  '--ink': '#2B1E2A', '--on-ink': '#FFFFFF',
  '--ground': '#FBF3F1', '--surface': '#FFFFFF',
  '--line': '#F0DDDA', '--line-2': '#E6CCC8', '--hair': '#F5E8E6', '--soft': '#FDF8F7', '--pill': '#F3E3E0',
  '--muted': '#6E5D66', '--body-2': '#4A3A45',
  '--their-bubble': '#FCEBD6', '--note-bg': '#FDF0E1', '--note-fg': '#7A4B1C',
  '--media': '#3A2433', '--chip-bg': '#F6EAE8', '--sel-bg': '#FBE6EF',
  '--reveal-ink': '#F4B7CF', '--bar-soft': '#B9A6AF',
  '--desk': '#F1E2DF', '--photo-bg': '#F6E1E6',
};

const FOREST: Tokens = {
  '--me': '#2F6B4F', '--on-me': '#FFFFFF', '--me-dark': '#1F4B37',
  '--them': '#E0A23E', '--on-them': '#1D2B24',
  '--ink': '#1D2B24', '--on-ink': '#FFFFFF',
  '--ground': '#F1F4EF', '--surface': '#FFFFFF',
  '--line': '#DCE3D8', '--line-2': '#CDD6C8', '--hair': '#E7ECE4', '--soft': '#F7F9F5', '--pill': '#E2E8DE',
  '--muted': '#5A6660', '--body-2': '#38443E',
  '--their-bubble': '#FBEFD9', '--note-bg': '#FBF1DE', '--note-fg': '#6E4A12',
  '--media': '#1D2B24', '--chip-bg': '#E9EEE6', '--sel-bg': '#E2F0E8',
  '--reveal-ink': '#A8D8BE', '--bar-soft': '#A3ADA7',
  '--desk': '#E2E8DE', '--photo-bg': '#DDE8DE',
};

export interface Theme {
  id: ThemeId;
  label: string;
  desc: string;
  /** Swatch colours for the picker: [ground, me, them]. */
  swatch: [string, string, string];
}

export const THEMES: Theme[] = [
  { id: 'hi', label: 'Hi Light', desc: 'Alabaster with navy and teal', swatch: ['#F2EFE6', '#252C48', '#54B5C6'] },
  { id: 'dark', label: 'Hi Dark', desc: 'Navy with alabaster and teal', swatch: ['#252C48', '#F2EFE6', '#54B5C6'] },
  { id: 'system', label: 'Match my phone', desc: 'Hi Light or Hi Dark, following your phone', swatch: ['#F2EFE6', '#252C48', '#54B5C6'] },
  { id: 'classic', label: 'Classic', desc: 'The original blue and orange', swatch: ['#F5F6FA', '#2F5BEA', '#F2A15F'] },
  { id: 'blossom', label: 'Blossom', desc: 'Rose and marigold', swatch: ['#FBF3F1', '#B83F72', '#E9A23B'] },
  { id: 'forest', label: 'Forest', desc: 'Pine green and amber', swatch: ['#F1F4EF', '#2F6B4F', '#E0A23E'] },
];

const TOKENS: Record<Exclude<ThemeId, 'system'>, Tokens> = {
  hi: HI, dark: DARK, classic: CLASSIC, blossom: BLOSSOM, forest: FOREST,
};
const DARK_THEMES = new Set<string>(['dark']);

const KEY = 'hi.theme';
const dark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

export function isThemeId(x: unknown): x is ThemeId {
  return typeof x === 'string' && THEMES.some((t) => t.id === x);
}

/** Accepts ids saved by older versions ("midnight" became "dark"). */
export function normaliseTheme(x: unknown): ThemeId | null {
  if (x === 'midnight') return 'dark';
  return isThemeId(x) ? x : null;
}

export function savedTheme(): ThemeId {
  try {
    const v = normaliseTheme(localStorage.getItem(KEY));
    if (v) return v;
  } catch { /* ignore */ }
  return 'hi';
}

let current: ThemeId = 'hi';
let applied: Tokens = {};
const listeners = new Set<(id: ThemeId, mode: Mode) => void>();

/** Light or dark, after resolving "Match my phone". */
export function currentMode(): Mode {
  return document.documentElement.dataset.mode === 'dark' ? 'dark' : 'light';
}

/** Called whenever the theme changes (e.g. to keep a toggle button in sync). */
export function onThemeChange(fn: (id: ThemeId, mode: Mode) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** The light/dark switch: Hi Light ↔ Hi Dark. */
export const toggledTheme = (): ThemeId => (currentMode() === 'dark' ? 'hi' : 'dark');

/** Resolve "system" to a concrete palette and write it onto <html>. */
export function applyTheme(id: ThemeId, persist = true) {
  current = id;
  const concrete = id === 'system' ? (dark() ? 'dark' : 'hi') : id;
  const mode: Mode = DARK_THEMES.has(concrete) ? 'dark' : 'light';
  const tokens = TOKENS[concrete];
  const root = document.documentElement;
  Object.keys(applied).forEach((k) => root.style.removeProperty(k));
  Object.entries(tokens).forEach(([k, v]) => root.style.setProperty(k, v));
  applied = tokens;
  root.dataset.theme = concrete;
  root.dataset.mode = mode;
  root.style.colorScheme = mode;
  const surface = tokens['--surface'] || '#FFFFFF';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', surface);
  // Browser-tab icon follows the app's mode: teal bubble in light, navy in dark.
  document.querySelector('link[rel="icon"][type="image/svg+xml"]')
    ?.setAttribute('href', mode === 'dark' ? './icons/favicon-navy.svg' : './icons/favicon-teal.svg');
  if (persist) { try { localStorage.setItem(KEY, id); } catch { /* ignore */ } }
  listeners.forEach((fn) => fn(id, mode));
}

export const currentTheme = () => current;

/** Call once at start-up, before the first render, to avoid a flash of the wrong colours. */
export function initTheme() {
  applyTheme(savedTheme(), false);
  if (typeof matchMedia === 'function') {
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
      if (current === 'system') applyTheme('system', false);
    });
  }
}
