import { useEffect, useRef, useState } from 'preact/hooks';
import type { User } from 'firebase/auth';
import {
  clearNote, deleteAccount, saveProfile, setNote, watchProfile, type Blocked, type Profile,
} from '../data/profile';
import { signOut } from '../data/auth';
import { avatarDataUrl } from '../lib/image';
import { initial } from '../lib/names';
import { ABOUT_MAX, NAME_MAX, NICK_MAX, NOTE_EMOJI, NOTE_MAX, noteActive, noteLabel, sinceLabel, suggestedName } from '../lib/profile';
import type { Member, MoodId } from '../types';
import { Logo, MoodIcon, MOODS } from './icons';

// ---------------------------------------------------------------------------- hooks & avatar

/** undefined while loading, null when they haven't made a profile. */
export function useProfile(uid: string | null | undefined): Profile | null | undefined {
  const [p, setP] = useState<Profile | null | undefined>(undefined);
  useEffect(() => {
    setP(undefined);
    if (!uid) return;
    return watchProfile(uid, setP);
  }, [uid]);
  return p;
}

/** Re-renders once a minute, so a note disappears when its 24 hours are up. */
export function useMinute() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  return now;
}

interface AvatarProps {
  profile: Profile | null | undefined;
  /** Photo from the chat (Google photo) when the person has no profile yet. */
  fallbackPhoto?: string | null;
  name: string;
  size?: number;
  class?: string;
}

