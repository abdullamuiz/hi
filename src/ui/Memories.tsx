import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { acceptStreak, cacheStreak, loadRewind, proposeStreak, stopStreak, watchDays, type Memory, type RewindData } from '../data/memories';
import { photoURL } from '../data/photos';
import { computeStreak, dayKeyIn, type DayMap, type StreakResult } from '../lib/streak';
import { gapLabel, rewindPeriod, type RewindPeriod } from '../lib/rewind';
import type { Milestone } from '../lib/milestones';
import { snippetOf } from '../lib/messages';
import { getDrop } from '../drops/registry';
import { closeOverlay, forgetOverlay, openOverlay } from '../lib/overlay';
import type { Room } from '../types';
import { BackIcon, XIcon } from './icons';

// ============================================================================ streak

export interface StreakView {
  state: 'off' | 'proposed-by-me' | 'proposed-to-me' | 'on';
  result: StreakResult | null;
}

/** Works out the hot streak from the room's activity days (live), and keeps the list's 🔥 cache fresh. */
export function useStreak(room: Room, me: string, them: string): StreakView {
  const s = room.streak;
  const sinceMs = s?.state === 'on' && s.since ? s.since.toMillis() : 0;
  const tz = room.timezone;
  const sinceKey = sinceMs ? dayKeyIn(sinceMs, tz) : '';
  const [days, setDays] = useState<DayMap>({});
  const [today, setToday] = useState(() => dayKeyIn(Date.now(), tz));
  useEffect(() => {
    if (!sinceKey) { setDays({}); return; }
    return watchDays(room.id, sinceKey, setDays, () => setDays({}));
  }, [room.id, sinceKey]);
  // Midnight passes while the chat is open.
  useEffect(() => {
    const t = setInterval(() => setToday(dayKeyIn(Date.now(), tz)), 60_000);
    return () => clearInterval(t);
  }, [tz]);
  const result = useMemo(() => (sinceKey && them ? computeStreak(days, me, them, sinceKey, today) : null), [days, me, them, sinceKey, today]);
  useEffect(() => {
    if (s?.state === 'on' && result) cacheStreak(room.id, s, result.count, result.best, today).catch(() => {});
  }, [result?.count, result?.best, today, s?.state]);
  const state: StreakView['state'] = !s ? 'off' : s.state === 'on' ? 'on' : s.by === me ? 'proposed-by-me' : 'proposed-to-me';
  return { state, result };
}

/** The 🔥 count in the chat list: the cached number, if it's from today or yesterday. */
export function listStreak(room: Room, now = Date.now()): number {
  const s = room.streak;
  if (s?.state !== 'on' || !s.count || !s.day) return 0;
  const today = dayKeyIn(now, room.timezone);
  const yesterday = dayKeyIn(now - 86_400_000, room.timezone);
  return s.day === today || s.day === yesterday ? s.count : 0;
}

export function FlameIcon({ size = 16 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" class="flame">
      <path d="M12 2c1 3.2-.6 5-2 6.6C8.6 10.2 7 12 7 14.6A5 5 0 0 0 12 20a5 5 0 0 0 5-5.2c0-2-1-3.6-2.2-4.8.1 1.6-.5 2.8-1.6 3.3.4-3.6-1-7-1.2-11.3Z" fill="var(--flame, #F2A15F)" />
      <path d="M12 20a2.8 2.8 0 0 1-2.8-2.9c0-1.4.9-2.4 1.8-3.4.2 1 .9 1.6 1.6 1.8.2-.9.1-1.8-.2-2.7 1.5.9 2.4 2.4 2.4 4.1A2.8 2.8 0 0 1 12 20Z" fill="var(--flame-core, #FFD27A)" />
    </svg>
  );
}

export function StreakChip({ count, onClick }: { count: number; onClick(): void }) {
  return (
    <button type="button" class="streak-chip" onClick={onClick} aria-label={`Hot streak: ${count} ${count === 1 ? 'day' : 'days'}`}>
      <FlameIcon size={15} /><span>{count}</span>
    </button>
  );
}

