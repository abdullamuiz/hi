import { useEffect, useRef, useState } from 'preact/hooks';
import { defineDrop } from './types';
import { sliceAt, wheelLanding, wheelPick } from './logic';
import { buzz, fxOn, once, played } from './fx';

type Content = { question: string };

/**
 * Both add options; either person spins. The result is derived from the options'
 * ids, so both phones land on the same one without a server.
 */
export default defineDrop<Content>({
  type: 'decision-wheel',
  title: 'Decision Wheel',
  trayDescription: 'Add options, spin to decide',
  order: 8,
  solo: true,
  content: { question: 'Where should we eat?' },
  setup: [{ key: 'question', label: 'What are you deciding?', kind: 'text', maxLength: 100 }],
  subtitle: () => 'Let the wheel decide',
  pinTitle: (c) => `Decision Wheel · ${c.question}`,
  pinDetail(_c, api) {
    const r = result(api.entries, api.myProgress, api.theirProgress);
    return r ? `The wheel chose: ${r.text}` : 'Not spun yet';
  },

  Renderer({ content, api }) {
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const options = api.entries.slice(0, 12);
    const r = result(api.entries, api.myProgress, api.theirProgress);
    const p = api.partner.name;
    const shown = r ? r.pool : options;
    const target = r ? wheelLanding(r.pool.map((o) => o.id), r.index) : 0;
    // The spin plays once per phone (whoever pressed Spin, and the other person when they look).
    const [rot, setRot] = useState(() => (r && played(`wheel:${api.dropId}`) ? target : 0));
    const [phase, setPhase] = useState<'idle' | 'spinning' | 'landed'>(() => (r && played(`wheel:${api.dropId}`) ? 'landed' : 'idle'));
    const [tick, setTick] = useState(0);
    const raf = useRef(0);

    useEffect(() => {
      if (!r || phase !== 'idle') return;
      if (!once(`wheel:${api.dropId}`) || !fxOn()) { setRot(target); setPhase('landed'); return; }
      setPhase('spinning');
      const n = r.pool.length;
      const dur = 4200;
      const t0 = performance.now();
      let lastSlice = sliceAt(0, n);
      const frame = (now: number) => {
        const t = Math.min(1, (now - t0) / dur);
        const eased = 1 - (1 - t) ** 4; // fast whirl, long slow-down
        const deg = target * eased;
        setRot(deg);
        const sl = sliceAt(deg, n);
        if (sl !== lastSlice) { lastSlice = sl; setTick((k) => k + 1); buzz(4); }
        if (t < 1) raf.current = requestAnimationFrame(frame);
        else { setPhase('landed'); buzz([10, 30, 20]); }
      };
      raf.current = requestAnimationFrame(frame);
      return () => cancelAnimationFrame(raf.current);
    }, [!!r]);

    const add = async () => {
      const t = draft.trim();
      if (!t || busy || r) return;
      setBusy(true);
      try { await api.addEntry(t.slice(0, 80)); setDraft(''); } finally { setBusy(false); }
    };
    const spin = async () => {
      if (options.length < 2 || busy) return;
      setBusy(true);
      try { await api.setMyProgress({ spun: options.length }); } finally { setBusy(false); }
    };

    return (
      <div class="stack-10">
        <div class="q">{content.question}</div>
        {shown.length >= 2 && (
          <Wheel options={shown} rot={rot} tick={tick} landed={phase === 'landed'} winner={r && phase === 'landed' ? r.index : -1} me={api.me.uid} />
        )}
        <ul class={`wheel-list${r ? ' done' : ''}`} aria-label="Options">
          {shown.map((o, i) => (
            <li key={o.id} class={`wheel-opt${r && phase === 'landed' && r.index === i ? ' on' : ''}${o.uid === api.me.uid ? ' me' : ''}`}>{o.text}</li>
          ))}
          {!options.length && <li class="note plain">No options yet. Add a few, {p} can too.</li>}
        </ul>
        {r ? (
          phase === 'landed'
            ? <div class="gap-line" role="status"><div class="gap-txt">The wheel chose <b>{r.text}</b>.</div></div>
            : <div class="note plain" role="status">Spinning…</div>
        ) : (<>
          <div class="story-add">
            <label for="wheel-add" class="sr">Add an option</label>
            <input id="wheel-add" class="field" value={draft} maxLength={80} placeholder="Add an option…" autocomplete="off"
              onInput={(e) => setDraft(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
            <button type="button" class="btn-ghost" onClick={add} disabled={busy || !draft.trim()}>Add</button>
          </div>
          <button type="button" class="btn-primary" onClick={spin} disabled={busy || options.length < 2}>
            {options.length < 2 ? 'Add at least 2 options' : 'Spin the wheel'}
          </button>
        </>)}
      </div>
    );
  },
});

const SLICE_COLOURS = ['#1E7F93', '#F2A15F', '#7C8CF0', '#6FB36F', '#D96C8A', '#E8C547', '#4FA3B8', '#C98A5A', '#9B7FD1', '#58A37A', '#E07A6E', '#B8A140'];

/** The wheel itself: SVG slices that rotate under a fixed pointer. */
function Wheel({ options, rot, tick, landed, winner, me }: {
  options: Opt[]; rot: number; tick: number; landed: boolean; winner: number; me: string;
}) {
  const n = options.length;
  const R = 110;
  const C = 120;
  const slice = (Math.PI * 2) / n;
  const pt = (a: number, r = R) => [C + r * Math.sin(a), C - r * Math.cos(a)];
  return (
    <div class={`wheel-wrap${landed ? ' landed' : ''}`}>
      <svg class={`wheel-pointer${tick % 2 ? ' tock' : ''}`} viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M12 22 3 4h18z" /></svg>
      <svg class="wheel" viewBox="0 0 240 240" width="240" height="240" role="img"
        aria-label={landed && winner >= 0 ? `Wheel stopped on ${options[winner].text}` : `Wheel with ${n} options`}>
        <g style={{ transform: `rotate(${rot}deg)`, transformOrigin: '120px 120px' }}>
          {options.map((o, i) => {
            const a0 = i * slice;
            const a1 = (i + 1) * slice;
            const [x0, y0] = pt(a0);
            const [x1, y1] = pt(a1);
            const mid = (a0 + a1) / 2;
            const [tx, ty] = pt(mid, R * 0.6);
            const label = o.text.length > 14 ? `${o.text.slice(0, 13)}…` : o.text;
            return (
              <g key={o.id} class={winner === i ? 'win' : ''}>
                <path d={`M${C},${C} L${x0},${y0} A${R},${R} 0 ${slice > Math.PI ? 1 : 0} 1 ${x1},${y1} Z`}
                  fill={SLICE_COLOURS[i % SLICE_COLOURS.length]} stroke="#fff" stroke-width="2" />
                <text x={tx} y={ty} class={`wheel-label${o.uid === me ? ' me' : ''}`} text-anchor="middle" dominant-baseline="middle"
                  transform={`rotate(${(mid * 180) / Math.PI - 90} ${tx} ${ty})`}>{label}</text>
              </g>
            );
          })}
          <circle cx={C} cy={C} r="16" fill="#fff" stroke="rgba(0,0,0,.15)" />
        </g>
      </svg>
    </div>
  );
}

type Opt = { id: string; uid: string; text: string };

/** The first spin wins: it fixes how many options were on the wheel. */
function result(entries: Opt[], mine: Record<string, unknown>, theirs: Record<string, unknown>) {
  const counts = [mine.spun, theirs.spun].filter((x): x is number => typeof x === 'number' && x >= 2);
  if (!counts.length) return null;
  const pool = entries.slice(0, Math.min(...counts, 12));
  if (pool.length < 2) return null;
  const index = wheelPick(pool.map((o) => o.id));
  return { pool, index, text: pool[index].text };
}
