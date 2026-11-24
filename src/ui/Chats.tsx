import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { User } from 'firebase/auth';
import { declineInvite, joinRoom, watchMembers } from '../data/rooms';
import { sendNoteReply } from '../data/messages';
import { unblock, type Blocked, type ContactPrefs, type Profile as ProfileT } from '../data/profile';
import { GENERAL } from '../data/tabs';
import { displayName, noteActive, noteLabel, type Note } from '../lib/profile';
import { Avatar, DeleteAccountSheet, NoteReplySheet, NoteSheet, ProfileForm, useMinute, useProfile } from './Profile';
import { enablePush, pushStatus, type PushStatus } from '../data/push';
import { chooseTheme } from '../data/prefs';
import { currentPrefs, onThemeChange, type ThemePrefs } from '../lib/themes';
import { firstName } from '../lib/names';
import { dayLabel } from '../lib/time';
import type { Member, Room } from '../types';
import { AddContactSheet } from './AddContactSheet';
import { SettingsSheet } from './Sheets';
import { SheetFrame } from './SheetFrame';
import { usePullToRefresh } from './PullToRefresh';
import { ModeToggle } from './ModeToggle';
import { Logo, MoodIcon, MOODS, PlusIcon, SettingsIcon } from './icons';

interface Props {
  user: User;
  profile: ProfileT | null | undefined;
  rooms: Room[];
  contacts: Record<string, ContactPrefs>;
  blocked: Blocked[];
  /** Rooms that invited my e-mail and that I haven't joined. */
  invites: Room[];
  onOpen(roomId: string): void;
}

type Sheet =
  | null
  | { kind: 'add' }
  | { kind: 'invite'; roomId: string }
  | { kind: 'settings' }
  | { kind: 'profile' }
  | { kind: 'note' }
  | { kind: 'note-reply'; roomId: string; name: string; note: Note }
  | { kind: 'delete-account' };

const ms = (t: { toMillis(): number } | null | undefined) => (t ? t.toMillis() : 0);
const sortKey = (r: Room) => ms(r.lastMessage?.at) || ms(r.createdAt) || Date.now();

