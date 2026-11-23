/**
 * Colour themes. Each theme overrides the CSS custom properties declared in
 * src/styles.css (":root" there is the "Hi" theme). Chosen per person; saved on
 * this device and in users/{uid} so it follows you to other devices.
 */
export type ThemeId = 'hi' | 'system' | 'classic' | 'midnight' | 'blossom' | 'forest';

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

const MIDNIGHT: Tokens = {
  '--me': '#4BB4CB', '--on-me': '#0F1320', '--me-dark': '#7FD0E0',
  '--them': '#F2A15F', '--on-them': '#0F1320',
  '--ink': '#EEF1F7', '--on-ink': '#0F1320',
  '--ground': '#0F1320', '--surface': '#182033',
  '--line': '#2A3450', '--line-2': '#36425F', '--hair': '#232C44', '--soft': '#1E2740', '--pill': '#232C44',
  '--muted': '#9AA3B8', '--body-2': '#C7CEDD',
  '--their-bubble': '#26304A', '--note-bg': '#2B2A2A', '--note-fg': '#F2C79A',
  '--media': '#0B0E18', '--chip-bg': '#232C44', '--sel-bg': '#1C3346',
  '--reveal-ink': '#0F5566', '--bar-soft': '#5B657D',
  '--sun': '#F2B45F', '--cloud': '#C7CEDD', '--storm': '#A9B0FF',
  '--desk': '#0A0D16', '--photo-bg': '#222B42',
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
  { id: 'hi', label: 'Hi', desc: 'Navy, teal and alabaster', swatch: ['#F4F1E8', '#232B47', '#36AFC6'] },
  { id: 'system', label: 'Match my phone', desc: 'Hi by day, Midnight in dark mode', swatch: ['#F4F1E8', '#0F1320', '#36AFC6'] },
  { id: 'midnight', label: 'Midnight', desc: 'Dark, easy on the eyes', swatch: ['#0F1320', '#4BB4CB', '#F2A15F'] },
  { id: 'classic', label: 'Classic', desc: 'The original blue and orange', swatch: ['#F5F6FA', '#2F5BEA', '#F2A15F'] },
  { id: 'blossom', label: 'Blossom', desc: 'Rose and marigold', swatch: ['#FBF3F1', '#B83F72', '#E9A23B'] },
  { id: 'forest', label: 'Forest', desc: 'Pine green and amber', swatch: ['#F1F4EF', '#2F6B4F', '#E0A23E'] },
];

const TOKENS: Record<Exclude<ThemeId, 'system'>, Tokens> = {
  hi: HI, classic: CLASSIC, midnight: MIDNIGHT, blossom: BLOSSOM, forest: FOREST,
};

const KEY = 'hi.theme';
const dark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

export function isThemeId(x: unknown): x is ThemeId {
  return typeof x === 'string' && THEMES.some((t) => t.id === x);
}

export function savedTheme(): ThemeId {
  try {
    const v = localStorage.getItem(KEY);
    if (isThemeId(v)) return v;
  } catch { /* ignore */ }
  return 'hi';
}

let current: ThemeId = 'hi';
let applied: Tokens = {};

/** Resolve "system" to a concrete palette and write it onto <html>. */
export function applyTheme(id: ThemeId, persist = true) {
  current = id;
  const concrete = id === 'system' ? (dark() ? 'midnight' : 'hi') : id;
  const tokens = TOKENS[concrete];
  const root = document.documentElement;
  Object.keys(applied).forEach((k) => root.style.removeProperty(k));
  Object.entries(tokens).forEach(([k, v]) => root.style.setProperty(k, v));
  applied = tokens;
  root.dataset.theme = concrete;
  root.style.colorScheme = concrete === 'midnight' ? 'dark' : 'light';
  const surface = tokens['--surface'] || '#FFFFFF';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', surface);
  if (persist) { try { localStorage.setItem(KEY, id); } catch { /* ignore */ } }
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
