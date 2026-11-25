import { useEffect, useState } from 'preact/hooks';
import { defineDrop } from './types';
import { decodeReaction, encodeReaction, sharedMoments, type Reaction } from './logic';

type Content = { title: string };

const RX: { code: string; emoji: string; label: string }[] = [
  { code: 'laugh', emoji: '😂', label: 'Funny' },
  { code: 'wow', emoji: '😮', label: 'Wow' },
  { code: 'sad', emoji: '😢', label: 'Sad' },
  { code: 'love', emoji: '❤️', label: 'Love it' },
  { code: 'scared', emoji: '😱', label: 'Scary' },
  { code: 'bored', emoji: '🥱', label: 'Boring' },
];
const EMOJI: Record<string, string> = Object.fromEntries(RX.map((r) => [r.code, r.emoji]));

/** Each taps reactions as they watch; afterwards both strips line up. */
export default defineDrop<Content>({
  type: 'watch-party',
  title: 'Watch Party',
  trayDescription: 'React along while you watch',
  order: 9,
  content: { title: 'Tonight’s film' },
  setup: [{ key: 'title', label: 'What are you watching?', kind: 'text', maxLength: 80 }],
  subtitle: (c) => c.title,
  pinTitle: (c) => `Watch Party · ${c.title}`,
  pinDetail(_c, api) {
    const rx = reactions(api.entries);
    const shared = sharedMoments(rx, api.me.uid, api.partner.uid);
    return `${rx.length} reactions · ${shared.length} shared moment${shared.length === 1 ? '' : 's'}`;
  },

  Renderer({ content, api }) {
    const start = typeof api.myProgress.start === 'number' ? (api.myProgress.start as number) : null;
    const done = api.myProgress.done === true;
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
      if (!start || done) return;
      const t = setInterval(() => setNow(Date.now()), 15000);
      return () => clearInterval(t);
    }, [start, done]);
    const minute = start ? Math.floor((now - start) / 60000) : 0;
    const rx = reactions(api.entries);
    const span = Math.max(10, ...rx.map((r) => r.minute + 1), start && !done ? minute + 1 : 0);
    const shared = sharedMoments(rx, api.me.uid, api.partner.uid);
    const p = api.partner.name;

    const strip = (uid: string, who: string, cls: string) => (
      <div class="wp-strip" aria-label={`${who}’s reactions`}>
        <span class="wp-who">{who}</span>
        <div class={`wp-track ${cls}`}>
          {rx.filter((r) => r.uid === uid).map((r, i) => (
            <span key={i} class="wp-mark" style={{ left: `${(r.minute / span) * 100}%` }} title={`${r.minute} min`}>{EMOJI[r.code] || '•'}</span>
          ))}
        </div>
      </div>
    );

    return (
      <div class="stack-10">
        <div class="q">{content.title}</div>
        {!start ? (
          <button type="button" class="btn-primary" onClick={() => api.setMyProgress({ start: Date.now() })}>Start my timer</button>
        ) : !done ? (<>
          <div class="note plain" role="status">{minute} min in · tap how it feels</div>
          <div class="rx-row wp-buttons" role="group" aria-label="React now">
            {RX.map((r) => (
              <button type="button" key={r.code} class="rx-opt" aria-label={`${r.label} at ${minute} minutes`}
                onClick={() => { setNow(Date.now()); api.addEntry(encodeReaction(r.code, Math.floor((Date.now() - start) / 60000))); }}>
                {r.emoji}
              </button>
            ))}
          </div>
          <button type="button" class="btn-ghost" onClick={() => api.setMyProgress({ done: true })}>Finished watching</button>
        </>) : <div class="note plain">You finished · {api.theirProgress.done ? `${p} too` : `${p} is still watching`}</div>}
        {strip(api.me.uid, 'You', 'me')}
        {api.partner.uid && strip(api.partner.uid, p, 'them')}
        <div class="wp-scale"><span>0</span><span>{span} min</span></div>
        {shared.length > 0 && <div class="gap-line"><div class="gap-num">{shared.length}</div>
          <div class="gap-txt">shared moment{shared.length === 1 ? '' : 's'}, at {shared.slice(0, 4).map((m) => `${m} min`).join(', ')}</div></div>}
      </div>
    );
  },
});

function reactions(entries: { uid: string; text: string }[]): Reaction[] {
  return entries.map((e) => decodeReaction(e.uid, e.text)).filter((r): r is Reaction => !!r);
}
