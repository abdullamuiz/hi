import { useEffect, useState } from 'preact/hooks';
import { defineDrop } from './types';
import { parseDay, timeLeft } from './logic';

type Content = { title: string; date: string; atMs: number };

const CELEBRATED = 'hi.countdown.celebrated';

export default defineDrop<Content>({
  type: 'countdown',
  title: 'Countdown',
  trayDescription: 'Count down to something together',
  order: 10,
  solo: true,
  content: { title: 'Our trip', date: '', atMs: 0 },
  setup: [
    { key: 'title', label: 'Counting down to', kind: 'text', maxLength: 80 },
    { key: 'date', label: 'Date', kind: 'date' },
  ],
  prepare(c) {
    const at = parseDay(c.date);
    if (!Number.isFinite(at)) return 'Pick a date.';
    if (at + 86400000 <= Date.now()) return 'Pick today or a date in the future.';
    return { ...c, atMs: at };
  },
  subtitle: (c) => (c.date ? new Date(c.atMs || parseDay(c.date)).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Countdown'),
  pinTitle: (c) => `Countdown · ${c.title}`,
  pinDetail: (c) => new Date(c.atMs).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }),

  Renderer({ content, api }) {
    const [now, setNow] = useState(Date.now());
    const [draft, setDraft] = useState('');
    useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
    const at = content.atMs || parseDay(content.date);
    const left = at - now;
    const today = left <= 0;
    const over = now >= at + 86400000;

    // On the day: confetti once per phone.
    useEffect(() => {
      if (!today || over) return;
      const id = `${api.createdBy.uid}:${at}`;
      let seen: string[] = [];
      try { seen = JSON.parse(localStorage.getItem(CELEBRATED) || '[]'); } catch { /* ignore */ }
      if (seen.includes(id)) return;
      try { localStorage.setItem(CELEBRATED, JSON.stringify([...seen, id].slice(-50))); } catch { /* ignore */ }
      import('../ui/Effects').then((m) => m.playScreen('confetti')).catch(() => {});
    }, [today, over]);

    const days = Math.ceil(left / 86400000);
    return (
      <div class="stack-10">
        <div class={`countdown${today ? ' today' : ''}`} role="timer" aria-live="off">
          <div class="cd-num">{today ? (over ? '✓' : '🎉') : days}</div>
          <div class="cd-label">{today ? (over ? `${content.title} has been and gone` : `It’s today: ${content.title}!`) : `${days === 1 ? 'day' : 'days'} until ${content.title}`}</div>
          {!today && <div class="cd-sub">{timeLeft(left)} left</div>}
        </div>
        {api.entries.length > 0 && (
          <div class="story">
            {api.entries.map((e) => <div key={e.id} class={`story-line${e.uid === api.me.uid ? ' me' : ''}`}>{e.text}</div>)}
          </div>
        )}
        <div class="story-add">
          <label for={`cd-${at}`} class="sr">Add a note</label>
          <input id={`cd-${at}`} class="field" value={draft} maxLength={200} placeholder="Add a note or idea…" autocomplete="off"
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) { api.addEntry(draft.trim()); setDraft(''); } }} />
          <button type="button" class="btn-ghost" disabled={!draft.trim()} onClick={() => { api.addEntry(draft.trim()); setDraft(''); }}>Add</button>
        </div>
      </div>
    );
  },
});
