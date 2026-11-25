import { useState } from 'preact/hooks';
import { defineDrop } from './types';
import { Options } from './parts';

type Content = { question: string; options: string[] };
type Answer = { own: number; guess: number };
const K = 'answer';

export default defineDrop<Content>({
  type: 'predict-me',
  title: 'Predict Me',
  trayDescription: 'Answer, and guess their answer',
  order: 6,
  content: { question: 'Ideal Friday night?', options: ['Out with friends', 'Film on the sofa', 'Early night', 'Cooking something new'] },
  setup: [
    { key: 'question', label: 'Question', kind: 'text', maxLength: 140 },
    { key: 'options', label: 'Choices (one per line, 2–4)', kind: 'lines', min: 2, max: 4 },
  ],
  subtitle: () => 'How well do you know each other?',
  pinTitle: (c) => `Predict Me · ${c.question}`,
  pinDetail(_c, api) {
    const a = api.mine<Answer>(K);
    const b = api.theirs<Answer>(K);
    if (!a || !b) return 'Not revealed yet';
    return `You ${a.guess === b.own ? 'got it' : 'missed'} · ${api.partner.name} ${b.guess === a.own ? 'got it' : 'missed'}`;
  },

  Renderer({ content, api }) {
    const [own, setOwn] = useState<number | null>(null);
    const [guess, setGuess] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const p = api.partner.name;
    const opts = content.options.slice(0, 4);

    if (!api.iLocked(K)) {
      return (
        <div class="stack-10">
          <div class="q">{content.question}</div>
          <div class="field-label">Your answer</div>
          <Options items={opts} value={own} onPick={setOwn} label="Your answer" />
          <div class="field-label">What will {p} say?</div>
          <Options items={opts} value={guess} onPick={setGuess} label={`Your guess for ${p}`} />
          <button type="button" class="btn-primary" disabled={own == null || guess == null || busy}
            onClick={async () => { setBusy(true); try { await api.lock(K, { own, guess }); } finally { setBusy(false); } }}>
            Lock in
          </button>
        </div>
      );
    }
    const a = api.mine<Answer>(K)!;
    const b = api.theirs<Answer>(K);
    if (!b) {
      return (
        <div class="stack-10">
          <div class="q">{content.question}</div>
          <div class="note">You said “{opts[a.own]}” and guessed {p} says “{opts[a.guess]}”. {api.theyLocked(K) ? 'Revealing…' : `Waiting for ${p}`}</div>
        </div>
      );
    }
    const iGot = a.guess === b.own;
    const theyGot = b.guess === a.own;
    return (
      <div class="stack-10">
        <div class="q">{content.question}</div>
        <div class="reveal-grid">
          <div class="reveal-card me">
            <div class="reveal-who">You said</div>
            <div class="reveal-ans">{opts[a.own]}</div>
            <div style={{ fontSize: '12px' }}>{p} guessed {theyGot ? 'right ✓' : `“${opts[b.guess]}”`}</div>
          </div>
          <div class="reveal-card them">
            <div class="reveal-who">{p} said</div>
            <div class="reveal-ans">{opts[b.own]}</div>
            <div style={{ fontSize: '12px' }}>You guessed {iGot ? 'right ✓' : `“${opts[a.guess]}”`}</div>
          </div>
        </div>
        <div class="gap-line"><div class="gap-num">{Number(iGot) + Number(theyGot)}/2</div>
          <div class="gap-txt">{iGot && theyGot ? 'You know each other well.' : iGot || theyGot ? 'One of you is paying attention.' : 'Plenty still to learn!'}</div></div>
      </div>
    );
  },
});
