import { useState } from 'preact/hooks';
import { defineDrop } from './types';
import { RevealPair } from './parts';
import { MoodIcon, MOODS } from '../ui/icons';
import type { MoodId } from '../types';

type Content = { prompt: string };
type Answer = { mood: MoodId; note: string };
const K = 'mood';
const label = (m: MoodId) => MOODS.find((x) => x.id === m)?.label || m;

export default defineDrop<Content>({
  type: 'mood-check',
  title: 'Mood Check',
  trayDescription: 'How are you both, really?',
  order: 15,
  content: { prompt: 'How are you feeling right now?' },
  subtitle: () => 'Hidden until you both answer',
  pinDetail(_c, api) {
    const a = api.mine<Answer>(K);
    const b = api.theirs<Answer>(K);
    return a && b ? `You: ${label(a.mood)} · ${api.partner.name}: ${label(b.mood)}` : 'Still waiting';
  },

  Renderer({ content, api }) {
    const [mood, setMood] = useState<MoodId | null>(null);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const p = api.partner.name;

    if (!api.iLocked(K)) {
      return (
        <div class="stack-10">
          <div class="q">{content.prompt}</div>
          <div class="mood-pick" role="radiogroup" aria-label="Your mood">
            {MOODS.map((m) => (
              <button type="button" key={m.id} role="radio" aria-checked={mood === m.id} class={`mood-opt${mood === m.id ? ' on' : ''}`} onClick={() => setMood(m.id)}>
                <MoodIcon mood={m.id} size={30} />
                <span>{m.label}</span>
              </button>
            ))}
          </div>
          <label for="mc-note" class="sr">A line about it (optional)</label>
          <input id="mc-note" class="field" maxLength={120} value={note} placeholder="A line about it (optional)" autocomplete="off" onInput={(e) => setNote(e.currentTarget.value)} />
          <div class="note plain">{api.theyLocked(K) ? `${p} has answered · hidden` : `${p} hasn't answered yet`}</div>
          <button type="button" class="btn-primary" disabled={!mood || busy}
            onClick={async () => { setBusy(true); try { await api.lock(K, { mood, note: note.trim().slice(0, 120) }); } finally { setBusy(false); } }}>
            Share
          </button>
        </div>
      );
    }
    const a = api.mine<Answer>(K)!;
    const b = api.theirs<Answer>(K);
    const card = (x: Answer) => (<><span class="mood-big"><MoodIcon mood={x.mood} size={34} /> {label(x.mood)}</span>{x.note && <span class="mood-note">{x.note}</span>}</>);
    return <RevealPair me={card(a)} them={b ? card(b) : null} partner={p} revealed={!!b && api.revealed(K)} hiddenNote="Shows when they answer" beatKey={`mc:${api.dropId}`} />;
  },
});
