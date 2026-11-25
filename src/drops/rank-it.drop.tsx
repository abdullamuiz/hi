import { useState } from 'preact/hooks';
import { defineDrop } from './types';
import { agreement } from './logic';

type Content = { prompt: string; items: string[] };
const K = 'rank';

export default defineDrop<Content>({
  type: 'rank-it',
  title: 'Rank It',
  trayDescription: 'Order a list, compare rankings',
  order: 7,
  content: { prompt: 'Best films of all time', items: ['Spirited Away', 'The Godfather', 'Paddington 2', 'Inception', 'Up'] },
  setup: [
    { key: 'prompt', label: 'What are you ranking?', kind: 'text', maxLength: 100 },
    { key: 'items', label: 'Items (one per line, 3–6)', kind: 'lines', min: 3, max: 6 },
  ],
  subtitle: () => 'Rank privately',
  pinTitle: (c) => `Rank It · ${c.prompt}`,
  pinDetail(_c, api) {
    const a = api.mine<number[]>(K);
    const b = api.theirs<number[]>(K);
    return a && b ? `${agreement(a, b)}% in agreement` : 'Not revealed yet';
  },

  Renderer({ content, api }) {
    const items = content.items.slice(0, 6);
    const [order, setOrder] = useState<number[]>(() => items.map((_, i) => i));
    const [busy, setBusy] = useState(false);
    const p = api.partner.name;
    const move = (pos: number, d: -1 | 1) => {
      const to = pos + d;
      if (to < 0 || to >= order.length) return;
      const next = [...order];
      [next[pos], next[to]] = [next[to], next[pos]];
      setOrder(next);
    };

    if (!api.iLocked(K)) {
      return (
        <div class="stack-10">
          <div class="q">{content.prompt}</div>
          <ol class="rank-list" aria-label="Your ranking, best first">
            {order.map((item, pos) => (
              <li key={item} class="rank-row">
                <span class="rank-n">{pos + 1}</span>
                <span class="rank-name">{items[item]}</span>
                <button type="button" class="rank-btn" disabled={pos === 0} onClick={() => move(pos, -1)} aria-label={`Move ${items[item]} up`}>▲</button>
                <button type="button" class="rank-btn" disabled={pos === order.length - 1} onClick={() => move(pos, 1)} aria-label={`Move ${items[item]} down`}>▼</button>
              </li>
            ))}
          </ol>
          <div class="note plain">{api.theyLocked(K) ? `${p} has ranked · hidden` : `${p} hasn't ranked yet`}</div>
          <button type="button" class="btn-primary" disabled={busy}
            onClick={async () => { setBusy(true); try { await api.lock(K, order); } finally { setBusy(false); } }}>
            Lock my ranking
          </button>
        </div>
      );
    }
    const a = api.mine<number[]>(K)!;
    const b = api.theirs<number[]>(K);
    return (
      <div class="stack-10">
        <div class="q">{content.prompt}</div>
        {b ? <RankLines a={a} b={b} items={items} p={p} /> : (
          <div class="rank-cols">
            <ol class="rank-col me" aria-label="Your ranking">{a.map((i) => <li key={i}>{items[i]}</li>)}</ol>
            <div class="reveal-card hidden waiting"><div class="reveal-who">{p}</div><div class="reveal-ans">?</div></div>
          </div>
        )}
        {b
          ? <div class="gap-line"><div class="gap-num">{agreement(a, b)}%</div><div class="gap-txt">in agreement</div></div>
          : <div class="note">{api.theyLocked(K) ? 'Revealing…' : `Waiting for ${p} to rank`}</div>}
      </div>
    );
  },
});

const ROW = 40;

/** Both rankings side by side, with a line joining each item to where the other person put it. */
function RankLines({ a, b, items, p }: { a: number[]; b: number[]; items: string[]; p: string }) {
  const n = Math.min(a.length, b.length);
  const posB = new Map(b.map((item, i) => [item, i]));
  return (
    <div class="rank-lines" style={{ '--rows': n } as any}>
      <ol class="rank-col me" aria-label="Your ranking">{a.slice(0, n).map((i, k) => <li key={i} style={{ height: `${ROW}px` }}><b>{k + 1}</b> {items[i]}</li>)}</ol>
      <svg class="rank-svg" viewBox={`0 0 40 ${n * ROW}`} preserveAspectRatio="none" width="40" height={n * ROW} aria-hidden="true">
        {a.slice(0, n).map((item, k) => {
          const j = posB.get(item) ?? k;
          const y1 = k * ROW + ROW / 2;
          const y2 = j * ROW + ROW / 2;
          return <path key={item} class={`rank-link${j === k ? ' same' : ''}`} style={{ '--k': k } as any}
            d={`M0,${y1} C20,${y1} 20,${y2} 40,${y2}`} />;
        })}
      </svg>
      <ol class="rank-col them" aria-label={`${p}’s ranking`}>{b.slice(0, n).map((i, k) => <li key={i} style={{ height: `${ROW}px` }}><b>{k + 1}</b> {items[i]}</li>)}</ol>
    </div>
  );
}
