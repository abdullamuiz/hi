import { useState } from 'preact/hooks';
import { defineDrop } from './types';

type Content = { question: string };
const K = 'answer';

export default defineDrop<Content>({
  type: 'blind-reveal',
  title: 'Blind Reveal',
  trayDescription: 'Answer privately, flip together',
  order: 2,
  content: { question: 'One word for how the ending made you feel?' },
  setup: [{ key: 'question', label: 'Question', kind: 'text', maxLength: 140 }],
  subtitle: () => 'Answer privately',
  pinTitle: (c) => `Blind Reveal · ${c.question}`,
  pinDetail(_c, api) {
    const a = api.mine<string>(K);
    const b = api.theirs<string>(K);
    return a && b && api.iLocked(K) ? `${api.me.name}: ${a} · ${api.partner.name}: ${b}` : 'Still waiting on answers';
  },

  Renderer({ content, api }) {
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const p = api.partner.name;
    const locked = api.iLocked(K);
    const inputId = `br-${api.createdBy.uid}-${content.question.length}`;

    const lock = async () => {
      const a = draft.trim().slice(0, 120);
      if (!a || busy) return;
      setBusy(true);
      try { await api.lock(K, a); } finally { setBusy(false); }
    };

    return (
      <div class="stack">
        <div class="q">{content.question}</div>
        {!locked && (
          <div class="stack-10">
            <label for={inputId} class="sr">Your answer</label>
            <input
              id={inputId}
              class="field"
              value={draft}
              maxLength={120}
              onInput={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') lock(); }}
              placeholder="Your answer, kept private"
              autocomplete="off"
            />
            <div class="note">{api.theyLocked(K) ? `${p} has answered · hidden` : `${p} hasn't answered yet · hidden either way`}</div>
            {draft.trim()
              ? <button type="button" class="btn-primary" onClick={lock} disabled={busy}>Lock in &amp; flip</button>
              : <button type="button" class="btn-primary" disabled>Type an answer first</button>}
          </div>
        )}
        {locked && (
          <div class="reveal-grid">
            <div class="reveal-card me">
              <div class="reveal-who">You</div>
              <div class="reveal-ans">{api.mine<string>(K)}</div>
            </div>
            {api.revealed(K)
              ? (
                <div class="reveal-card them">
                  <div class="reveal-who">{p}</div>
                  <div class="reveal-ans">{api.theirs<string>(K)}</div>
                </div>
              ) : (
                <div class="reveal-card hidden">
                  <div class="reveal-who">{p}</div>
                  <div class="reveal-ans" aria-label="Hidden">?</div>
                  <div style={{ fontSize: '12px' }}>Flips when they lock in</div>
                </div>
              )}
          </div>
        )}
      </div>
    );
  },
});
