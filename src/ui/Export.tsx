import { render } from 'preact';
import { useState } from 'preact/hooks';
import { buildZip, exportName, gatherExport, saveFile } from '../data/export';
import { photoURL } from '../data/photos';
import { dateRange, exportable, groups, lineText, timeOf, type ExportData } from '../lib/exportFormat';
import { REACTIONS } from '../lib/messages';

interface Props {
  roomId: string;
  me: { uid: string; name: string };
  partner: { uid: string; name: string };
  /** The tab that's open, offered as "just this tab". */
  tab: { id: string; name: string };
  onToast(msg: string): void;
  onDone(): void;
}

/** Contact profile → Export chat: a PDF (via the print dialog) or a ZIP with the media. */
export function ExportSheet({ roomId, me, partner, tab, onToast, onDone }: Props) {
  const [scope, setScope] = useState<'all' | 'tab'>('all');
  const [busy, setBusy] = useState('');

  const run = async (kind: 'pdf' | 'zip') => {
    setBusy(kind === 'pdf' ? 'Preparing…' : 'Collecting messages…');
    try {
      const { data, truncated } = await gatherExport(roomId, me, partner, scope === 'tab' ? tab.id : undefined);
      if (!exportable(data.messages, me.uid, data.exportedAt).length) { onToast('Nothing to export yet.'); setBusy(''); return; }
      if (kind === 'pdf') {
        await printExport(data);
      } else {
        const blob = await buildZip(data, (d, n) => setBusy(`Downloading media ${d} of ${n}…`));
        await saveFile(blob, `${exportName(data)}.zip`);
      }
      if (truncated) onToast('Exported the latest 5,000 messages.');
      onDone();
    } catch (e: any) {
      onToast(e?.message || 'Could not export.');
    } finally { setBusy(''); }
  };

  return (
    <div class="stack">
      <div>
        <div class="sheet-title">Export chat</div>
        <div class="sheet-sub">Made on this phone from messages you can see. Deleted messages and hidden Drop answers are left out.</div>
      </div>
      <div class="segmented" role="radiogroup" aria-label="What to export">
        <button type="button" role="radio" aria-checked={scope === 'all'} class={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>Whole chat</button>
        <button type="button" role="radio" aria-checked={scope === 'tab'} class={scope === 'tab' ? 'on' : ''} onClick={() => setScope('tab')}>Only “{tab.name}”</button>
      </div>
      <button type="button" class="btn-primary" disabled={!!busy} onClick={() => run('pdf')}>PDF (print or save)</button>
      <button type="button" class="btn-ghost" disabled={!!busy} onClick={() => run('zip')}>ZIP with photos &amp; voice notes</button>
      {busy && <div class="fine" role="status">{busy}</div>}
      <div class="fine">PDF opens your phone’s print screen: choose “Save as PDF” (on iPhone, pinch out on the preview, then Share).</div>
    </div>
  );
}

const ms = (t: unknown) => {
  const x = t as { toMillis?: () => number } | null | undefined;
  return x && typeof x.toMillis === 'function' ? x.toMillis() : 0;
};

/**
 * Renders the export as a print-only page and opens the print dialog (which can save a PDF).
 * No PDF library: the browser's own print engine lays it out.
 */
export async function printExport(data: ExportData) {
  document.getElementById('print-root')?.remove();
  const root = document.createElement('div');
  root.id = 'print-root';
  document.body.appendChild(root);
  // Photo thumbnails: fetch their addresses first (a few seconds at most).
  const photos: Record<string, string> = {};
  await Promise.all(exportable(data.messages, data.me.uid, data.exportedAt)
    .filter((m) => m.kind === 'photo' && m.photo?.path)
    .slice(0, 200)
    .map((m) => Promise.race([
      photoURL(m.photo!.path).then((u) => { photos[m.id] = u; }).catch(() => {}),
      new Promise((r) => setTimeout(r, 4000)),
    ])));
  render(<PrintView data={data} photos={photos} />, root);
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); removeEventListener('afterprint', done); };
  addEventListener('afterprint', done);
  // Give images a moment to load.
  await Promise.race([
    Promise.all([...root.querySelectorAll('img')].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; })))),
    new Promise((r) => setTimeout(r, 3000)),
  ]);
  window.print();
}

function PrintView({ data, photos }: { data: ExportData; photos: Record<string, string> }) {
  const nameOf = (uid: string) => (uid === data.me.uid ? data.me.name : data.partner.name);
  const all = exportable(data.messages, data.me.uid, data.exportedAt);
  return (
    <article class="print-doc">
      <header class="print-head">
        <h1>{data.title}</h1>
        <p>{dateRange(all)} · {all.length} message{all.length === 1 ? '' : 's'}</p>
      </header>
      {groups(data).map((g) => (
        <section key={g.tab.id} class="print-tab">
          <h2><span class="print-dot" style={{ background: g.tab.colour }} />{g.tab.name}</h2>
          {g.days.map((d) => (
            <div key={d.day} class="print-day">
              <h3>{new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h3>
              {d.messages.map((m) => (
                <div key={m.id} class={`print-msg${m.uid === data.me.uid ? ' me' : ''}`}>
                  <div class="print-who">{nameOf(m.uid)} <span>{timeOf(ms(m.createdAt))}</span></div>
                  {m.kind === 'photo' && photos[m.id] && <img src={photos[m.id]} alt="" />}
                  {m.kind === 'drop'
                    ? <div class="print-card">A Drop</div>
                    : <div class="print-text">{m.kind === 'photo' ? m.text || '[Photo]' : lineText(m)}</div>}
                  {m.reactions && Object.keys(m.reactions).length > 0 && (
                    <div class="print-rx">{REACTIONS.filter((r) => m.reactions?.[r.code]?.length).map((r) => r.emoji).join(' ')}</div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </section>
      ))}
    </article>
  );
}
