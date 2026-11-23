import { useState } from 'preact/hooks';
import type { User } from 'firebase/auth';
import { changeInvite, createRoom, joinRoom } from '../data/rooms';
import { signOut } from '../data/auth';
import { firstName } from '../lib/names';
import type { Room } from '../types';
import { Logo } from './icons';

interface Props {
  user: User;
  invites: Room[];
  /** A room I own where the partner hasn't joined yet. */
  waiting: Room | null;
}

export function Lobby({ user, invites, waiting }: Props) {
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const myEmail = (user.email || '').toLowerCase();
  const appUrl = location.origin + location.pathname;

  async function run(fn: () => Promise<unknown>) {
    setErr('');
    setBusy(true);
    try { await fn(); } catch (e: any) { setErr(e?.message || 'Something went wrong.'); } finally { setBusy(false); }
  }

  const submit = (e: Event) => {
    e.preventDefault();
    const v = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(v)) { setErr('Enter their e-mail address.'); return; }
    if (v === myEmail) { setErr('That’s your own address — invite the other person.'); return; }
    run(async () => {
      if (waiting) await changeInvite(waiting.id, v); else await createRoom(user, v);
      setEditing(false);
    });
  };

  const share = async () => {
    const text = `Join me on Drops Chat — sign in with ${waiting?.invites[0]}: ${appUrl}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Drops Chat', text, url: appUrl });
      else { await navigator.clipboard.writeText(text); setErr(''); alert('Invite copied — paste it to them.'); }
    } catch { /* cancelled */ }
  };

  return (
    <div class="app">
      <div class="screen">
        <div class="brand">
          <Logo size={56} />
          <div class="brand-name">Hi, {firstName(user.displayName || user.email)}</div>
        </div>
        {err && <div class="err" role="alert">{err}</div>}

        {invites.map((r) => (
          <div class="card" key={r.id}>
            <h2>{firstName(r.ownerName)} invited you</h2>
            <p class="lede">A private room for just the two of you.</p>
            <button class="btn-primary" disabled={busy} onClick={() => run(() => joinRoom(r.id, user))}>Join {firstName(r.ownerName)}</button>
          </div>
        ))}

        {waiting && !editing ? (
          <div class="card">
            <h2>Waiting for {waiting.invites[0]}</h2>
            <p class="lede">Send them the app link. Once they sign in with that address, the room opens for both of you.</p>
            <button class="btn-primary" onClick={share}>Share invite</button>
            <button class="btn-ghost" onClick={() => { setEmail(waiting.invites[0]); setEditing(true); }}>Invite a different address</button>
          </div>
        ) : (
          (invites.length === 0 || editing) && (
            <form class="card" onSubmit={submit}>
              <h2>{editing ? 'Change who you invited' : 'Start your room'}</h2>
              <p class="lede">Drops Chat is for exactly two people. Who's the other one?</p>
              <label class="field-label" for="invite">Their e-mail (the one they'll sign in with)</label>
              <input id="invite" class="field" type="email" inputMode="email" autocomplete="off" placeholder="them@example.com" value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
              <button class="btn-primary" disabled={busy}>{editing ? 'Update invite' : 'Invite'}</button>
              {editing && <button type="button" class="link-btn" onClick={() => setEditing(false)}>Cancel</button>}
            </form>
          )
        )}

        <div class="settings-row">
          <span>Signed in as {user.email}</span>
          <button class="link-btn" onClick={() => signOut()}>Sign out</button>
        </div>
      </div>
    </div>
  );
}
