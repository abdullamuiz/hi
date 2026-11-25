import { useState } from 'preact/hooks';
import type { User } from 'firebase/auth';
import { changeInvite, createRoom, ensureInviteCode, newInviteCode, removeRoom } from '../data/rooms';
import { inviteLink } from '../lib/invite';
import { firstName } from '../lib/names';
import type { Room } from '../types';

const EMAIL_RE = /^[^@\s]+@[^@\s]+$/;
const APP_URL = () => location.origin + location.pathname;

interface Props {
  user: User;
  /** Manage the invite of an existing chat I'm still alone in. Omit to add a new contact. */
  room?: Room | null;
  onOpenChat?(roomId: string): void;
  /** Offer "Make this my Notes to self" (a chat nobody has joined). */
  onMakeSelf?(): Promise<void>;
  onToast(msg: string): void;
  onClose(): void;
}

/**
 * Add a contact: makes a private two-person chat with a secret share link. The e-mail is
 * optional: no e-mail is sent, it only lets that address accept from inside the app.
 */
export function AddContactSheet({ user, room, onOpenChat, onMakeSelf, onToast, onClose }: Props) {
  const [email, setEmail] = useState(room?.invites[0] || '');
  const [savedEmail, setSavedEmail] = useState(room?.invites[0] || '');
  const [roomId, setRoomId] = useState(room?.id || '');
  const [code, setCode] = useState(room?.inviteCode || '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const myEmail = (user.email || '').toLowerCase();
  const myName = firstName(user.displayName || user.email, '');

  async function run(fn: () => Promise<void>) {
    setErr('');
    setBusy(true);
    try { await fn(); } catch (e: any) { setErr(e?.message || 'Something went wrong.'); } finally { setBusy(false); }
  }

  const checkEmail = (v: string) => {
    if (!v) return true;
    if (!EMAIL_RE.test(v)) { setErr('That e-mail address looks wrong.'); return false; }
    if (v === myEmail) { setErr('That’s your own address. Add the other person’s, or leave it empty.'); return false; }
    return true;
  };

  const create = (e: Event) => {
    e.preventDefault();
    const v = email.trim().toLowerCase();
    if (!checkEmail(v)) return;
    run(async () => {
      const r = await createRoom(user, v);
      setRoomId(r.id);
      setCode(r.code);
      setSavedEmail(v);
    });
  };

  const saveEmail = (e: Event) => {
    e.preventDefault();
    const v = email.trim().toLowerCase();
    if (!checkEmail(v)) return;
    run(async () => { await changeInvite(roomId, v); setSavedEmail(v); onToast(v ? `${v} can now accept from inside Hi` : 'E-mail invite removed'); });
  };

  // Older chats have no code yet: make one the first time the link is needed.
  const link = async () => {
    let c = code;
    if (!c && room) { c = await ensureInviteCode(room); setCode(c); }
    return inviteLink(APP_URL(), { roomId, code: c, from: myName, owner: user.uid });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(await link());
      onToast('Copied');
    } catch { setErr('Couldn’t copy. Long-press the link to copy it.'); }
  };

  const share = async () => {
    const url = await link();
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Hi', text: `${myName || 'I'} invited you to chat on Hi.`, url });
        return;
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
      }
    }
    await copy();
  };

  const resetLink = () => run(async () => { setCode(await newInviteCode(roomId)); onToast('New link made. The old one no longer works.'); });
  const remove = () => run(async () => { await removeRoom(roomId); onToast('Invite removed'); onClose(); });

  if (!roomId) {
    return (
      <form class="stack" style={{ gap: '14px' }} onSubmit={create}>
        <div>
          <div class="sheet-title">Add a contact</div>
          <div class="sheet-sub">Each contact gets their own private chat, just the two of you.</div>
        </div>
        {err && <div class="err" role="alert">{err}</div>}
        <div class="stack" style={{ gap: '6px' }}>
          <label class="field-label" for="contact-email">Their e-mail (optional)</label>
          <input id="contact-email" class="field" type="email" inputMode="email" autocomplete="off" placeholder="them@example.com"
            value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
          <div class="fine">Hi doesn’t send e-mails. Adding it lets that address accept from inside the app. Either way, share the link with them.</div>
        </div>
        <button class="btn-primary" disabled={busy}>Create invite link</button>
      </form>
    );
  }

  const shown = code ? inviteLink(APP_URL(), { roomId, code, from: myName, owner: user.uid }) : '';
  return (
    <div class="stack" style={{ gap: '14px' }}>
      <div>
        <div class="sheet-title">{room ? 'Invite someone' : 'Invite ready'}</div>
        <div class="sheet-sub">The first person to open the link joins this chat. After that it stops working.</div>
      </div>
      {err && <div class="err" role="alert">{err}</div>}
      <button type="button" class="btn-primary" disabled={busy} onClick={share}>Share invite link</button>
      <button type="button" class="btn-ghost" disabled={busy} onClick={copy}>Copy link</button>
      {shown && <div class="invite-link" aria-label="Invite link">{shown}</div>}
      <form class="stack" style={{ gap: '6px' }} onSubmit={saveEmail}>
        <label class="field-label" for="invite-email">Their e-mail (optional)</label>
        <div class="inline-form">
          <input id="invite-email" class="field" type="email" inputMode="email" autocomplete="off" placeholder="them@example.com"
            value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
          <button class="btn-primary sm" disabled={busy || email.trim().toLowerCase() === savedEmail}>Save</button>
        </div>
        <div class="fine">{savedEmail ? `${savedEmail} can also accept from inside Hi. No e-mail is sent, so share the link too.` : 'No e-mail is sent. Adding one lets that address accept from inside Hi.'}</div>
      </form>
      {!room && onOpenChat && <button type="button" class="btn-ghost" onClick={() => onOpenChat(roomId)}>Open the chat</button>}
      {room && onMakeSelf && (
        <div class="stack self-offer" style={{ gap: '6px' }}>
          <div class="fine">Rather keep this chat for yourself? It becomes your Notes to self: messages, photos and reminders only you see. The link stops working.</div>
          <button type="button" class="btn-ghost" disabled={busy} onClick={() => run(async () => { await onMakeSelf(); onClose(); })}>📝 Make this my Notes to self</button>
        </div>
      )}
      <div class="settings-row">
        <button type="button" class="link-btn" disabled={busy} onClick={resetLink}>Make a new link</button>
        <button type="button" class="link-btn danger-text" disabled={busy} onClick={remove}>Remove invite</button>
      </div>
    </div>
  );
}