/** Home: every chat (one per contact), invitations, and "+ Add contact". */
export function Chats({ user, profile, rooms, invites, contacts, blocked, onOpen }: Props) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const [toast, setToast] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [theme, setTheme] = useState<ThemePrefs>(currentPrefs);
  const [push, setPush] = useState<PushStatus>('unsupported');
  const scroller = useRef<HTMLElement>(null);
  const pull = usePullToRefresh(scroller);
  useEffect(() => onThemeChange((p) => setTheme(p)), []);
  useEffect(() => { pushStatus().then(setPush); }, []);

  const sorted = useMemo(() => [...rooms].sort((a, b) => sortKey(b) - sortKey(a)), [rooms]);
  // People I already have a full chat with (to avoid a second chat with them).
  const partnerOf = useMemo(() => {
    const m = new Map<string, string>();
    rooms.forEach((r) => { if (r.members.length === 2) m.set(r.members.find((u) => u !== user.uid)!, r.id); });
    return m;
  }, [rooms, user.uid]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? '' : t)), 3500);
  }

  async function accept(r: Room) {
    setErr('');
    setBusy(r.id);
    try { await joinRoom(r.id, user); onOpen(r.id); } catch (e: any) { setErr(e?.message || 'Could not join.'); } finally { setBusy(''); }
  }
  async function decline(r: Room) {
    setBusy(r.id);
    try { await declineInvite(r.id); } catch (e: any) { setErr(e?.message || 'Could not decline.'); } finally { setBusy(''); }
  }

  const partners = useMemo(() => sorted
    .map((r) => ({ roomId: r.id, uid: r.members.find((u) => u !== user.uid) || '' }))
    .filter((x) => x.uid), [sorted, user.uid]);

  const replyToNote = async (roomId: string, note: Note, text: string) => {
    setSheet(null);
    try {
      await sendNoteReply(roomId, GENERAL, user.uid, text, note);
      flash('Reply sent');
    } catch (e: any) { flash(e?.message || 'Could not send the reply.'); }
  };

  const managed = sheet?.kind === 'invite' ? rooms.find((r) => r.id === sheet.roomId) : undefined;

  return (
    <div class="app">
      <header class="hdr">
        <Logo size={40} />
        <div class="hdr-text"><div class="hdr-name">Chats</div></div>
        <div class="hdr-actions">
          <button type="button" class="icon-btn me-btn" onClick={() => setSheet({ kind: 'profile' })} aria-label="Your profile">
            <Avatar profile={profile} name={profile?.name || user.displayName || user.email || '?'} size={34} />
          </button>
          <ModeToggle uid={user.uid} />
          <button type="button" class="icon-btn" onClick={() => setSheet({ kind: 'settings' })} aria-label="Settings"><SettingsIcon /></button>
        </div>
      </header>

      <main class="feed" ref={scroller}>
        {pull}
        <div class="feed-inner chats">
          {err && <div class="err" role="alert">{err}</div>}

          <NotesStrip
            me={user.uid}
            myProfile={profile}
            partners={partners}
            contacts={contacts}
            onMine={() => setSheet({ kind: 'note' })}
            onTheirs={(roomId, name, note) => setSheet({ kind: 'note-reply', roomId, name, note })}
          />

          {invites.map((r) => {
            const existing = partnerOf.get(r.owner);
            const who = firstName(r.ownerName, 'Someone');
            return (
              <div class="card invite-card" key={r.id}>
                <h2>{who} invited you</h2>
                <p class="lede">{existing ? `You already have a chat with ${who}.` : 'A private chat for just the two of you.'}</p>
                <div class="btn-row">
                  {existing
                    ? <button type="button" class="btn-primary" onClick={() => onOpen(existing)}>Open chat</button>
                    : <button type="button" class="btn-primary" disabled={busy === r.id} onClick={() => accept(r)}>Accept</button>}
                  <button type="button" class="btn-ghost" disabled={busy === r.id} onClick={() => decline(r)}>Decline</button>
                </div>
              </div>
            );
          })}

          {sorted.length === 0 && invites.length === 0 && (
            <div class="card">
              <h2>Start your first chat</h2>
              <p class="lede">Add a contact and send them the invite link. Each chat is private, just the two of you.</p>
              <button type="button" class="btn-primary" onClick={() => setSheet({ kind: 'add' })}>Add a contact</button>
            </div>
          )}

          {sorted.length > 0 && (
            <ul class="chat-list" aria-label="Your chats">
              {sorted.map((r) => (
                <ChatRow key={r.id} room={r} me={user.uid} contacts={contacts} onOpen={() => onOpen(r.id)} onInvite={() => setSheet({ kind: 'invite', roomId: r.id })} />
              ))}
            </ul>
          )}
        </div>
      </main>

      <footer class="composer chats-foot">
        <button type="button" class="btn-primary add-contact" onClick={() => setSheet({ kind: 'add' })}>
          <PlusIcon /> Add contact
        </button>
      </footer>

      {sheet && (
        <SheetFrame onClose={() => setSheet(null)} label={SHEET_LABEL[sheet.kind]}>
          {sheet.kind === 'profile' && (<>
            <div class="sheet-title">Your profile</div>
            <ProfileForm user={user} profile={profile} roomIds={rooms.map((r) => r.id)} submitLabel="Save"
              onSaved={() => { setSheet(null); flash('Profile saved'); }} />
          </>)}
          {sheet.kind === 'note' && <NoteSheet uid={user.uid} current={profile} onDone={(m) => { setSheet(null); flash(m); }} />}
          {sheet.kind === 'note-reply' && (
            <NoteReplySheet name={sheet.name} note={sheet.note} onSend={(t) => replyToNote(sheet.roomId, sheet.note, t)} />
          )}
          {sheet.kind === 'delete-account' && <DeleteAccountSheet user={user} onCancel={() => setSheet(null)} />}
          {sheet.kind === 'add' && (
            <AddContactSheet user={user} onToast={flash} onClose={() => setSheet(null)}
              onOpenChat={(id) => { setSheet(null); onOpen(id); }} />
          )}
          {sheet.kind === 'invite' && managed && (
            <AddContactSheet user={user} room={managed} onToast={flash} onClose={() => setSheet(null)} />
          )}
          {sheet.kind === 'settings' && (
            <SettingsSheet
              user={user}
              prefs={theme}
              onTheme={(t) => { setTheme(t); chooseTheme(user.uid, t); }}
              push={push}
              blocked={blocked}
              onUnblock={(uid) => unblock(user.uid, uid).then(() => flash('Unblocked')).catch((e) => flash(e.message))}
              onEditProfile={() => setSheet({ kind: 'profile' })}
              onDeleteAccount={() => setSheet({ kind: 'delete-account' })}
              onPush={async () => {
                try { await enablePush(user.uid); setPush('granted'); flash('Notifications on.'); } catch (e: any) { setPush(await pushStatus()); flash(e?.message || 'Could not turn on notifications.'); }
              }}
            />
          )}
        </SheetFrame>
      )}
      {toast && <div class="toast" role="status">{toast}</div>}
    </div>
  );
}

function timeLabel(ms: number, now = Date.now()) {
  if (!ms) return '';
  const day = dayLabel(ms, now);
  return day === 'Today' ? new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : day;
}

const SHEET_LABEL: Record<NonNullable<Sheet>['kind'], string> = {
  add: 'Add contact', invite: 'Invite', settings: 'Settings', profile: 'Your profile',
  note: 'Your note', 'note-reply': 'Reply to note', 'delete-account': 'Delete account',
};

// ---------------------------------------------------------------------------- notes strip

interface StripProps {
  me: string;
  myProfile: ProfileT | null | undefined;
  partners: { roomId: string; uid: string }[];
  contacts: Record<string, ContactPrefs>;
  onMine(): void;
  onTheirs(roomId: string, name: string, note: Note): void;
}

