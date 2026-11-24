import { useEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import { reloadApp } from '../lib/updates';

const TRIGGER = 72; // px of pull needed to reload

/**
 * Pull down at the very top of a scroll container to reload the app. Installed apps
 * have no reload button, and the browser's own pull-to-refresh is off on purpose
 * (it fights with the chat's scrolling).
 */
export function usePullToRefresh(scroller: RefObject<HTMLElement | null>) {
  const [pull, setPull] = useState(0);
  const start = useRef<number | null>(null);
  const pullRef = useRef(0);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onStart = (e: TouchEvent) => {
      start.current = el.scrollTop <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null;
    };
    const onMove = (e: TouchEvent) => {
      if (start.current == null) return;
      const dy = e.touches[0].clientY - start.current;
      if (dy <= 0 || el.scrollTop > 0) { pullRef.current = 0; setPull(0); return; }
      const d = Math.min(120, dy * 0.5); // resistance
      pullRef.current = d;
      setPull(d);
      if (e.cancelable) e.preventDefault();
    };
    const onEnd = () => {
      if (pullRef.current >= TRIGGER) reloadApp();
      start.current = null;
      pullRef.current = 0;
      setPull(0);
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [scroller]);

  const indicator = pull > 0 ? (
    <div class="ptr" style={{ height: `${pull}px` }} aria-hidden="true">
      <span class={`ptr-icon${pull >= TRIGGER ? ' ready' : ''}`} style={{ transform: `rotate(${pull * 3}deg)` }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v5h-5" /></svg>
      </span>
      <span class="ptr-text">{pull >= TRIGGER ? 'Release to refresh' : 'Pull to refresh'}</span>
    </div>
  ) : null;

  return indicator;
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
