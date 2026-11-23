import { useState } from 'preact/hooks';

interface Props {
  /** Currently invited e-mail ('' if nobody yet). */
  current: string;
  myEmail: string;
  onSave(email: string): Promise<void>;
  onDone(): void;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+$/;

/** Invite (or change) the one other person who can join this room, and share the link. */
export function InviteSheet({ current, myEmail, onSave, onDone }: Props) {
  const [email, setEmail] = useState(current);
  const [saved, setSaved] = useState(current);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const appUrl = location.origin + location.pathname;

  const save = async (e: Event) => {
    e.preventDefault();
    const v = email.trim().toLowerCase();
    if (!EMAIL_RE.test(v)) { setErr('Enter their e-mail address.'); return; }
    if (v === myEmail) { setErr('That’s your own address — invite the other person.'); return; }
    setErr('');
    setBusy(true);
    try { await onSave(v); setSaved(v); } catch (x: any) { setErr(x?.message || 'Could not save the invite.'); } finally { setBusy(false); }
  };

  const share = async () => {
    const text = `Join me on Hi — sign in with ${saved}: ${appUrl}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Hi', text, url: appUrl });
      else { await navigator.clipboard.writeText(text); setErr(''); alert('Invite copied — paste it to them.'); }
    } catch { /* cancelled */ }
  };

  return (
    <form class="stack" style={{ gap: '14px' }} onSubmit={save}>
      <div>
        <div class="sheet-title">Invite someone</div>
        <div class="sheet-sub">Only this e-mail can join, and once they do the room is just the two of you.</div>
      </div>
      {err && <div class="err" role="alert">{err}</div>}
      <div class="stack" style={{ gap: '6px' }}>
        <label class="field-label" for="invite-email">Their e-mail (the one they’ll sign in with)</label>
        <input id="invite-email" class="field" type="email" inputMode="email" autocomplete="off" placeholder="them@example.com"
          value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
      </div>
      <button class="btn-primary" disabled={busy || !email.trim() || email.trim().toLowerCase() === saved}>
        {saved ? 'Change invite' : 'Save invite'}
      </button>
      {saved && (
        <>
          <div class="ok">Invited {saved}. Send them the link — they sign in with that e-mail and tap Join.</div>
          <button type="button" class="btn-ghost" onClick={share}>Share invite link</button>
        </>
      )}
      <button type="button" class="link-btn" onClick={onDone}>Done</button>
    </form>
  );
}
