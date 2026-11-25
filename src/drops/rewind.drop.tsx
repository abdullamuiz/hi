import { useEffect, useState } from 'preact/hooks';
import { defineDrop } from './types';
import { rewindPeriod } from '../lib/rewind';

/** from/to: the period in ms. auto: posted by the app at the start of a month. */
type Content = { from: number; to: number; label: string; auto: boolean };

/** Ask the chat to open the full-screen Rewind for this period. */
export const OPEN_REWIND = 'hi:open-rewind';

type Quick = { total: number; emoji: string; days: number } | null;

export default defineDrop<Content>({
  type: 'rewind',
  title: 'Rewind',
  trayDescription: 'A recap of your month together',
  order: 11,
  content: { from: 0, to: 0, label: '', auto: false },
  // Early in a month, recap last month; otherwise this month so far.
  prepare(c) {
    const day = new Date().getDate();
    const p = rewindPeriod(day <= 7 ? 'last-month' : 'this-month', Date.now());
    return { ...c, from: p.from, to: p.to, label: p.label, auto: false };
  },
  subtitle: (c) => (c.auto ? `${c.label} · monthly` : c.label || 'Recap'),
  pinTitle: (c) => `Rewind · ${c.label}`,
  pinDetail: (c) => `${c.label} recap`,

  Renderer({ content, api }) {
    const [quick, setQuick] = useState<Quick>(null);
    const ready = content.to > content.from;
    useEffect(() => {
      if (!ready || !api.partner.uid) return;
      let alive = true;
      import('../data/memories').then(async (m) => {
        const d = await m.loadRewind(api.roomId, content, api.me.uid, api.partner.uid, m.zoneOf(api.roomId) || 'Indian/Maldives');
        if (alive) setQuick({ total: d.stats.total, emoji: d.stats.topEmojis[0]?.emoji || '', days: d.stats.activeDays });
      }).catch(() => {});
      return () => { alive = false; };
    }, [api.roomId, content.from, content.to, api.partner.uid]);
    const open = () => dispatchEvent(new CustomEvent(OPEN_REWIND, { detail: { from: content.from, to: content.to, label: content.label } }));
    return (
      <div class="stack">
        <div class="q">📼 {content.label} with {api.partner.name}</div>
        {quick && (
          <div class="rewind-mini">
            <span><b>{quick.total.toLocaleString('en')}</b> messages</span>
            <span><b>{quick.days}</b> {quick.days === 1 ? 'day' : 'days'}</span>
            {quick.emoji && <span>Top {quick.emoji}</span>}
          </div>
        )}
        <button type="button" class="btn-primary" disabled={!ready} onClick={open}>Watch Rewind</button>
      </div>
    );
  },
});
