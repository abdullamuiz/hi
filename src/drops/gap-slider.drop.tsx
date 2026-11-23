import { useState } from 'preact/hooks';
import { defineDrop } from './types';

type Content = { question: string; left: string; right: string };
const K = 'take';

const prompt = (gap: number) =>
  gap < 15 ? 'Basically the same take.' : gap < 40 ? 'Close-ish. Who budges?' : 'Big gap. Make your case in one message.';

export default defineDrop<Content>({
  type: 'gap-slider',
  title: 'Gap Slider',
  trayDescription: 'See how far apart your takes are',
  order: 3,
  content: { question: 'Was the long runtime worth it?', left: 'Not at all', right: 'Every minute' },
  setup: [
    { key: 'question', label: 'Hot take', kind: 'text', maxLength: 140 },
    { key: 'left', label: 'Left end', kind: 'text', maxLength: 30 },
    { key: 'right', label: 'Right end', kind: 'text', maxLength: 30 },
  ],
  subtitle: () => 'Hot take',
  pinTitle: (c) => `Gap Slider · ${c.question}`,
  pinDetail(_c, api) {
    const a = api.mine<number>(K);
    const b = api.theirs<number>(K);
    return a != null && b != null ? `${Math.abs(a - b)} points apart` : 'Not locked yet';
  },

  Renderer({ content, api }) {
    const [val, setVal] = useState(50);
    const [busy, setBusy] = useState(false);
    const p = api.partner.name;
    const locked = api.iLocked(K);
    const mine = api.mine<number>(K);
    const theirs = api.theirs<number>(K);
    const inputId = `gs-${api.createdBy.uid}-${content.question.length}`;

    const ends = <div class="ends"><span>{content.left}</span><span>{content.right}</span></div>;

    return (
      <div class="stack">
        <div class="q">{content.question}</div>
        {!locked && (
          <div class="stack" style={{ gap: '8px' }}>
            <label for={inputId} class="sr">Your take</label>
            <input
              id={inputId}
              class="range"
              type="range"
              min={0}
              max={100}
              value={val}
              onInput={(e) => setVal(Number(e.currentTarget.value))}
            />
            {ends}
            <div class="note plain">{api.theyLocked(K) ? `${p} has locked their take · hidden` : `${p} hasn't slid yet`}</div>
            <button
              type="button"
              class="btn-primary"
              disabled={busy}
              onClick={async () => { setBusy(true); try { await api.lock(K, val); } finally { setBusy(false); } }}
            >
              Lock my take
            </button>
          </div>
        )}
        {locked && mine != null && (
          <div class="stack">
            <div class="track">
              {theirs != null && <div class="mark them" style={{ left: `calc(${theirs}% - 10px)` }} />}
              <div class="mark me" style={{ left: `calc(${mine}% - 10px)` }} />
            </div>
            {ends}
            {theirs != null ? (
              <div class="gap-line">
                <div class="gap-num">{Math.abs(mine - theirs)}</div>
                <div class="gap-txt">points apart. {prompt(Math.abs(mine - theirs))}</div>
              </div>
            ) : (
              <div class="note">Locked · {p}'s take appears when they lock theirs</div>
            )}
          </div>
        )}
      </div>
    );
  },
});
