import { useState } from 'preact/hooks';
import { defineDrop } from './types';
import { parseDay, timeLeft } from './logic';

type Content = { openOn: string; openAtMs: number };
// The author seals the message under "msg"; the other person can only lock "msg"
// (and so read it) on or after the open date: firestore.rules checks the date.
const K = 'msg';

export default defineDrop<Content>({
  type: 'time-capsule',
  title: 'Time Capsule',
  trayDescription: 'A message that opens on a date',
  order: 14,
  solo: true,
  content: { openOn: '', openAtMs: 0 },
  setup: [{ key: 'openOn', label: 'Opens on', kind: 'date' }],
  prepare(c) {
    const at = parseDay(c.openOn);
    if (!Number.isFinite(at)) return 'Pick a date.';
    if (at <= Date.now()) return 'Pick a date after today.';
    return { ...c, openAtMs: at };
  },
  subtitle: (c) => `Opens ${new Date(c.openAtMs).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`,
  pinTitle: () => 'Time Capsule',
  pinDetail(c, api) {
    if (api.createdBy.isMe && !api.partner.uid && Date.now() < c.openAtMs) return `Opens ${new Date(c.openAtMs).toLocaleDateString()}`;
    if (api.createdBy.isMe) return api.mine<string>(K) || 'Not sealed yet';
    return api.revealed(K) ? api.theirs<string>(K) || '' : `Opens ${new Date(c.openAtMs).toLocaleDateString()}`;
  },

  Renderer({ content, api }) {
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const author = api.createdBy.isMe;
    const solo = !api.partner.uid;
    const p = api.partner.name;
    const date = new Date(content.openAtMs).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
    const open = Date.now() >= content.openAtMs;
    const sealedByAuthor = author ? api.iLocked(K) : api.theyLocked(K);

    if (author) {
      if (!api.iLocked(K)) {
        return (
          <div class="stack-10">
            <div class="q">{solo ? `Write to future you. It opens on ${date}.` : `Write your message. ${p} can open it on ${date}.`}</div>
            <label for="tc-msg" class="sr">Your message</label>
            <textarea id="tc-msg" class="field" rows={4} maxLength={500} value={draft} onInput={(e) => setDraft(e.currentTarget.value)} />
            <button type="button" class="btn-primary" disabled={!draft.trim() || busy}
              onClick={async () => { setBusy(true); try { await api.lock(K, draft.trim().slice(0, 500)); } finally { setBusy(false); } }}>
              Seal it
            </button>
          </div>
        );
      }
      // A capsule to myself (Notes to self) stays closed until the day, then reads like a letter.
      if (solo) {
        return open ? (
          <div class="stack-10">
            <div class="capsule open"><Envelope open /><div class="cd-label">From past you · sealed until {date}</div></div>
            <div class="reveal-card me"><div class="reveal-ans">{api.mine<string>(K)}</div></div>
          </div>
        ) : (
          <div class="stack-10">
            <div class="capsule"><Envelope />
              <div><div class="cd-label">Sealed until {date}</div><div class="cd-sub">{timeLeft(content.openAtMs - Date.now())} to go</div></div>
            </div>
          </div>
        );
      }
      return (
        <div class="stack-10">
          <div class="capsule"><Envelope />
            <div><div class="cd-label">Sealed until {date}</div><div class="cd-sub">{api.theyLocked(K) ? `${p} has opened it` : open ? `${p} can open it now` : `${timeLeft(content.openAtMs - Date.now())} to go`}</div></div>
          </div>
          <div class="fine">Your message: “{api.mine<string>(K)}”</div>
        </div>
      );
    }

    if (api.revealed(K)) {
      return (
        <div class="stack-10">
          <div class="capsule open"><Envelope open /><div class="cd-label">Opened · sealed until {date}</div></div>
          <div class="reveal-card them"><div class="reveal-who">{p} wrote</div><div class="reveal-ans">{api.theirs<string>(K)}</div></div>
        </div>
      );
    }
    return (
      <div class="stack-10">
        <div class="capsule"><Envelope />
          <div><div class="cd-label">{sealedByAuthor ? `A message from ${p}` : `${p} is still writing`}</div>
            <div class="cd-sub">{open ? 'Ready to open' : `Opens ${date} · ${timeLeft(content.openAtMs - Date.now())} to go`}</div></div>
        </div>
        {err && <div class="err" role="alert">{err}</div>}
        {open && sealedByAuthor && (
          <button type="button" class="btn-primary" disabled={busy || api.iLocked(K)}
            onClick={async () => {
              setBusy(true);
              try { await api.lock(K, 'opened'); } catch { setErr('It isn’t time yet.'); } finally { setBusy(false); }
            }}>
            {api.iLocked(K) ? 'Opening…' : 'Open it'}
          </button>
        )}
      </div>
    );
  },
});

/** A sealed envelope with a wax seal; open, its flap folds back and the letter peeks out. */
function Envelope({ open = false }: { open?: boolean }) {
  return (
    <span class={`envelope${open ? ' open' : ''}`} aria-hidden="true">
      <span class="env-letter" />
      <span class="env-body" />
      <span class="env-flap" />
      {!open && <span class="env-wax">H</span>}
    </span>
  );
}
