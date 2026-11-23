import { useState } from 'preact/hooks';
import type { User } from 'firebase/auth';
import { createRoom, joinRoom } from '../data/rooms';
import { signOut } from '../data/auth';
import { firstName } from '../lib/names';
import type { Room } from '../types';
import { Logo } from './icons';
import { ModeToggle } from './ModeToggle';

interface Props {
  user: User;
  /** Rooms that invited my e-mail. */
  invites: Room[];
  /** My own room, if I already started one (I'm still alone in it). */
  ownRoom: Room | null;
  onOpenOwn(): void;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+$/;

export function Lobby({ user, invites, ownRoom, onOpenOwn }: Props) {
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const myEmail = (user.email || '').toLowerCase();

  async function run(fn: () => Promise<unknown>) {
    setErr('');
    setBusy(true);
    try { await fn(); } catch (e: any) { setErr(e?.message || 'Something went wrong.'); } finally { setBusy(false); }
  }

  const start = (withInvite: boolean) => {
    const v = email.trim().toLowerCase();
    if (withInvite) {
      if (!EMAIL_RE.test(v)) { setErr('Enter their e-mail address, or tap "Skip, invite later".'); return; }
      if (v === myEmail) { setErr('That’s your own address — invite the other person.'); return; }
    }
    run(() => createRoom(user, withInvite ? v : ''));
  };

  return (
    <div class="app">
      <ModeToggle uid={user.uid} class="icon-btn screen-toggle" />
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

        {ownRoom ? (
          <button class="btn-ghost" onClick={onOpenOwn}>Not now — open my own room</button>
        ) : (
          <form class="card" onSubmit={(e) => { e.preventDefault(); start(true); }}>
            <h2>{invites.length ? 'Or start your own room' : 'Start your room'}</h2>
            <p class="lede">A room is for you and one other person. Invite them now, or start on your own and invite them from the chat later.</p>
            <label class="field-label" for="invite">Their e-mail (optional)</label>
            <input id="invite" class="field" type="email" inputMode="email" autocomplete="off" placeholder="them@example.com"
              value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
            <button class="btn-primary" disabled={busy || !email.trim()}>Invite and start</button>
            <button type="button" class="btn-ghost" disabled={busy} onClick={() => start(false)}>Skip, invite later</button>
          </form>
        )}

        <div class="settings-row">
          <span>Signed in as {user.email}</span>
          <button class="link-btn" onClick={() => signOut()}>Sign out</button>
        </div>
      </div>
    </div>
  );
}
