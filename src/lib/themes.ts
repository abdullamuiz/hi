/**
 * Colour themes = a palette (Hi, Classic, Blossom, Forest) x a mode (light / dark / match phone).
 * Each palette has a light and a dark token set that override the CSS custom properties
 * declared in src/styles.css (":root" there is Hi Light). Chosen per person; saved on this
 * device and in users/{uid} so it follows you to other devices.
 */
export type Palette = 'hi' | 'classic' | 'blossom' | 'forest';
export type ModePref = 'light' | 'dark' | 'system';
export type Mode = 'light' | 'dark';
export interface ThemePrefs { palette: Palette; mode: ModePref }

type Tokens = Record<string, string>;

const HI_LIGHT: Tokens = {}; // the defaults in styles.css

const CLASSIC_LIGHT: Tokens = {
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
const HI_DARK: Tokens = {
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

const CLASSIC_DARK: Tokens = {
  '--me': '#6E8DF2', '--on-me': '#0E1220', '--me-dark': '#9AB0F6',
  '--them': '#F2A15F', '--on-them': '#16181D',
  '--ink': '#EEF0F5', '--on-ink': '#12151C',
  '--ground': '#12151C', '--surface': '#1C2029',
  '--line': '#2A2F3B', '--line-2': '#363C4A', '--hair': '#232833', '--soft': '#1A1E27', '--pill': '#252A35',
  '--muted': '#9DA3B0', '--body-2': '#CDD1DA',
  '--their-bubble': '#3A2E24', '--note-bg': '#3A2E24', '--note-fg': '#F5C89E',
  '--media': '#0D1016', '--chip-bg': '#252A35', '--sel-bg': '#1E2A4A',
  '--reveal-ink': '#2F5BEA', '--bar-soft': '#5F6675',
  '--sun': '#F2B45F', '--cloud': '#CDD1DA', '--storm': '#A9B0FF',
  '--desk': '#0B0D12', '--photo-bg': '#243047',
};

const BLOSSOM_LIGHT: Tokens = {
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

const BLOSSOM_DARK: Tokens = {
  '--me': '#E07AA5', '--on-me': '#1E1419', '--me-dark': '#EBA0C0',
  '--them': '#E9A23B', '--on-them': '#1E1419',
  '--ink': '#F8EEF2', '--on-ink': '#1E1419',
  '--ground': '#1E1419', '--surface': '#2A1D24',
  '--line': '#3D2A33', '--line-2': '#4C3540', '--hair': '#33232B', '--soft': '#261A20', '--pill': '#3A2830',
  '--muted': '#C4AEB8', '--body-2': '#E6D6DD',
  '--their-bubble': '#3E2A1E', '--note-bg': '#3E2A1E', '--note-fg': '#F3C88F',
  '--media': '#140D11', '--chip-bg': '#3A2830', '--sel-bg': '#45233A',
  '--reveal-ink': '#B83F72', '--bar-soft': '#7E6872',
  '--sun': '#F2B45F', '--cloud': '#E6D6DD', '--storm': '#C6B0FF',
  '--desk': '#140D11', '--photo-bg': '#3A2630',
};

const FOREST_LIGHT: Tokens = {
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

const FOREST_DARK: Tokens = {
  '--me': '#5FB58A', '--on-me': '#0E1511', '--me-dark': '#8ACBA9',
  '--them': '#E0A23E', '--on-them': '#121A16',
  '--ink': '#EEF3EF', '--on-ink': '#121A16',
  '--ground': '#121A16', '--surface': '#1B2520',
  '--line': '#2A3830', '--line-2': '#36463D', '--hair': '#22302A', '--soft': '#18221D', '--pill': '#26342D',
  '--muted': '#A3B2AA', '--body-2': '#D2DDD6',
  '--their-bubble': '#3A3020', '--note-bg': '#3A3020', '--note-fg': '#F0CE8E',
  '--media': '#0C120F', '--chip-bg': '#26342D', '--sel-bg': '#1F3A2C',
  '--reveal-ink': '#2F6B4F', '--bar-soft': '#66756D',
  '--sun': '#F2B45F', '--cloud': '#D2DDD6', '--storm': '#B7BCFF',
  '--desk': '#0B110E', '--photo-bg': '#22302A',
};

const TOKENS: Record<Palette, Record<Mode, Tokens>> = {
  hi: { light: HI_LIGHT, dark: HI_DARK },
  classic: { light: CLASSIC_LIGHT, dark: CLASSIC_DARK },
  blossom: { light: BLOSSOM_LIGHT, dark: BLOSSOM_DARK },
  forest: { light: FOREST_LIGHT, dark: FOREST_DARK },
};

export interface PaletteInfo {
  id: Palette;
  label: string;
  desc: string;
  /** [ground, accent] for the light and dark halves of the picker swatch. */
  light: [string, string];
  dark: [string, string];
}

export const PALETTES: PaletteInfo[] = [
  { id: 'hi', label: 'Hi', desc: 'Alabaster & navy, with teal', light: ['#F2EFE6', '#252C48'], dark: ['#252C48', '#54B5C6'] },
  { id: 'classic', label: 'Classic', desc: 'The original blue and orange', light: ['#F5F6FA', '#2F5BEA'], dark: ['#12151C', '#6E8DF2'] },
  { id: 'blossom', label: 'Blossom', desc: 'Rose and marigold', light: ['#FBF3F1', '#B83F72'], dark: ['#1E1419', '#E07AA5'] },
  { id: 'forest', label: 'Forest', desc: 'Pine green and amber', light: ['#F1F4EF', '#2F6B4F'], dark: ['#121A16', '#5FB58A'] },
];

export const MODES: { id: ModePref; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'Match my phone' },
];

const DEFAULTS: ThemePrefs = { palette: 'hi', mode: 'light' };
const KEY = 'hi.theme.v2';
const OLD_KEY = 'hi.theme';
const isPalette = (x: unknown): x is Palette => PALETTES.some((p) => p.id === x);
const isMode = (x: unknown): x is ModePref => x === 'light' || x === 'dark' || x === 'system';
const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

/** Accepts the current {palette, mode} shape and every older saved form. */
export function normalisePrefs(x: unknown): ThemePrefs | null {
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    if (isPalette(o.palette) && isMode(o.mode)) return { palette: o.palette, mode: o.mode };
    return null;
  }
  switch (x) {
    case 'hi': return { palette: 'hi', mode: 'light' };
    case 'dark': case 'midnight': return { palette: 'hi', mode: 'dark' };
    case 'system': return { palette: 'hi', mode: 'system' };
    case 'classic': case 'blossom': case 'forest': return { palette: x, mode: 'light' };
    default: return null;
  }
}

export function savedPrefs(): ThemePrefs {
  try {
    const v = localStorage.getItem(KEY);
    const p = v ? normalisePrefs(JSON.parse(v)) : normalisePrefs(localStorage.getItem(OLD_KEY));
    if (p) return p;
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

let current: ThemePrefs = { ...DEFAULTS };
let applied: Tokens = {};
const listeners = new Set<(prefs: ThemePrefs, mode: Mode) => void>();

/** Light or dark, after resolving "Match my phone". */
export function currentMode(): Mode {
  return document.documentElement.dataset.mode === 'dark' ? 'dark' : 'light';
}
export const currentPrefs = (): ThemePrefs => ({ ...current });

/** Called whenever the theme changes (e.g. to keep a toggle button in sync). */
export function onThemeChange(fn: (prefs: ThemePrefs, mode: Mode) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** The header switch: same palette, opposite of what's showing now. */
export const toggledPrefs = (): ThemePrefs => ({ palette: current.palette, mode: currentMode() === 'dark' ? 'light' : 'dark' });

/** Write the palette's light or dark tokens onto <html>. */
export function applyTheme(prefs: ThemePrefs, persist = true) {
  current = { ...prefs };
  const mode: Mode = prefs.mode === 'system' ? (systemDark() ? 'dark' : 'light') : prefs.mode;
  const tokens = TOKENS[prefs.palette][mode];
  const root = document.documentElement;
  Object.keys(applied).forEach((k) => root.style.removeProperty(k));
  Object.entries(tokens).forEach(([k, v]) => root.style.setProperty(k, v));
  applied = tokens;
  root.dataset.theme = `${prefs.palette}-${mode}`;
  root.dataset.mode = mode;
  root.style.colorScheme = mode;
  const surface = tokens['--surface'] || '#FFFFFF';
  // While the opening screen is up the status bar stays teal; the splash applies this when it leaves.
  root.dataset.themeColor = surface;
  if (!document.getElementById('splash')) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', surface);
  // Browser-tab icon follows the app's mode: teal bubble in light, navy in dark.
  document.querySelector('link[rel="icon"][type="image/svg+xml"]')
    ?.setAttribute('href', mode === 'dark' ? './icons/favicon-navy.svg' : './icons/favicon-teal.svg');
  if (persist) { try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* ignore */ } }
  listeners.forEach((fn) => fn({ ...current }, mode));
}

/** Call once at start-up, before the first render, to avoid a flash of the wrong colours. */
export function initTheme() {
  applyTheme(savedPrefs(), false);
  if (typeof matchMedia === 'function') {
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
      if (current.mode === 'system') applyTheme(current, false);
    });
  }
}