/** Profile photo, else the Google photo (people without a profile yet), else a coloured initial. */
export function Avatar({ profile, fallbackPhoto, name, size, class: cls = '' }: AvatarProps) {
  const photo = profile ? profile.photo : fallbackPhoto || null;
  const style = size ? { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.42)}px` } : undefined;
  return (
    <span class={`avatar ${cls}`} style={style} aria-hidden="true">
      {photo ? <img src={photo} alt="" referrerpolicy="no-referrer" /> : initial(name)}
    </span>
  );
}

// ---------------------------------------------------------------------------- profile form

interface FormProps {
  user: User;
  profile: Profile | null | undefined;
  roomIds: string[];
  submitLabel: string;
  onSaved(): void;
}

/** Name, photo and About line. Used for first-time setup and for editing later. */
export function ProfileForm({ user, profile, roomIds, submitLabel, onSaved }: FormProps) {
  const [name, setName] = useState(() => profile?.name || suggestedName(user.displayName, user.email));
  const [about, setAbout] = useState(profile?.about || '');
  const [photo, setPhoto] = useState<string | null>(() => (profile ? profile.photo : user.photoURL || null));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const onFile = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    setErr('');
    try { setPhoto(await avatarDataUrl(f)); } catch (x: any) { setErr(x?.message || 'Could not use that photo.'); }
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setErr('');
    try {
      await saveProfile(user, { name, photo, about }, roomIds);
      onSaved();
    } catch (x: any) {
      setErr(x?.message || 'Could not save your profile.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="stack profile-form" onSubmit={submit}>
      <div class="avatar-pick">
        <button type="button" class="avatar-btn" onClick={() => file.current?.click()} aria-label="Choose a profile photo">
          <Avatar profile={{ uid: user.uid, name, photo, about, note: null }} name={name || '?'} size={96} />
          <span class="avatar-edit" aria-hidden="true">Edit</span>
        </button>
        <input ref={file} type="file" accept="image/*" hidden onChange={onFile} aria-label="Profile photo file" />
        <div class="avatar-links">
          <button type="button" class="link-btn" onClick={() => file.current?.click()}>{photo ? 'Change photo' : 'Add a photo'}</button>
          {user.photoURL && photo !== user.photoURL && (
            <button type="button" class="link-btn" onClick={() => setPhoto(user.photoURL)}>Use my Google photo</button>
          )}
          {photo && <button type="button" class="link-btn" onClick={() => setPhoto(null)}>Remove photo</button>}
        </div>
      </div>
      <div class="stack" style={{ gap: '6px' }}>
        <label class="field-label" for="profile-name">Your name</label>
        <input id="profile-name" class="field" value={name} maxLength={NAME_MAX} autocomplete="name"
          onInput={(e) => setName(e.currentTarget.value)} required />
      </div>
      <div class="stack" style={{ gap: '6px' }}>
        <label class="field-label" for="profile-about">About <span class="fine">(optional)</span></label>
        <input id="profile-about" class="field" value={about} maxLength={ABOUT_MAX} placeholder="e.g. Tea first, then talk"
          onInput={(e) => setAbout(e.currentTarget.value)} />
        <div class="fine counter">{about.length}/{ABOUT_MAX}</div>
      </div>
      {err && <div class="err" role="alert">{err}</div>}
      <button class="btn-primary" disabled={busy || !name.trim()}>{busy ? 'Saving…' : submitLabel}</button>
    </form>
  );
}

/** First sign-in: one screen to set name, photo and About. */
export function ProfileSetup({ user, roomIds, onDone }: { user: User; roomIds: string[]; onDone(): void }) {
  return (
    <div class="app">
      <div class="screen">
        <div class="brand"><Logo size={48} /><div class="brand-name">Set up your profile</div></div>
        <p class="lede center">This is how the people you chat with see you. You can change it any time.</p>
        <div class="card"><ProfileForm user={user} profile={null} roomIds={roomIds} submitLabel="Continue" onSaved={onDone} /></div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- notes

/** Set or clear my 24-hour note. */
export function NoteSheet({ uid, current, onDone }: { uid: string; current: Profile | null | undefined; onDone(msg: string): void }) {
  const active = noteActive(current?.note) ? current!.note! : null;
  const [text, setText] = useState(active?.text || '');
  const [emoji, setEmoji] = useState(active?.emoji || '');
  const [err, setErr] = useState('');
  const share = async (e: Event) => {
    e.preventDefault();
    if (!text.trim() && !emoji) return;
    try { await setNote(uid, text, emoji); onDone('Note shared for 24 hours'); } catch (x: any) { setErr(x?.message || 'Could not share the note.'); }
  };
  return (
    <form class="stack" onSubmit={share}>
      <div>
        <div class="sheet-title">Your note</div>
        <div class="sheet-sub">A short status everyone you chat with sees for 24 hours.</div>
      </div>
      <div class="emoji-row" role="radiogroup" aria-label="Note emoji">
        {NOTE_EMOJI.map((e) => (
          <button type="button" key={e} role="radio" aria-checked={emoji === e} aria-label={e}
            class={`emoji-opt${emoji === e ? ' on' : ''}`} onClick={() => setEmoji(emoji === e ? '' : e)}>{e}</button>
        ))}
      </div>
      <label class="sr" for="note-text">Note</label>
      <input id="note-text" class="field" value={text} maxLength={NOTE_MAX} placeholder="What’s on your mind?"
        onInput={(e) => setText(e.currentTarget.value)} autocomplete="off" />
      <div class="fine counter">{text.length}/{NOTE_MAX}</div>
      {err && <div class="err" role="alert">{err}</div>}
      <button class="btn-primary" disabled={!text.trim() && !emoji}>Share note</button>
      {active && (
        <button type="button" class="btn-ghost" onClick={() => clearNote(uid).then(() => onDone('Note cleared')).catch((x) => setErr(x.message))}>
          Clear note
        </button>
      )}
    </form>
  );
}

/** Someone else's note: read it and reply into your chat with them. */
export function NoteReplySheet({ name, note, onSend }: { name: string; note: { text: string; emoji: string }; onSend(text: string): void }) {
  const [text, setText] = useState('');
  return (
    <form class="stack" onSubmit={(e) => { e.preventDefault(); if (text.trim()) onSend(text.trim()); }}>
      <div class="sheet-title">{name}’s note</div>
      <div class="note-quote">{noteLabel({ ...note, atMs: null })}</div>
      <label class="sr" for="note-reply">Reply to {name}’s note</label>
      <input id="note-reply" class="field" value={text} maxLength={1000} placeholder={`Reply to ${name}…`}
        onInput={(e) => setText(e.currentTarget.value)} autocomplete="off" autoFocus />
      <button class="btn-primary" disabled={!text.trim()}>Send reply</button>
    </form>
  );
}

// ---------------------------------------------------------------------------- contact profile

interface ContactProps {
  name: string;
  realName: string;
  profile: Profile | null | undefined;
  member?: Member;
  sinceMs: number;
  pinCount: number;
  nickname: string;
  muted: boolean;
  onNickname(nick: string): void;
  onMute(muted: boolean): void;
  onRemove(): void;
  onBlock(): void;
  /** Photos, links, voice notes and Drops in this chat. */
  onMedia?(): void;
  onExport?(): void;
}

/** Tap the header in a chat: who they are, plus nickname, mute, remove, block. */
export function ContactSheet(p: ContactProps) {
  const now = useMinute();
  const [step, setStep] = useState<'main' | 'nick' | 'remove' | 'block'>('main');
  const [nick, setNick] = useState(p.nickname);
  const mood = p.member?.mood ? MOODS.find((m) => m.id === p.member!.mood) : undefined;
  const note = noteActive(p.profile?.note, now) ? p.profile!.note! : null;

  if (step === 'remove' || step === 'block') {
    const block = step === 'block';
    return (
      <div class="stack">
        <div class="sheet-title">{block ? `Block ${p.name}?` : `Remove ${p.name}?`}</div>
        <p class="lede">
          {block
            ? `You’ll leave your chat with ${p.name}, and they won’t be able to join any chat you invite them to. They aren’t told they’re blocked.`
            : `You’ll leave this chat and it disappears from your list. ${p.name} keeps their copy but can’t send you anything here.`}
        </p>
        <button type="button" class="btn-danger" onClick={block ? p.onBlock : p.onRemove}>{block ? 'Block' : 'Remove contact'}</button>
        <button type="button" class="btn-ghost" onClick={() => setStep('main')}>Cancel</button>
      </div>
    );
  }

  return (
    <div class="stack contact-sheet">
      <div class="contact-head">
        <Avatar profile={p.profile} fallbackPhoto={p.member?.photoURL} name={p.name} size={88} />
        <div class="contact-name">{p.name}</div>
        {p.nickname && p.realName && p.realName !== p.nickname && <div class="fine">Profile name: {p.realName}</div>}
        {p.profile?.about && <div class="contact-about">{p.profile.about}</div>}
      </div>
      {(mood || note) && (
        <div class="contact-status">
          {mood && <span class="contact-mood"><MoodIcon mood={mood.id as MoodId} size={22} /> {mood.label}</span>}
          {note && <span class="note-quote small">{noteLabel(note)}</span>}
        </div>
      )}
      <div class="settings">
        {p.sinceMs > 0 && <div class="settings-row"><span>Chatting</span><span>{sinceLabel(p.sinceMs).replace('Since', 'since')}</span></div>}
        <div class="settings-row"><span>Scrapbook</span><span>{p.pinCount} pinned</span></div>
      </div>
      {step === 'nick' ? (
        <form class="stack" style={{ gap: '8px' }} onSubmit={(e) => { e.preventDefault(); p.onNickname(nick.trim()); setStep('main'); }}>
          <label class="field-label" for="nick">Your name for them <span class="fine">(only you see it)</span></label>
          <input id="nick" class="field" value={nick} maxLength={NICK_MAX} placeholder={p.realName || p.name}
            onInput={(e) => setNick(e.currentTarget.value)} autoFocus />
          <div class="btn-row">
            <button class="btn-primary">Save</button>
            <button type="button" class="btn-ghost" onClick={() => { setNick(p.nickname); setStep('main'); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <div class="contact-actions">
          {p.onMedia && <button type="button" class="act-btn" onClick={p.onMedia}>Photos, links &amp; voice</button>}
          {p.onExport && <button type="button" class="act-btn" onClick={p.onExport}>Export chat</button>}
          <button type="button" class="act-btn" onClick={() => setStep('nick')}>{p.nickname ? 'Change nickname' : 'Nickname'}</button>
          <button type="button" class="act-btn" role="switch" aria-checked={p.muted} onClick={() => p.onMute(!p.muted)}>
            {p.muted ? 'Unmute notifications' : 'Mute notifications'}
          </button>
          <button type="button" class="act-btn danger" onClick={() => setStep('remove')}>Remove contact</button>
          <button type="button" class="act-btn danger" onClick={() => setStep('block')}>Block</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- settings parts

export function BlockedList({ blocked, onUnblock }: { blocked: Blocked[]; onUnblock(uid: string): void }) {
  if (!blocked.length) return null;
  return (
    <div class="settings-group">
      <div class="field-label">Blocked</div>
      {blocked.map((b) => (
        <div class="settings-row" key={b.uid}>
          <span>{b.name || 'Someone'}</span>
          <button type="button" class="link-btn" onClick={() => onUnblock(b.uid)}>Unblock</button>
        </div>
      ))}
    </div>
  );
}

/** Settings → Delete account: two steps, the second one red. */
export function DeleteAccountSheet({ user, onCancel }: { user: User; onCancel(): void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; relogin?: boolean } | null>(null);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await deleteAccount(user);
      await signOut().catch(() => {});
    } catch (e: any) {
      const relogin = /recent-login/.test(String(e?.code || ''));
      setErr({ text: e?.message || 'Could not delete your account.', relogin });
      setBusy(false);
    }
  };
  if (step === 1) {
    return (
      <div class="stack">
        <div class="sheet-title">Delete your account?</div>
        <p class="lede">
          You’ll leave every chat (the other person sees that you left), chats only you are in are deleted,
          and your profile, note, nicknames and settings are erased. You can sign up again later, but nothing comes back.
        </p>
        <button type="button" class="btn-ghost danger-text" onClick={() => setStep(2)}>Continue</button>
        <button type="button" class="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    );
  }
  return (
    <div class="stack">
      <div class="sheet-title">This can’t be undone</div>
      <p class="lede">Delete the account for {user.email || 'this sign-in'} and everything in it?</p>
      {err && <div class="err" role="alert">{err.text}</div>}
      {err?.relogin
        ? <button type="button" class="btn-primary" onClick={() => signOut()}>Sign out now</button>
        : <button type="button" class="btn-danger" disabled={busy} onClick={go}>{busy ? 'Deleting…' : 'Delete my account forever'}</button>}
      <button type="button" class="btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
  );
}
