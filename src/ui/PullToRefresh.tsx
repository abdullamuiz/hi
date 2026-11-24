import { useEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import { reloadApp } from '../lib/updates';

const TRIGGER = 72;     // px of pull needed before the hold starts
const HOLD_MS = 2000;   // then keep holding this long; letting go earlier cancels

/**
 * Pull down at the very top of a scroll container, then HOLD for 2 seconds to reload.
 * The hold stops accidental touches from reloading the app. Installed apps have no
 * reload button, and the browser's own pull-to-refresh is off on purpose (it fights
 * with the chat's scrolling).
 */
export function usePullToRefresh(scroller: RefObject<HTMLElement | null>) {
  const [pull, setPull] = useState(0);
  const [progress, setProgress] = useState(0); // 0..1 while holding past the line
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef<number | null>(null);
  const armedAt = useRef<number | null>(null);
  const raf = useRef(0);
  const fired = useRef(false);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;

    const stopHold = () => { cancelAnimationFrame(raf.current); armedAt.current = null; setProgress(0); };
    const tick = () => {
      if (armedAt.current == null || fired.current) return;
      const p = Math.min(1, (performance.now() - armedAt.current) / HOLD_MS);
      setProgress(p);
      if (p >= 1) {
        fired.current = true;
        setRefreshing(true);
        navigator.vibrate?.(15);
        reloadApp();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    const reset = () => {
      start.current = null;
      stopHold();
      if (!fired.current) setPull(0);
    };

    const onStart = (e: TouchEvent) => {
      start.current = el.scrollTop <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null;
    };
    const onMove = (e: TouchEvent) => {
      if (start.current == null || fired.current) return;
      const dy = e.touches[0].clientY - start.current;
      if (dy <= 0 || el.scrollTop > 0) { setPull(0); stopHold(); return; }
      const d = Math.min(120, dy * 0.5); // resistance
      setPull(d);
      if (e.cancelable) e.preventDefault();
      if (d >= TRIGGER && armedAt.current == null) {
        armedAt.current = performance.now();
        raf.current = requestAnimationFrame(tick);
      } else if (d < TRIGGER && armedAt.current != null) {
        stopHold(); // pulled back up: start over
      }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', reset);
    el.addEventListener('touchcancel', reset);
    return () => {
      cancelAnimationFrame(raf.current);
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', reset);
      el.removeEventListener('touchcancel', reset);
    };
  }, [scroller]);

  if (pull <= 0 && !refreshing) return null;
  const armed = pull >= TRIGGER;
  const r = 11;
  const circ = 2 * Math.PI * r;
  return (
    <div class="ptr" style={{ height: `${refreshing ? TRIGGER : pull}px` }} aria-live="polite">
      <span class={`ptr-icon${armed || refreshing ? ' ready' : ''}`}>
        <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
          <circle cx="14" cy="14" r={r} fill="none" stroke="var(--line-2)" stroke-width="2.5" />
          <circle cx="14" cy="14" r={r} fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
            stroke-dasharray={`${circ}`} stroke-dashoffset={`${circ * (1 - (refreshing ? 1 : progress))}`}
            transform="rotate(-90 14 14)" />
          <path d="M18 14a4 4 0 1 1-1.17-2.83M18 9.6v2.6h-2.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
      <span class="ptr-text">{refreshing ? 'Refreshing…' : armed ? 'Keep holding to refresh' : 'Pull down to refresh'}</span>
    </div>
  );
}

/** Shown when a newer version of the app has been published. */
export function UpdateBar({ onDismiss }: { onDismiss(): void }) {
  return (
    <div class="update-bar" role="status">
      <span>A new version of Hi is ready</span>
      <button type="button" onClick={() => reloadApp()}>Update</button>
      <button type="button" class="x" onClick={onDismiss} aria-label="Later">✕</button>
    </div>
  );
}
