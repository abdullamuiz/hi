import { useState } from 'preact/hooks';
import { defineDrop } from './types';

type Content = { opening: string; maxLines: number };

export default defineDrop<Content>({
  type: 'tag-team-story',
  title: 'Tag-team Story',
  trayDescription: 'Write a story one line each',
  order: 4,
  content: { opening: 'The ship drifted past the last moon in the system.', maxLines: 8 },
  setup: [{ key: 'opening', label: 'Your first line', kind: 'text', maxLength: 280 }],
  subtitle: () => 'One line each',
  initialEntries: (c) => (c.opening.trim() ? [c.opening.trim()] : []),
  // Turn-based: whoever didn't write the last line is up, until the story is full.
  waitingOn(c, api) {
    const max = Math.max(2, Math.min(20, Number(c.maxLines) || 8));
    const lines = api.entries.slice(0, max);
    if (lines.length >= max) return null;
    const last = lines[lines.length - 1];
    if (!last) return 'me';
    return last.uid === api.me.uid ? 'partner' : 'me';
  },
  pinDetail: (_c, api) => api.entries.map((e) => e.text).join(' '),

  Renderer({ content, api }) {
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const max = Math.max(2, Math.min(20, Number(content.maxLines) || 8));
    const lines = api.entries.slice(0, max);
    const p = api.partner.name;
    const done = lines.length >= max;
    const last = lines[lines.length - 1];
    const myTurn = !last || last.uid !== api.me.uid;
    const inputId = `ts-${api.createdBy.uid}-${content.opening.length}`;

    const add = async () => {
      const t = draft.trim();
      if (!t || done || !myTurn || busy) return;
      setBusy(true);
      try { await api.addEntry(t); setDraft(''); } finally { setBusy(false); }
    };

    return (
      <div class="stack-10">
        <div class="story">
          {lines.map((l) => <div key={l.id} class={`story-line${l.uid === api.me.uid ? ' me' : ''}`}>{l.text}</div>)}
        </div>
        <div class="story-meta">{lines.length} / {max} lines · blue = you, orange = {p}</div>
        {!done && myTurn && (
          <div class="story-add">
            <label for={inputId} class="sr">Your next line</label>
            <input
              id={inputId}
              class="field"
              value={draft}
              maxLength={280}
              onInput={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
              placeholder="Write the next line…"
              autocomplete="off"
            />
            <button type="button" class="btn-primary" onClick={add} disabled={busy}>Add</button>
          </div>
        )}
        {!done && !myTurn && <div class="note plain">{p} is writing the next line…</div>}
        {done && <div class="story-end">The end. Pin it to keep it.</div>}
      </div>
    );
  },
});