/** Shown to the person a streak was proposed to. */
export function StreakInvite({ room, name, onToast }: { room: Room; name: string; onToast(t: string): void }) {
  return (
    <div class="sys-card streak-invite" role="status">
      <FlameIcon size={20} />
      <span>{name} wants to start a hot streak: days you both say hi. No pressure — one missed day a week is skipped for free.</span>
      <button type="button" onClick={() => acceptStreak(room.id, room.streak!).then(() => onToast('Streak on 🔥')).catch((e) => onToast(e.message))}>Start</button>
      <button type="button" class="x" aria-label="No thanks" onClick={() => stopStreak(room.id).catch((e) => onToast(e.message))}><XIcon /></button>
    </div>
  );
}

const tick = (b: boolean) => (b ? '✓' : '·');

/** Current, best and today's status — or how to start one. */
export function StreakSheet({ room, me, name, view, onToast, onClose }: {
  room: Room; me: string; name: string; view: StreakView; onToast(t: string): void; onClose(): void;
}) {
  const r = view.result;
  const act = (p: Promise<unknown>, done: string) => { p.then(() => { onToast(done); onClose(); }).catch((e) => onToast(e.message)); };
  return (
    <div class="stack streak-sheet">
      <div class="sheet-title"><FlameIcon size={22} /> Hot streak</div>
      {view.state === 'on' && r ? (<>
        <div class="streak-big" aria-label={`${r.count} ${r.count === 1 ? 'day' : 'days'}`}>{r.count}<span>{r.count === 1 ? 'day' : 'days'}</span></div>
        <div class="settings">
          <div class="settings-row"><span>Best</span><span>{r.best} {r.best === 1 ? 'day' : 'days'}</span></div>
          <div class="settings-row"><span>Today</span><span>You {tick(r.today.me)} · {name} {tick(r.today.them)}</span></div>
          <div class="settings-row"><span>Skip day</span><span>{r.skipAvailable ? 'Free this week' : 'Used this week'}</span></div>
        </div>
        <p class="fine">A day counts when you both send something. Miss one day and it’s skipped for free (once a week); two in a row and it starts again. No reminders, no guilt.</p>
        <button type="button" class="btn-ghost" onClick={() => act(stopStreak(room.id), 'Streak off')}>Turn off streak</button>
      </>) : view.state === 'proposed-by-me' ? (<>
        <p class="lede">Waiting for {name} to say yes.</p>
        <button type="button" class="btn-ghost" onClick={() => act(stopStreak(room.id), 'Streak request withdrawn')}>Withdraw</button>
      </>) : view.state === 'proposed-to-me' ? (<>
        <p class="lede">{name} wants to start a hot streak.</p>
        <button type="button" class="btn-primary" onClick={() => act(acceptStreak(room.id, room.streak!), 'Streak on 🔥')}>Start streak</button>
        <button type="button" class="btn-ghost" onClick={() => act(stopStreak(room.id), 'Declined')}>No thanks</button>
      </>) : (<>
        <p class="lede">Count the days you and {name} both say hi. It starts when you both agree, and it’s forgiving: one missed day a week is skipped for free.</p>
        <button type="button" class="btn-primary" disabled={room.members.length < 2} onClick={() => act(proposeStreak(room.id, me), `Asked ${name}`)}>Start a streak with {name}</button>
      </>)}
    </div>
  );
}

// ============================================================================ cards

export function MilestoneCard({ m, onReplay, onPin, onClose }: { m: Milestone; onReplay(): void; onPin(): void; onClose(): void }) {
  return (
    <div class="memory-card milestone" role="status">
      <div class="memory-kicker">{m.emoji} Milestone</div>
      <div class="memory-title">{m.title}</div>
      <div class="memory-body">{m.body}</div>
      <div class="memory-actions">
        <button type="button" class="chip-btn" onClick={onReplay}>Celebrate 🎉</button>
        <button type="button" class="chip-btn" onClick={onPin}>Pin</button>
        <button type="button" class="memory-x" aria-label="Dismiss" onClick={onClose}><XIcon /></button>
      </div>
    </div>
  );
}

