import { useEffect, useState } from 'preact/hooks';
import { burst, fxOn, useOnceWhen } from './fx';
import { defineDrop } from './types';
import { Options } from './parts';

type Content = { question: string; options: string[] };
const K = 'vote';

/** Votes stay hidden until both of you have voted. */
export default defineDrop<Content>({
  type: 'poll',
  title: 'Poll',
  trayDescription: 'Vote; results show when you both have',
  order: 12,
  content: { question: 'Holiday this year?', options: ['Beach', 'City break', 'Mountains', 'Stay home'] },
  setup: [
    { key: 'question', label: 'Question', kind: 'text', maxLength: 140 },
    { key: 'options', label: 'Options (one per line, 2–6)', kind: 'lines', min: 2, max: 6 },
  ],
  subtitle: () => 'Hidden until you both vote',
  pinTitle: (c) => `Poll · ${c.question}`,
  pinDetail(c, api) {
    const a = api.mine<number>(K);
    const b = api.theirs<number>(K);
    if (a == null || b == null || !api.revealed(K)) return 'Votes still hidden';
    return a === b ? `Both: ${c.options[a]}` : `You: ${c.options[a]} · ${api.partner.name}: ${c.options[b]}`;
  },

  Renderer({ content, api }) {
    const [pick, setPick] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const opts = content.options.slice(0, 6);
    const p = api.partner.name;

    if (!api.iLocked(K)) {
      return (
        <div class="stack-10">
          <div class="q">{content.question}</div>
          <Options items={opts} value={pick} onPick={setPick} label="Your vote" />
          <div class="note plain">{api.theyLocked(K) ? `${p} has voted · hidden` : `${p} hasn't voted yet`}</div>
          <button type="button" class="btn-primary" disabled={pick == null || busy}
            onClick={async () => { setBusy(true); try { await api.lock(K, pick); } finally { setBusy(false); } }}>Vote</button>
        </div>
      );
    }
    const a = api.mine<number>(K)!;
    const b = api.revealed(K) ? api.theirs<number>(K)! : null;
    return <PollResults question={content.question} opts={opts} a={a} b={b} p={p} waiting={api.theyLocked(K) ? 'Revealing…' : `Waiting for ${p} to vote`} onceKey={`poll:${api.dropId}`} />;
  },
});

/** Results as bars that race to their size once both have voted; agreement earns a crown. */
function PollResults({ question, opts, a, b, p, waiting, onceKey }: {
  question: string; opts: string[]; a: number; b: number | null; p: string; waiting: string; onceKey: string;
}) {
  const done = b != null;
  const [grown, setGrown] = useState(!fxOn());
  useEffect(() => { if (!done) return; const t = requestAnimationFrame(() => setGrown(true)); return () => cancelAnimationFrame(t); }, [done]);
  useOnceWhen(done && a === b, onceKey, () => burst('crown'));
  const votes = (i: number) => Number(i === a) + Number(done && i === b);
  const top = done ? Math.max(...opts.map((_, i) => votes(i))) : 0;
  return (
    <div class="stack-10">
      <div class="q">{question}</div>
      <div class="opt-list poll-results" aria-label="Results">
        {opts.map((t, i) => {
          const v = votes(i);
          const winner = done && v === top && top > 0 && a === b;
          return (
            <div key={i} class={`opt static poll-row${i === a ? ' guessed' : ''}${winner ? ' winner' : ''}`}>
              {done && <span class="poll-bar" style={{ width: grown ? `${(v / 2) * 100}%` : '0%' }} aria-hidden="true" />}
              <span class="poll-label">{winner && <span class="poll-crown" aria-label="Winner">👑 </span>}{t}</span>
              <span class="opt-tags">
                {i === a && <span class="tag">You</span>}
                {b === i && <span class="tag them-tag">{p}</span>}
              </span>
            </div>
          );
        })}
      </div>
      <div class="note">{!done ? waiting : a === b ? 'You agree! 👑' : 'Split vote. Talk it out?'}</div>
    </div>
  );
}
