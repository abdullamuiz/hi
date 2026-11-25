import { useState } from 'preact/hooks';
import { defineDrop } from './types';
import { RevealPair } from './parts';

type Content = { question: string; day: string };
const K = 'answer';

/** One gentle question a day per chat. The app drops it itself (see src/data/daily.ts). */
export default defineDrop<Content>({
  type: 'daily-question',
  title: 'Today’s question',
  trayDescription: 'One question a day',
  hidden: true,
  order: 90,
  content: { question: 'What made you smile today?', day: '' },
  subtitle: () => 'Answers flip when you both reply',
  pinTitle: (c) => `Today’s question · ${c.question}`,
  pinDetail(_c, api) {
    const a = api.mine<string>(K);
    const b = api.theirs<string>(K);
    return a && b ? `You: ${a} · ${api.partner.name}: ${b}` : 'Still waiting on answers';
  },

  Renderer({ content, api }) {
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const p = api.partner.name;
    const lock = async () => {
      const a = draft.trim().slice(0, 200);
      if (!a || busy) return;
      setBusy(true);
      try { await api.lock(K, a); } finally { setBusy(false); }
    };
    return (
      <div class="stack-10">
        <div class="q">{content.question}</div>
        {!api.iLocked(K) ? (<>
          <label for={`dq-${content.day}`} class="sr">Your answer</label>
          <input id={`dq-${content.day}`} class="field" value={draft} maxLength={200} placeholder="Your answer, hidden until you both reply" autocomplete="off"
            onInput={(e) => setDraft(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') lock(); }} />
          <div class="note plain">{api.theyLocked(K) ? `${p} has answered · hidden` : `${p} hasn't answered yet`}</div>
          <button type="button" class="btn-primary" disabled={!draft.trim() || busy} onClick={lock}>Answer</button>
        </>) : (
          <RevealPair me={api.mine<string>(K)} them={api.theirs<string>(K)} partner={p} revealed={api.revealed(K)} hiddenNote="Shows when they answer" />
        )}
      </div>
    );
  },
});