export function OnThisDayCard({ memory, who, tabName, onOpen, onPin, onClose }: {
  memory: Memory; who: string; tabName: string; onOpen(): void; onPin(): void; onClose(): void;
}) {
  const m = memory.message;
  const ago = `${memory.ago} ${memory.unit}${memory.ago === 1 ? '' : 's'} ago`;
  return (
    <div class="memory-card otd" role="status">
      <div class="memory-kicker">📅 On this day, {ago}</div>
      <div class="memory-who">{who}{tabName ? ` · ${tabName}` : ''}</div>
      <div class="memory-body">{snippetOf(m, 'a Drop', 200)}</div>
      <div class="memory-actions">
        <button type="button" class="chip-btn" onClick={onOpen}>Show</button>
        <button type="button" class="chip-btn" onClick={onPin}>Pin</button>
        <button type="button" class="memory-x" aria-label="Dismiss On this day" onClick={onClose}><XIcon /></button>
      </div>
    </div>
  );
}

// ============================================================================ Rewind

type Which = 'this-month' | 'last-month' | 'this-year';

interface RewindProps {
  roomId: string;
  me: string;
  them: string;
  /** Display names (nicknames applied). */
  myName: string;
  theirName: string;
  tz: string;
  /** Open on a specific period (from a Rewind Drop). */
  period?: RewindPeriod | null;
  onClose(): void;
  onToast(t: string): void;
}

interface Slide { id: string; kicker: string; title: string; body?: preact.ComponentChildren }

