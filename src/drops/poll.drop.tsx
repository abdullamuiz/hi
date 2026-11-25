import { useState } from 'preact/hooks';
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
    return (
      <div class="stack-10">
        <div class="q">{content.question}</div>
        <div class="opt-list" aria-label="Results">
          {opts.map((t, i) => (
            <div key={i} class={`opt static${i === a ? ' guessed' : ''}`}>
              <span>{t}</span>
              <span class="opt-tags">
                {i === a && <span class="tag">You</span>}
                {b === i && <span class="tag them-tag">{p}</span>}
              </span>
            </div>
          ))}
        </div>
        <div class="note">{b == null ? (api.theyLocked(K) ? 'Revealing…' : `Waiting for ${p} to vote`) : a === b ? 'You agree!' : 'Split vote. Talk it out?'}</div>
      </div>
    );
  },
});
