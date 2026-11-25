import { useEffect, useRef, useState } from 'preact/hooks';
import { defineDrop } from './types';
import { DARES, TRUTHS, pickRandom } from './deck';
import { burst, buzz, confetti, useOnceWhen } from './fx';

type Content = { truth: string; dare: string };
type Choice = 'truth' | 'dare';
type Progress = { choice?: Choice; answer?: string; photo?: string; skipped?: boolean; doneAt?: number };

/**
 * You drop it for the other person. They pick Truth or Dare (the prompts stay out of
 * sight until they choose), then answer with text or a photo, or chicken out.
 * Left blank in setup, a prompt comes from the built-in deck.
 */
export default defineDrop<Content>({
  type: 'truth-or-dare',
  title: 'Truth or Dare',
  trayDescription: 'They pick; you set the truth and the dare',
  order: 5.5,
  content: { truth: '', dare: '' },
  setup: [
    { key: 'truth', label: 'Your truth question', kind: 'text', maxLength: 200, optional: true, placeholder: 'Leave blank for a surprise', suggest: () => pickRandom(TRUTHS) },
    { key: 'dare', label: 'Your dare', kind: 'text', maxLength: 200, optional: true, placeholder: 'Leave blank for a surprise', suggest: () => pickRandom(DARES) },
  ],
  prepare(c) {
    return { truth: c.truth.trim() || pickRandom(TRUTHS), dare: c.dare.trim() || pickRandom(DARES) };
  },
  subtitle: () => 'Truth… or dare?',
  pinTitle: () => 'Truth or Dare',
  // The person who didn't drop it plays: pick, then answer (or skip).
  waitingOn(_c, api) {
    const author = api.createdBy.isMe;
    const pr = (author ? api.theirProgress : api.myProgress) as Progress;
    if (pr.skipped || pr.doneAt) return null;
    return author ? 'partner' : 'me';
  },
  pinDetail(c, api) {
    const pr = (api.createdBy.isMe ? api.theirProgress : api.myProgress) as Progress;
    if (pr.skipped) return 'Chickened out 🐔';
    if (!pr.choice) return 'Waiting for a pick';
    const prompt = pr.choice === 'truth' ? c.truth : c.dare;
    return pr.doneAt ? `${pr.choice === 'truth' ? 'Truth' : 'Dare'}: ${prompt} — ${pr.answer || '📷 photo'}` : `Picked ${pr.choice}`;
  },

  Renderer({ content, api }) {
    const author = api.createdBy.isMe;
    // The person playing is whoever didn't drop it.
    const pr = (author ? api.theirProgress : api.myProgress) as Progress;
    const player = author ? api.partner.name : 'You';
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const fileRef = useRef<HTMLInputElement>(null);
    const prompt = pr.choice === 'truth' ? content.truth : content.dare;

    // Celebrate the answer once on each phone; the chicken runs once when someone skips.
    useOnceWhen(!!pr.doneAt, `tod-done:${api.dropId}`, () => confetti());
    useOnceWhen(!!pr.skipped, `tod-skip:${api.dropId}`, () => burst('chicken'));

    const choose = async (choice: Choice) => {
      buzz(10);
      setBusy(true);
      try { await api.setMyProgress({ choice }); } finally { setBusy(false); }
    };
    const answer = async (photo?: string) => {
      const a = text.trim().slice(0, 500);
      if (!a && !photo) return;
      setBusy(true);
      setErr('');
      try { await api.setMyProgress({ answer: a, ...(photo ? { photo } : {}), doneAt: Date.now() }); } catch (e: any) { setErr(e?.message || 'Could not send.'); } finally { setBusy(false); }
    };
    const sendPhoto = async (f: File | undefined) => {
      if (!f) return;
      setBusy(true);
      setErr('');
      try { await answer(await api.uploadPhoto(f)); } catch (e: any) { setErr(e?.message || 'Could not upload the photo.'); setBusy(false); }
    };
    const skip = async () => {
      setBusy(true);
      try { await api.setMyProgress({ skipped: true }); } finally { setBusy(false); }
    };

    if (pr.skipped) {
      return (
        <div class="stack-10">
          <div class="tod-big" aria-hidden="true">🐔</div>
          <div class="gap-line"><div class="gap-txt">{author ? `${api.partner.name} chickened out!` : 'You chickened out. Bawk!'}</div></div>
        </div>
      );
    }

    if (!pr.choice) {
      if (author) return <div class="stack-10"><div class="tod-cards"><div class="tod-card truth">Truth</div><div class="tod-card dare">Dare</div></div><div class="note heartbeat">Waiting for {api.partner.name} to pick…</div></div>;
      return (
        <div class="stack-10">
          <div class="q">{api.partner.name} set you a challenge. Pick one:</div>
          <div class="tod-cards">
            <button type="button" class="tod-card truth" disabled={busy} onClick={() => choose('truth')}>Truth</button>
            <button type="button" class="tod-card dare" disabled={busy} onClick={() => choose('dare')}>Dare</button>
          </div>
          <button type="button" class="link-btn" onClick={skip} disabled={busy}>Skip 🐔</button>
        </div>
      );
    }

    const head = <div class={`tod-prompt ${pr.choice}`}><span class="tod-kind">{pr.choice === 'truth' ? 'Truth' : 'Dare'}</span><div class="q">{prompt}</div></div>;

    if (pr.doneAt) {
      return (
        <div class="stack-10">
          {head}
          <div class="reveal-card them tod-answer">
            <div class="reveal-who">{player}</div>
            {pr.photo && <DropPhoto path={pr.photo} load={api.photoUrl} />}
            {pr.answer && <div class="reveal-ans">{pr.answer}</div>}
          </div>
        </div>
      );
    }

    if (author) return <div class="stack-10">{head}<div class="note heartbeat">{api.partner.name} is on it…</div></div>;

    return (
      <div class="stack-10">
        {head}
        {err && <div class="err" role="alert">{err}</div>}
        <label for={`tod-${api.dropId}`} class="sr">Your answer</label>
        <textarea id={`tod-${api.dropId}`} class="field" rows={3} maxLength={500} value={text} placeholder={pr.choice === 'dare' ? 'Add a note (or just send a photo)' : 'Your honest answer'}
          onInput={(e) => setText(e.currentTarget.value)} />
        <div class="tod-actions">
          <button type="button" class="btn-ghost" disabled={busy} onClick={() => fileRef.current?.click()}>📷 Photo</button>
          <button type="button" class="btn-primary" disabled={busy || !text.trim()} onClick={() => answer()}>Send</button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden aria-label="Choose a photo" onChange={(e) => sendPhoto(e.currentTarget.files?.[0])} />
        <button type="button" class="link-btn" onClick={skip} disabled={busy}>Skip 🐔</button>
      </div>
    );
  },
});

function DropPhoto({ path, load }: { path: string; load(path: string): Promise<string> }) {
  const [url, setUrl] = useState('');
  useEffect(() => { load(path).then(setUrl).catch(() => setUrl('')); }, [path]);
  return url ? <img class="tod-photo" src={url} alt="Dare photo" /> : <div class="tod-photo loading" aria-busy="true" />;
}
