import { useEffect, useRef, useState } from 'preact/hooks';
import { effectsSetting, prefersReducedMotion } from '../lib/effects';

/**
 * Little moments for Drops: gold stars, waving red flags, a running chicken, a crown,
 * confetti, and a 3-2-1 reveal. Every one respects Settings → Play effects and the
 * phone's reduce-motion setting, and plays once per device per Drop event.
 */

/** Effects may animate here. */
export const fxOn = () => effectsSetting() && !prefersReducedMotion();

/** A short vibration where supported (Android); silently ignored elsewhere. */
export function buzz(ms: number | number[] = 10) {
  try { if (fxOn()) navigator.vibrate?.(ms); } catch { /* ignore */ }
}

const ONCE_KEY = 'hi.dropfx.once';
function loadOnce(): string[] {
  try { return JSON.parse(localStorage.getItem(ONCE_KEY) || '[]'); } catch { return []; }
}

/** True the first time `key` is seen on this device (and remembers it). */
export function once(key: string): boolean {
  const seen = loadOnce();
  if (seen.includes(key)) return false;
  try { localStorage.setItem(ONCE_KEY, JSON.stringify([...seen, key].slice(-400))); } catch { /* ignore */ }
  return true;
}

/** Already played on this device? (Doesn't mark it.) */
export const played = (key: string) => loadOnce().includes(key);

export type Burst = 'stars' | 'flags' | 'chicken' | 'crown';

/** For tests: which overlays have played. */
const log: string[] = typeof window === 'undefined' ? [] : ((window as any).__hiDropFx ||= []);

const SPEC: Record<Burst, { n: number; glyph: string; ms: number; text?: string }> = {
  stars: { n: 18, glyph: '⭐', ms: 2200, text: 'Nailed it! ⭐' },
  flags: { n: 10, glyph: '🚩', ms: 2400, text: 'Fooled you! 🚩' },
  chicken: { n: 1, glyph: '🐔', ms: 2200, text: 'Bawk bawk!' },
  crown: { n: 1, glyph: '👑', ms: 1600 },
};

/** A full-screen, click-through overlay. Does nothing when effects are off. */
export function burst(kind: Burst) {
  if (!fxOn()) return;
  document.getElementById('drop-fx')?.remove();
  const spec = SPEC[kind];
  const el = document.createElement('div');
  el.id = 'drop-fx';
  el.className = `drop-fx drop-fx-${kind}`;
  el.dataset.kind = kind;
  el.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < spec.n; i++) {
    const s = document.createElement('span');
    s.className = 'fx-bit';
    s.textContent = spec.glyph;
    // Spread them out: position, delay and size vary per piece.
    s.style.setProperty('--i', String(i));
    s.style.setProperty('--x', `${Math.round(((i + 0.5) / spec.n) * 100)}%`);
    s.style.setProperty('--d', `${(i % 5) * 70 + Math.floor(i / 5) * 40}ms`);
    s.style.setProperty('--side', i % 2 ? '1' : '-1');
    el.appendChild(s);
  }
  if (spec.text) {
    const t = document.createElement('div');
    t.className = 'fx-text';
    t.textContent = spec.text;
    el.appendChild(t);
  }
  document.body.appendChild(el);
  if (kind === 'flags') document.querySelector('.app')?.classList.add('fx-shake');
  log.push(kind);
  setTimeout(() => {
    el.remove();
    document.querySelector('.app')?.classList.remove('fx-shake');
  }, spec.ms);
}

/** Confetti from the effects layer (also respects the settings). */
export const confetti = (from?: Element | null) => {
  const r = from?.getBoundingClientRect() ?? null;
  import('../ui/Effects').then((m) => m.playScreen('confetti', r));
};

/** Runs `fn` once per device when `when` first becomes true for `key`. */
export function useOnceWhen(when: boolean, key: string, fn: () => void) {
  useEffect(() => { if (when && once(key)) fn(); }, [when, key]);
}

/**
 * A 3-2-1 beat before a reveal, the first time this device sees it. Returns the number to
 * show (3, 2, 1) while counting, or null once the answer should show. `flip` is true for the
 * render right after the countdown, so the card can flip in.
 */
export function useRevealBeat(revealed: boolean, key: string): { count: number | null; flip: boolean } {
  const [count, setCount] = useState<number | null>(null);
  const [flip, setFlip] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (!revealed || started.current) return;
    started.current = true;
    if (!once(`beat:${key}`) || !fxOn()) return;
    let n = 3;
    setCount(n);
    buzz(8);
    const t = setInterval(() => {
      n--;
      if (n > 0) { setCount(n); buzz(8); return; }
      clearInterval(t);
      setCount(null);
      setFlip(true);
      buzz([12, 40, 18]);
      setTimeout(() => setFlip(false), 900);
    }, 420);
    return () => clearInterval(t);
  }, [revealed, key]);
  return { count, flip };
}

/** The face-down card that counts 3-2-1, or pulses while waiting. */
export function HiddenCard({ who, count, note }: { who: string; count: number | null; note?: string }) {
  return (
    <div class={`reveal-card hidden${count == null ? ' waiting' : ' counting'}`}>
      <div class="reveal-who">{who}</div>
      <div class="reveal-ans" aria-label={count == null ? 'Hidden' : `Revealing in ${count}`}>{count ?? '?'}</div>
      {count == null && note && <div style={{ fontSize: '12px' }}>{note}</div>}
    </div>
  );
}
