import { useState } from 'preact/hooks';
import { defineDrop } from './types';
import { Options } from './parts';

type Content = { a: string; b: string; c: string };
// The author locks which one is the lie; the guesser locks a guess under the same key,
// so neither is readable by the other until both are in.
const K = 'lie';

export default defineDrop<Content>({
  type: 'two-truths',
  title: 'Two Truths & a Lie',
  trayDescription: 'Can they spot the lie?',
  order: 5,
  content: { a: 'I once ate a whole pizza alone', b: 'I can juggle', c: 'I’ve never seen snow' },
  setup: [
    { key: 'a', label: 'Statement 1', kind: 'text', maxLength: 120 },
    { key: 'b', label: 'Statement 2', kind: 'text', maxLength: 120 },
    { key: 'c', label: 'Statement 3', kind: 'text', maxLength: 120 },
  ],
  subtitle: () => 'Spot the lie',
  pinTitle: () => 'Two Truths & a Lie',
  pinDetail(c, api) {
    if (!api.revealed(K)) return 'Not guessed yet';
    const author = api.createdBy;
    const lie = author.isMe ? api.mine<number>(K) : api.theirs<number>(K);
    const guess = author.isMe ? api.theirs<number>(K) : api.mine<number>(K);
    const s = [c.a, c.b, c.c][lie ?? 0];
    return guess === lie ? `Spotted the lie: “${s}”` : `Fooled! The lie was “${s}”`;
  },

  Renderer({ content, api }) {
    const [pick, setPick] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const items = [content.a, content.b, content.c];
    const amAuthor = api.createdBy.isMe;
    const p = api.partner.name;
    const locked = api.iLocked(K);
    const lock = async () => {
      if (pick == null || busy) return;
      setBusy(true);
      try { await api.lock(K, pick); } finally { setBusy(false); }
    };

    if (api.revealed(K)) {
      const lie = amAuthor ? api.mine<number>(K)! : api.theirs<number>(K)!;
      const guess = amAuthor ? api.theirs<number>(K)! : api.mine<number>(K)!;
      const right = lie === guess;
      return (
        <div class="stack-10">
          <div class="opt-list">
            {items.map((t, i) => (
              <div key={i} class={`opt static${i === lie ? ' lie' : ''}${i === guess ? ' guessed' : ''}`}>
                <span>{t}</span>
                <span class="opt-tags">
                  {i === lie && <span class="tag lie-tag">Lie</span>}
                  {i === guess && <span class="tag">{amAuthor ? `${p}’s guess` : 'Your guess'}</span>}
                </span>
              </div>
            ))}
          </div>
          <div class="gap-line"><div class="gap-txt">{right
            ? (amAuthor ? `${p} spotted it. Too easy?` : 'You spotted it!')
            : (amAuthor ? `You fooled ${p}.` : `Fooled! ${p} got you.`)}</div></div>
        </div>
      );
    }

    if (amAuthor) {
      if (!locked) {
        return (
          <div class="stack-10">
            <div class="q">Which one is the lie? Only you see this.</div>
            <Options items={items} value={pick} onPick={setPick} label="Mark the lie" />
            <button type="button" class="btn-primary" disabled={pick == null || busy} onClick={lock}>Lock the lie</button>
          </div>
        );
      }
      return (
        <div class="stack-10">
          <div class="opt-list">{items.map((t, i) => <div key={i} class={`opt static${api.mine<number>(K) === i ? ' lie' : ''}`}>{t}</div>)}</div>
          <div class="note">{api.theyLocked(K) ? 'Revealing…' : `Waiting for ${p} to guess`}</div>
        </div>
      );
    }

    if (!locked) {
      return (
        <div class="stack-10">
          <div class="q">Two are true. Which one is the lie?</div>
          <Options items={items} value={pick} onPick={setPick} label="Your guess" />
          <button type="button" class="btn-primary" disabled={pick == null || busy} onClick={lock}>Lock my guess</button>
        </div>
      );
    }
    return (
      <div class="stack-10">
        <div class="opt-list">{items.map((t, i) => <div key={i} class={`opt static${api.mine<number>(K) === i ? ' guessed' : ''}`}>{t}</div>)}</div>
        <div class="note">{api.theyLocked(K) ? 'Revealing…' : `Guess locked · waiting for ${p} to mark the lie`}</div>
      </div>
    );
  },
});