/** Story-style recap: swipe or tap through slides, then share one as an image. */
export function RewindScreen(p: RewindProps) {
  const [which, setWhich] = useState<Which | 'custom'>(p.period ? 'custom' : 'this-month');
  const period = useMemo(() => (which === 'custom' && p.period ? p.period : rewindPeriod(which === 'custom' ? 'this-month' : which, Date.now(), p.tz)), [which]);
  const [data, setData] = useState<RewindData | null>(null);
  const [err, setErr] = useState('');
  const [i, setI] = useState(0);
  const [photos, setPhotos] = useState<string[]>([]);
  const closeRef = useRef(p.onClose);
  closeRef.current = p.onClose;

  useLayoutEffect(() => {
    const close = () => closeRef.current();
    openOverlay(close);
    return () => forgetOverlay(close);
  }, []);
  useEffect(() => {
    setData(null); setErr(''); setI(0); setPhotos([]);
    let alive = true;
    loadRewind(p.roomId, period, p.me, p.them, p.tz)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setErr(e?.message || 'Could not load the chat.'); });
    return () => { alive = false; };
  }, [period.from, period.to]);
  useEffect(() => {
    if (!data?.stats.photos.length) return;
    Promise.all(data.stats.photos.map((path) => photoURL(path).catch(() => ''))).then((u) => setPhotos(u.filter(Boolean)));
  }, [data]);

  const slides = useMemo<Slide[]>(() => (data ? buildSlides(data, p, period, photos) : []), [data, photos]);
  const n = slides.length;
  const go = (d: number) => setI((x) => Math.max(0, Math.min(n - 1, x + d)));

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'Escape') closeOverlay();
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [n]);

  // Swipe sideways between slides.
  const start = useRef<{ x: number; y: number } | null>(null);
  const onDown = (e: PointerEvent) => { start.current = { x: e.clientX, y: e.clientY }; };
  const onUp = (e: PointerEvent) => {
    const s0 = start.current;
    start.current = null;
    if (!s0) return;
    const dx = e.clientX - s0.x;
    const dy = e.clientY - s0.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
  };

  const share = async () => {
    if (!data) return;
    try {
      const blob = await rewindImage(data, p, period);
      const name = `hi-rewind-${period.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
      const file = new File([blob], name, { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?(d: unknown): boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: `Hi Rewind · ${period.label}` });
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') p.onToast(e?.message || 'Could not share.');
    }
  };

  const slide = slides[i];
  return (
    <div class="rewind" role="dialog" aria-modal="true" aria-label={`Rewind: ${period.label}`}>
      <header class="rewind-top">
        <button type="button" class="icon-btn" onClick={() => closeOverlay()} aria-label="Close Rewind"><BackIcon /></button>
        <div class="rewind-periods" role="radiogroup" aria-label="Period">
          {p.period && <button type="button" role="radio" aria-checked={which === 'custom'} class={which === 'custom' ? 'on' : ''} onClick={() => setWhich('custom')}>{p.period.label}</button>}
          {([['this-month', 'This month'], ['last-month', 'Last month'], ['this-year', 'This year']] as const).map(([id, label]) => (
            <button type="button" key={id} role="radio" aria-checked={which === id} class={which === id ? 'on' : ''} onClick={() => setWhich(id)}>{label}</button>
          ))}
        </div>
      </header>
      <div class="rewind-dots" aria-hidden="true">{slides.map((s, k) => <span key={s.id} class={k <= i ? 'on' : ''} />)}</div>
      <div class="rewind-stage" onPointerDown={onDown} onPointerUp={onUp}>
        {err ? <div class="rewind-slide"><div class="rewind-title">{err}</div></div>
          : !data ? <div class="rewind-slide" aria-busy="true"><div class="rewind-kicker">Rewind</div><div class="rewind-title">Rewinding…</div></div>
          : slide && (
            <section class="rewind-slide" key={slide.id} aria-live="polite" aria-label={`Slide ${i + 1} of ${n}`}>
              <div class="rewind-kicker">{slide.kicker}</div>
              <div class="rewind-title">{slide.title}</div>
              {slide.body && <div class="rewind-body">{slide.body}</div>}
            </section>
          )}
        {data && i > 0 && <button type="button" class="rewind-nav prev" onClick={() => go(-1)} aria-label="Previous slide">‹</button>}
        {data && i < n - 1 && <button type="button" class="rewind-nav next" onClick={() => go(1)} aria-label="Next slide">›</button>}
      </div>
      <footer class="rewind-foot">
        {data?.truncated && <span class="fine">Only recent messages were counted.</span>}
        <button type="button" class="btn-primary" disabled={!data || !data.stats.total} onClick={share}>Share as image</button>
      </footer>
    </div>
  );
}

const plural = (n: number, w: string) => `${n.toLocaleString('en')} ${w}${n === 1 ? '' : 's'}`;

function buildSlides(d: RewindData, p: RewindProps, period: RewindPeriod, photos: string[]): Slide[] {
  const s = d.stats;
  if (!s.total) {
    return [{ id: 'empty', kicker: period.label, title: 'Nothing here yet', body: <p>Say hi to {p.theirName} and there’ll be something to rewind.</p> }];
  }
  const mine = s.perPerson[p.me] || 0;
  const theirs = s.perPerson[p.them] || 0;
  const max = Math.max(1, mine, theirs);
  const out: Slide[] = [
    { id: 'cover', kicker: `Rewind · ${period.label}`, title: `You and ${p.theirName}`, body: <p class="rewind-hero">{plural(s.total, 'message')}<br /><span>over {plural(s.activeDays, 'day')}</span></p> },
    {
      id: 'who', kicker: 'Who said more', title: mine === theirs ? 'Perfectly even' : mine > theirs ? 'You had more to say' : `${p.theirName} had more to say`,
      body: (
        <div class="rewind-bars">
          <div class="rewind-bar me"><span>You</span><i style={{ width: `${(mine / max) * 100}%` }} /><b>{mine}</b></div>
          <div class="rewind-bar them"><span>{p.theirName}</span><i style={{ width: `${(theirs / max) * 100}%` }} /><b>{theirs}</b></div>
        </div>
      ),
    },
  ];
  if (s.topEmojis.length) {
    out.push({ id: 'emoji', kicker: 'Top emoji', title: s.topEmojis[0].emoji, body: <p class="rewind-list">{s.topEmojis.map((e) => <span key={e.emoji}>{e.emoji} ×{e.n}</span>)}</p> });
  }
  if (s.topWords.length) {
    out.push({ id: 'words', kicker: 'Your words', title: `“${s.topWords[0].word}”`, body: <p class="rewind-list">{s.topWords.map((w) => <span key={w.word}>{w.word} ×{w.n}</span>)}</p> });
  }
  if (s.drops) {
    const def = s.topDrop ? getDrop(s.topDrop.type) : undefined;
    out.push({ id: 'drops', kicker: 'Drops', title: plural(s.drops, 'Drop'), body: def ? <p>Favourite: <b>{def.title}</b> ({s.topDrop!.n}×)</p> : undefined });
  }
  out.push({
    id: 'days', kicker: 'Your days', title: s.longestRun > 1 ? `${s.longestRun} days in a row` : 'Every day counts',
    body: (
      <div class="rewind-facts">
        {s.busiestDay && <p>Busiest day: <b>{dayName(s.busiestDay.key)}</b> ({plural(s.busiestDay.n, 'message')})</p>}
        {s.topTab && d.tabNames[s.topTab.tabId] && <p>Most active tab: <b>{d.tabNames[s.topTab.tabId]}</b></p>}
        {s.biggestGapMs > 0 && <p>Longest quiet: {gapLabel(s.biggestGapMs)}</p>}
      </div>
    ),
  });
  if (s.first) {
    out.push({
      id: 'first', kicker: `First of ${period.label}`, title: s.first.uid === p.me ? 'You started it' : `${p.theirName} started it`,
      body: <blockquote class="rewind-quote">{snippetOf({ kind: s.first.kind as any, text: s.first.text }, 'a Drop', 160)}</blockquote>,
    });
  }
  if (photos.length) {
    out.push({ id: 'photos', kicker: 'Photos', title: plural(s.photos.length, 'photo'), body: <div class="rewind-collage">{photos.map((u) => <img key={u} src={u} alt="" />)}</div> });
  }
  out.push({ id: 'end', kicker: 'That’s a wrap', title: `${period.label} with ${p.theirName}`, body: <p>Share it, or swipe back through.</p> });
  return out;
}

const dayName = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** A 1080×1350 summary card (no photos, so nothing private leaves as a picture). */
async function rewindImage(d: RewindData, p: RewindProps, period: RewindPeriod): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = 1080;
  c.height = 1350;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 1350);
  grad.addColorStop(0, '#1E7F93');
  grad.addColorStop(1, '#232B47');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1080, 1350);
  const font = (w: number, s: number) => `${w} ${s}px Inter, system-ui, sans-serif`;
  g.fillStyle = '#F2EFE6';
  g.textBaseline = 'top';
  g.font = font(600, 40);
  g.fillText(`Hi · Rewind · ${period.label}`, 90, 100);
  g.font = font(700, 76);
  g.fillText(`You & ${p.theirName}`.slice(0, 26), 90, 170);
  const s = d.stats;
  const rows: [string, string][] = [
    ['Messages', s.total.toLocaleString('en')],
    ['Days together', String(s.activeDays)],
    ['Longest run', `${s.longestRun} ${s.longestRun === 1 ? 'day' : 'days'}`],
    ['Drops', String(s.drops)],
  ];
  rows.forEach(([k, v], i) => {
    const y = 340 + i * 150;
    g.font = font(500, 34);
    g.globalAlpha = 0.75;
    g.fillText(k, 90, y);
    g.globalAlpha = 1;
    g.font = font(700, 72);
    g.fillText(v, 90, y + 44);
  });
  if (s.topEmojis.length) {
    g.font = font(500, 34);
    g.globalAlpha = 0.75;
    g.fillText('Top emoji', 600, 340);
    g.globalAlpha = 1;
    g.font = '120px "Apple Color Emoji", "Noto Color Emoji", sans-serif';
    g.fillText(s.topEmojis.slice(0, 3).map((e) => e.emoji).join(' '), 600, 390);
  }
  if (s.topWords.length) {
    g.font = font(500, 34);
    g.globalAlpha = 0.75;
    g.fillText('Most said', 600, 640);
    g.globalAlpha = 1;
    g.font = font(700, 52);
    s.topWords.slice(0, 3).forEach((w, i) => g.fillText(w.word.slice(0, 14), 600, 690 + i * 70));
  }
  g.font = font(500, 32);
  g.globalAlpha = 0.7;
  g.fillText('Just say “Hi”.', 90, 1230);
  g.globalAlpha = 1;
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not make the image.'))), 'image/png'));
}
