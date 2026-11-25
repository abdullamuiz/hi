import { useEffect, useRef, useState } from 'preact/hooks';
import { buzz, fxOn } from './fx';
import { defineDrop, type DropApi } from './types';
import { splitPair } from './logic';

type Content = { pairs: string[] };
const SECONDS = 5;
const key = (i: number) => `r${i}`;

/** Ten quick pairs, five seconds each. Picks stay hidden until both answer a round. */
export default defineDrop<Content>({
  type: 'this-or-that',
  title: 'This or That',
  trayDescription: '10 rapid picks, 5 seconds each',
  order: 13,
  content: {
    pairs: [
      'Tea / Coffee', 'Beach / Mountains', 'Morning / Night', 'Cats / Dogs', 'Sweet / Savoury',
      'Film / Series', 'Call / Text', 'Summer / Winter', 'Plan / Wing it', 'Pizza / Burger',
    ],
  },
  setup: [{ key: 'pairs', label: 'Pairs, one per line as “This / That” (up to 10)', kind: 'lines', min: 3, max: 10 }],
  subtitle: (c) => `${Math.min(10, c.pairs.length)} rounds`,
  pinTitle: () => 'This or That',
  pinDetail(c, api) {
    const n = Math.min(10, c.pairs.length);
    let both = 0; let same = 0;
    for (let i = 0; i < n; i++) {
      if (!api.revealed(key(i))) continue;
      both++;
      if (api.mine(key(i)) != null && api.mine(key(i)) === api.theirs(key(i))) same++;
    }
    return both ? `Matched ${same} of ${both}` : 'Not played yet';
  },

  Renderer({ content, api }) {
    const pairs = content.pairs.slice(0, 10).map(splitPair);
    const next = pairs.findIndex((_, i) => !api.iLocked(key(i)));
    const [playing, setPlaying] = useState(false);
    const [left, setLeft] = useState(SECONDS);
    const p = api.partner.name;

    // A 5-second clock per round; running out counts as no pick.
    useEffect(() => {
      if (!playing || next < 0) return;
      setLeft(SECONDS);
      const started = Date.now();
      const t = setInterval(() => {
        const l = SECONDS - Math.floor((Date.now() - started) / 1000);
        setLeft(Math.max(0, l));
        if (l <= 0) { clearInterval(t); api.lock(key(next), null); }
      }, 200);
      return () => clearInterval(t);
    }, [playing, next]);
    useEffect(() => { if (next < 0) setPlaying(false); }, [next]);

    const choose = (side: 0 | 1) => { if (next >= 0) api.lock(key(next), side); };

    if (next >= 0 && !playing) {
      return (
        <div class="stack-10">
          <div class="q">{pairs.length} quick picks · {SECONDS} seconds each</div>
          {next > 0 && <div class="note plain">{next} of {pairs.length} done</div>}
          <button type="button" class="btn-primary" onClick={() => setPlaying(true)}>{next ? 'Keep going' : 'Start'}</button>
          <Results pairs={pairs} api={api} p={p} />
        </div>
      );
    }
    if (next >= 0) {
      const [a, b] = pairs[next];
      return (
        <div class="stack-10">
          <div class="tot-head"><span>Round {next + 1} / {pairs.length}</span><span class="tot-clock" role="timer">{left}s</span></div>
          <SwipePick a={a} b={b} onPick={choose} key={next} />
        </div>
      );
    }
    return <Results pairs={pairs} api={api} p={p} />;
  },
});

function Results({ pairs, api, p }: { pairs: [string, string][]; api: DropApi; p: string }) {
  const rows = pairs.map(([a, b], i) => {
    const mine = api.mine(key(i)) as 0 | 1 | null | undefined;
    const theirs = api.revealed(key(i)) ? (api.theirs(key(i)) as 0 | 1 | null) : undefined;
    return { a, b, mine, theirs, i };
  }).filter((r) => r.mine !== undefined);
  if (!rows.length) return null;
  const done = rows.filter((r) => r.theirs !== undefined);
  const same = done.filter((r) => r.mine != null && r.mine === r.theirs).length;
  const label = (r: typeof rows[number], v: 0 | 1 | null | undefined) => (v == null ? '—' : v === 0 ? r.a : r.b);
  return (
    <div class="stack-10">
      <ul class="tot-results" aria-label="Your picks">
        {rows.map((r) => {
          const same = r.theirs !== undefined && r.mine != null && r.mine === r.theirs;
          return (
            <li key={r.i} class={same ? 'match' : ''}>
              <span>{label(r, r.mine)}</span>
              {same && <span class="tot-same">Same! 💞</span>}
              <span class="tot-vs">{r.theirs === undefined ? '?' : label(r, r.theirs)}</span>
            </li>
          );
        })}
      </ul>
      <div class="note">{done.length ? `${same} of ${done.length} matched` : ''}{done.length < rows.length ? `${done.length ? ' · ' : ''}${p}’s picks show as they play` : ''}</div>
    </div>
  );
}

/**
 * One round as a card: drag left for "this", right for "that" (a fling past 80px picks).
 * The two buttons stay as the plain, accessible way to choose.
 */
function SwipePick({ a, b, onPick }: { a: string; b: string; onPick(side: 0 | 1): void }) {
  const [dx, setDx] = useState(0);
  const [gone, setGone] = useState<0 | 1 | null>(null);
  const start = useRef<{ x: number; id: number } | null>(null);
  const pick = (side: 0 | 1) => {
    if (gone != null) return;
    setGone(side);
    buzz(8);
    setTimeout(() => onPick(side), fxOn() ? 180 : 0);
  };
  const down = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    start.current = { x: e.clientX, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent) => { if (start.current && e.pointerId === start.current.id) setDx(e.clientX - start.current.x); };
  const up = (e: PointerEvent) => {
    if (!start.current || e.pointerId !== start.current.id) return;
    const d = e.clientX - start.current.x;
    start.current = null;
    if (d <= -80) pick(0);
    else if (d >= 80) pick(1);
    else setDx(0);
  };
  const lean = gone === 0 ? -400 : gone === 1 ? 400 : dx;
  return (
    <div class="tot-swipe">
      <div class={`tot-card${start.current ? ' dragging' : ''}`} style={{ transform: `translateX(${lean}px) rotate(${lean / 20}deg)` }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { start.current = null; setDx(0); }}
        role="group" aria-label={`${a} or ${b}. Swipe left for ${a}, right for ${b}.`}>
        <span class={`tot-side left${dx < -30 ? ' hot' : ''}`}>← {a}</span>
        <span class="tot-or">or</span>
        <span class={`tot-side right${dx > 30 ? ' hot' : ''}`}>{b} →</span>
      </div>
      <div class="tot-pair">
        <button type="button" class="tot-btn" onClick={() => pick(0)}>{a}</button>
        <span class="tot-or">or</span>
        <button type="button" class="tot-btn" onClick={() => pick(1)}>{b}</button>
      </div>
    </div>
  );
}
