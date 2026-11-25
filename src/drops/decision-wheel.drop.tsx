import { useEffect, useRef, useState } from 'preact/hooks';
import { defineDrop } from './types';
import { wheelPick } from './logic';

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
    const [show, setShow] = useState<number | null>(null);
    const animated = useRef(false);
    const options = api.entries.slice(0, 12);
    const r = result(api.entries, api.myProgress, api.theirProgress);
    const p = api.partner.name;

    // Animate once when the result first appears on this phone.
    useEffect(() => {
      if (!r || animated.current) return;
      animated.current = true;
      const n = r.pool.length;
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce || n < 2) { setShow(r.index); return; }
      const steps = n * 2 + r.index + 1;
      let i = 0;
      let t: ReturnType<typeof setTimeout>;
      const tick = () => {
        setShow(i % n);
        i++;
        if (i < steps) t = setTimeout(tick, 60 + (i / steps) ** 3 * 380);
        else setShow(r.index);
      };
      tick();
      return () => clearTimeout(t);
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
        <ul class={`wheel-list${r ? ' done' : ''}`} aria-label="Options">
          {(r ? r.pool : options).map((o, i) => (
            <li key={o.id} class={`wheel-opt${show === i ? ' on' : ''}${o.uid === api.me.uid ? ' me' : ''}`}>{o.text}</li>
          ))}
          {!options.length && <li class="note plain">No options yet. Add a few, {p} can too.</li>}
        </ul>
        {r ? (
          show === r.index && <div class="gap-line" role="status"><div class="gap-txt">The wheel chose <b>{r.text}</b>.</div></div>
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
