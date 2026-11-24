/**
 * Message effects (SPEC §4). Pure helpers: the list, keyword suggestions, and the
 * "play it once on arrival" bookkeeping. Drawing lives in src/ui/Effects.tsx.
 */

export type ScreenEffect = 'confetti' | 'balloons' | 'fireworks' | 'glow';
export type BubbleEffect = 'shout' | 'whisper' | 'slow' | 'spotlight' | 'sealed' | 'echo';
export type EffectCode = ScreenEffect | BubbleEffect;

export interface EffectDef {
  code: EffectCode;
  /** Screen effects play over the whole chat; bubble effects change the bubble. */
  kind: 'screen' | 'bubble';
  label: string;
  emoji: string;
  desc: string;
}

/** Keep in step with validEffect() in firestore.rules. */
export const EFFECTS: EffectDef[] = [
  { code: 'confetti', kind: 'screen', label: 'Confetti', emoji: '🎉', desc: 'A burst that falls across the screen' },
  { code: 'balloons', kind: 'screen', label: 'Balloons', emoji: '🎈', desc: 'Balloons float up — tap to pop' },
  { code: 'fireworks', kind: 'screen', label: 'Fireworks', emoji: '🎆', desc: 'The screen dims for a few bursts' },
  { code: 'glow', kind: 'screen', label: 'Glow', emoji: '✨', desc: 'A soft warm glow, for thank-yous' },
  { code: 'shout', kind: 'bubble', label: 'Shout', emoji: '📣', desc: 'Big text with a shake' },
  { code: 'whisper', kind: 'bubble', label: 'Whisper', emoji: '🤫', desc: 'Blurred until tapped' },
  { code: 'slow', kind: 'bubble', label: 'Slow reveal', emoji: '⌨️', desc: 'Types itself out' },
  { code: 'spotlight', kind: 'bubble', label: 'Spotlight', emoji: '🔦', desc: 'Dims the chat around it' },
  { code: 'sealed', kind: 'bubble', label: 'Sealed', emoji: '✉️', desc: 'An envelope — tap to open' },
  { code: 'echo', kind: 'bubble', label: 'Echo', emoji: '〰️', desc: 'Two fading echoes behind it' },
];

const BY_CODE = new Map(EFFECTS.map((e) => [e.code, e]));

export const effectDef = (code: string | null | undefined): EffectDef | null => (code ? BY_CODE.get(code as EffectCode) ?? null : null);
export const isEffect = (code: unknown): code is EffectCode => typeof code === 'string' && BY_CODE.has(code as EffectCode);

/** Effects that hide the text until the receiver acts, so previews and pushes must not show it. */
export const HIDES_TEXT: ReadonlySet<EffectCode> = new Set(['whisper', 'sealed']);

/** Chat-list preview text for a message sent with an effect that hides it. */
export function previewFor(text: string, effect: EffectCode | null | undefined): string {
  if (effect === 'sealed') return '✉️ Sealed message';
  if (effect === 'whisper') return '🤫 Whisper';
  return text;
}

// ---------------------------------------------------------------------------- keyword suggestions

/** Phrase → effect. Matched as whole words, case- and accent-insensitive. */
export const KEYWORDS: { words: string[]; effect: EffectCode }[] = [
  { words: ['happy birthday', 'happy bday', 'hbd'], effect: 'balloons' },
  { words: ['happy new year'], effect: 'fireworks' },
  { words: ['congrats', 'congratulations', 'well done', 'you did it', 'mabrook', 'mabrouk'], effect: 'confetti' },
  { words: ['thank you', 'thanks so much', 'thank u', 'thanks a lot'], effect: 'glow' },
];

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, '');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATTERNS = KEYWORDS.map((k) => ({
  effect: k.effect,
  re: new RegExp(`(^|[^\\p{L}\\p{N}])(${k.words.map((w) => escape(fold(w)).replace(/ /g, '\\s+')).join('|')})(?=$|[^\\p{L}\\p{N}])`, 'u'),
}));

/** The effect to suggest for a draft, or null. Never applied without a tap. */
export function suggestEffect(draft: string): EffectCode | null {
  const t = fold(draft);
  if (t.trim().length < 3) return null;
  for (const p of PATTERNS) if (p.re.test(t)) return p.effect;
  return null;
}

// ---------------------------------------------------------------------------- playing on arrival

/** Only messages this recent play automatically when they appear (older ones only on tap). */
export const ARRIVAL_WINDOW_MS = 10 * 60_000;

export interface Arrival { id: string; effect: EffectCode; createdMs: number }

/**
 * Of the messages now on screen, which effect should play by itself: the newest one
 * that hasn't been played on this device and arrived within the window. Returns it
 * plus every id that should now count as played (so a burst of effects plays once).
 */
export function pickArrival(items: Arrival[], played: ReadonlySet<string>, now: number): { play: Arrival | null; mark: string[] } {
  const fresh = items.filter((m) => !played.has(m.id) && now - m.createdMs <= ARRIVAL_WINDOW_MS);
  if (!fresh.length) return { play: null, mark: [] };
  const play = fresh.reduce((a, b) => (b.createdMs >= a.createdMs ? b : a));
  return { play, mark: fresh.map((m) => m.id) };
}

const PLAYED_KEY = 'hi.fx.played';
const PLAYED_MAX = 400;

export function loadPlayed(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(PLAYED_KEY) || '[]');
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  } catch { return new Set(); }
}

export function savePlayed(ids: Iterable<string>) {
  const list = [...ids].slice(-PLAYED_MAX);
  try { localStorage.setItem(PLAYED_KEY, JSON.stringify(list)); } catch { /* private mode */ }
}

/** Sealed envelopes I've opened (per device). */
const OPENED_KEY = 'hi.fx.opened';
export function loadOpened(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(OPENED_KEY) || '[]')); } catch { return new Set(); }
}
export function saveOpened(ids: Iterable<string>) {
  try { localStorage.setItem(OPENED_KEY, JSON.stringify([...ids].slice(-PLAYED_MAX))); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------- settings

const SETTING_KEY = 'hi.effects';

/** Settings → "Play effects" (this device). On unless turned off. */
export function effectsSetting(): boolean {
  try { return localStorage.getItem(SETTING_KEY) !== 'off'; } catch { return true; }
}
export function setEffectsSetting(on: boolean) {
  try { if (on) localStorage.removeItem(SETTING_KEY); else localStorage.setItem(SETTING_KEY, 'off'); } catch { /* ignore */ }
}

export const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Whether effects animate here: the setting is on, the phone allows motion, and the tab isn't a quiet work tab. */
export function motionOn(tab?: { mode?: string; effects?: boolean } | null): boolean {
  if (!effectsSetting() || prefersReducedMotion()) return false;
  if (tab?.mode === 'work' && tab.effects !== true) return false;
  return true;
}