/** 24-hour notes: mine first, then everyone I chat with who has one. */
function NotesStrip({ me, myProfile, partners, contacts, onMine, onTheirs }: StripProps) {
  const now = useMinute();
  const mine = noteActive(myProfile?.note, now) ? myProfile!.note! : null;
  return (
    <div class="notes-strip" role="list" aria-label="Notes">
      <div role="listitem">
        <button type="button" class="note-person" onClick={onMine} aria-label={mine ? `Your note: ${noteLabel(mine)}. Change it` : 'Add a note'}>
          <span class={`note-bubble${mine ? '' : ' empty'}`} aria-hidden="true">{mine ? noteLabel(mine) : '+ Note'}</span>
          <Avatar profile={myProfile} name={myProfile?.name || '?'} size={52} />
          <span class="note-who" aria-hidden="true">Your note</span>
        </button>
      </div>
      {partners.map((p) => <PartnerNote key={p.uid} me={me} {...p} nickname={contacts[p.uid]?.nickname} now={now} onOpen={onTheirs} />)}
    </div>
  );
}

function PartnerNote({ roomId, uid, nickname, now, onOpen }: { me: string; roomId: string; uid: string; nickname?: string; now: number; onOpen: StripProps['onTheirs'] }) {
  const profile = useProfile(uid);
  const note = noteActive(profile?.note, now) ? profile!.note! : null;
  if (!note) return null;
  const name = displayName(nickname, profile?.name, '', 'Friend');
  return (
    <div role="listitem">
      <button type="button" class="note-person" onClick={() => onOpen(roomId, name, note)} aria-label={`${name}’s note: ${noteLabel(note)}. Reply`}>
        <span class="note-bubble" aria-hidden="true">{noteLabel(note)}</span>
        <Avatar profile={profile} name={name} size={52} />
        <span class="note-who" aria-hidden="true">{name}</span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------- one chat row

function ChatRow({ room, me, contacts, onOpen, onInvite }: { room: Room; me: string; contacts: Record<string, ContactPrefs>; onOpen(): void; onInvite(): void }) {
  const [members, setMembers] = useState<Record<string, Member>>({});
  useEffect(() => watchMembers(room.id, setMembers, () => {}), [room.id]);
  const partnerUid = room.members.find((u) => u !== me) || (room.left && room.left !== me ? room.left : '');
  const partner = partnerUid ? members[partnerUid] : undefined;
  const profile = useProfile(partnerUid || null);
  const prefs = partnerUid ? contacts[partnerUid] : undefined;
  const alone = !partnerUid;
  const name = alone
    ? (room.invites[0] ? firstName(room.invites[0]) : 'New invite')
    : displayName(prefs?.nickname, profile?.name, partner?.name, '…');
  const last = room.lastMessage;
  const lastMs = ms(last?.at);
  const readTs = last ? members[me]?.lastRead?.[last.tabId] : undefined;
  const readMs = readTs ? readTs.toMillis() : 0;
  const unread = !room.left && !!last && last.uid !== me && lastMs > readMs + 500;
  const typingUntil = !room.left && partner?.typingUntil ? partner.typingUntil.toMillis() : 0;
  const now = useTick(typingUntil > Date.now());
  const typing = typingUntil > now;
  const sub = room.left
    ? `${name} left this chat`
    : alone
      ? (room.invites[0] ? `Waiting for ${room.invites[0]} to join` : 'Invite link not used yet')
      : typing ? 'typing…' : last ? `${last.uid === me ? 'You: ' : ''}${last.text}` : 'Say hi';
  const mood = partner?.mood ? MOODS.find((m) => m.id === partner.mood) : undefined;

  return (
    <li class="chat-row">
      <button type="button" class="chat-open" onClick={onOpen}
        aria-label={`${name}${mood ? `, mood ${mood.label}` : ''}${unread ? ', unread messages' : ''}${prefs?.muted ? ', muted' : ''}. ${sub}`}>
        {alone ? <span class="avatar" aria-hidden="true">+</span> : <Avatar profile={profile} fallbackPhoto={partner?.photoURL} name={name} />}
        <span class="chat-text" aria-hidden="true">
          <span class="chat-top">
            <span class="chat-name">{name}</span>
            {partner?.mood && !room.left && <MoodIcon mood={partner.mood} size={18} />}
            {prefs?.muted && <span class="muted-mark" title="Muted">🔕</span>}
            <span class="chat-time">{timeLabel(lastMs)}</span>
          </span>
          <span class={`chat-sub${unread ? ' unread' : ''}${typing ? ' typing' : ''}`}>{sub}</span>
        </span>
        {unread && <span class="chat-dot" aria-hidden="true" />}
      </button>
      {alone && !room.left && room.owner === me && (
        <button type="button" class="chip-btn" onClick={onInvite} aria-label={`Share the invite for ${name} again`}>Share</button>
      )}
    </li>
  );
}

/** Ticks every second while `active` (for the typing… line). */
function useTick(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}
