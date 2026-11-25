import { useEffect, useRef, useState } from 'preact/hooks';
import type { TopPin } from '../types';
import { activeCountdowns, countdownText, type CountdownItem } from '../lib/scrapbook';
import { motionOn } from '../lib/effects';
import { XIcon } from './icons';

// ---------------------------------------------------------------------------- pinned messages

interface PinnedBarProps {
  pins: TopPin[];
  nameOf(uid: string): string;
  onJump(p: TopPin): void;
  onUnpin(p: TopPin): void;
  onToScrapbook(p: TopPin): void;
}

/** Up to 3 messages pinned above the chat. Tap to jump there (and step to the next one). */
export function PinnedBar({ pins, nameOf, onJump, onUnpin, onToScrapbook }: PinnedBarProps) {
  const [i, setI] = useState(0);
  const [menu, setMenu] = useState(false);
  const idx = pins.length ? Math.min(i, pins.length - 1) : 0;
  const p = pins[idx];
  useEffect(() => { if (i >= pins.length) setI(0); }, [pins.length]);
  if (!p) return null;
  const tap = () => {
    setMenu(false);
    onJump(p);
    if (pins.length > 1) setI((idx + 1) % pins.length);
  };
  return (
    <div class="pinned-bar" role="region" aria-label="Pinned messages">
      <span class="pinned-ticks" aria-hidden="true">
        {pins.map((x, k) => <span key={x.msgId} class={k === idx ? 'on' : ''} />)}
      </span>
      <button type="button" class="pinned-main" onClick={tap}
        aria-label={`Pinned ${idx + 1} of ${pins.length}: ${nameOf(p.uid)}: ${p.text}. Tap to jump to it.`}>
        <span class="pinned-label">Pinned · {idx + 1}/{pins.length}</span>
        <span class="pinned-text"><b>{nameOf(p.uid)}:</b> {p.text || 'Message'}</span>
      </button>
      <button type="button" class="pinned-more" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-label="Pinned message options">
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
      </button>
      {menu && (
        <div class="pinned-menu" role="group" aria-label="Pinned message options">
          <button type="button" onClick={() => { setMenu(false); onToScrapbook(p); }}>Move to Scrapbook</button>
          <button type="button" onClick={() => { setMenu(false); onUnpin(p); }}>Unpin</button>
        </div>
      )}
    </div>
  );
}

/** Pinning a 4th message: what to do with the full bar. */
export function PinFullSheet({ oldest, nameOf, onMoveOldest, onToScrapbook, onCancel }: {
  oldest: TopPin; nameOf(uid: string): string; onMoveOldest(): void; onToScrapbook(): void; onCancel(): void;
}) {
  return (
    <div class="stack">
      <div>
        <div class="sheet-title">Three messages are already pinned</div>
        <div class="sheet-sub">The oldest is “{oldest.text || 'a message'}” from {nameOf(oldest.uid)}.</div>
      </div>
      <button type="button" class="btn-primary" onClick={onMoveOldest}>Move the oldest to Scrapbook</button>
      <button type="button" class="btn-ghost" onClick={onToScrapbook}>Pin this one to Scrapbook instead</button>
      <button type="button" class="link-btn" onClick={onCancel}>Cancel</button>
    </div>
  );
}

// ---------------------------------------------------------------------------- countdown banner

const DISMISSED = 'hi.cd.dismissed';
const CELEBRATED = 'hi.cd.banner.celebrated';
const readSet = (key: string) => { try { return new Set<string>(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set<string>(); } };
const writeSet = (key: string, s: Set<string>) => { try { localStorage.setItem(key, JSON.stringify([...s].slice(-100))); } catch { /* ignore */ } };

interface CountdownBannerProps {
  items: CountdownItem[];
  onOpen(dropId: string): void;
}

/** A live countdown above the chat for each upcoming Countdown Drop (the soonest first). */
export function CountdownBanner({ items, onOpen }: CountdownBannerProps) {
  const [dismissed, setDismissed] = useState(() => readSet(DISMISSED));
  // `tick` only re-renders; the time is read fresh on every render (a countdown can be
  // added long after the chat opened).
  const [, setTick] = useState(0);
  const now = Date.now();
  const [i, setI] = useState(0);
  const live = activeCountdowns(items, now, dismissed);
  const idx = live.length ? Math.min(i, live.length - 1) : 0;
  const c = live[idx];
  const left = c ? c.atMs - now : 0;
  // Every second in the last hour, else every 30 s (the minute shown stays right).
  const step = c && left < 3_600_000 ? 1000 : 30_000;
  useEffect(() => {
    if (!c) return;
    const t = setInterval(() => setTick((n) => n + 1), step);
    return () => clearInterval(t);
  }, [c?.dropId, step]);
  // Confetti once per phone when it reaches zero while you're here.
  const fired = useRef(readSet(CELEBRATED));
  useEffect(() => {
    if (!c || left > 0 || fired.current.has(c.dropId)) return;
    fired.current.add(c.dropId);
    writeSet(CELEBRATED, fired.current);
    if (motionOn()) import('./Effects').then((m) => m.playScreen('confetti')).catch(() => {});
  }, [c?.dropId, left > 0]);
  // Swipe sideways between countdowns.
  const sx = useRef<number | null>(null);
  if (!c) return null;
  const done = left <= 0;
  const dismiss = () => { const s = new Set(dismissed); s.add(c.dropId); writeSet(DISMISSED, s); setDismissed(s); setI(0); };
  const go = (d: number) => setI((idx + d + live.length) % live.length);

  return (
    <div class={`cd-banner${done ? ' done' : ''}`} role="region" aria-label="Upcoming countdown"
      onPointerDown={(e) => { sx.current = e.clientX; }}
      onPointerUp={(e) => { if (sx.current != null && live.length > 1 && Math.abs(e.clientX - sx.current) > 40) go(e.clientX < sx.current ? 1 : -1); sx.current = null; }}>
      {live.length > 1 && <button type="button" class="cd-arrow" onClick={() => go(-1)} aria-label="Previous countdown">‹</button>}
      <button type="button" class="cd-main" onClick={() => onOpen(c.dropId)} aria-label={`${c.title}: ${done ? 'it’s here' : `${countdownText(left)} to go`}. Open the countdown.`}>
        <span class="cd-emoji" aria-hidden="true">{done ? '🎉' : '⏳'}</span>
        <span class="cd-title">{c.title}</span>
        <span class="cd-time" role="timer">{done ? 'It’s here! 🎉' : countdownText(left)}</span>
      </button>
      {live.length > 1 && <button type="button" class="cd-arrow" onClick={() => go(1)} aria-label="Next countdown">›</button>}
      {done && <button type="button" class="cd-x" onClick={dismiss} aria-label="Dismiss countdown"><XIcon /></button>}
    </div>
  );
}
