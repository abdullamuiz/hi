import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { User } from 'firebase/auth';
import { declineInvite, joinRoom, watchMembers } from '../data/rooms';
import { enablePush, pushStatus, type PushStatus } from '../data/push';
import { chooseTheme } from '../data/prefs';
import { currentPrefs, onThemeChange, type ThemePrefs } from '../lib/themes';
import { firstName, initial } from '../lib/names';
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
  rooms: Room[];
  /** Rooms that invited my e-mail and that I haven't joined. */
  invites: Room[];
  onOpen(roomId: string): void;
}

type Sheet = null | { kind: 'add' } | { kind: 'invite'; roomId: string } | { kind: 'settings' };

const ms = (t: { toMillis(): number } | null | undefined) => (t ? t.toMillis() : 0);
const sortKey = (r: Room) => ms(r.lastMessage?.at) || ms(r.createdAt) || Date.now();

/** Home: every chat (one per contact), invitations, and "+ Add contact". */
export function Chats({ user, rooms, invites, onOpen }: Props) {
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

  const managed = sheet?.kind === 'invite' ? rooms.find((r) => r.id === sheet.roomId) : undefined;

  return (
    <div class="app">
      <header class="hdr">
        <Logo size={40} />
        <div class="hdr-text"><div class="hdr-name">Chats</div></div>
        <div class="hdr-actions">
          <ModeToggle uid={user.uid} />
          <button type="button" class="icon-btn" onClick={() => setSheet({ kind: 'settings' })} aria-label="Settings"><SettingsIcon /></button>
        </div>
      </header>

      <main class="feed" ref={scroller}>
        {pull}
        <div class="feed-inner chats">
          {err && <div class="err" role="alert">{err}</div>}

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
                <ChatRow key={r.id} room={r} me={user.uid} onOpen={() => onOpen(r.id)} onInvite={() => setSheet({ kind: 'invite', roomId: r.id })} />
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
        <SheetFrame onClose={() => setSheet(null)} label={sheet.kind === 'settings' ? 'Settings' : 'Invite'}>
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

function ChatRow({ room, me, onOpen, onInvite }: { room: Room; me: string; onOpen(): void; onInvite(): void }) {
  const [members, setMembers] = useState<Record<string, Member>>({});
  useEffect(() => watchMembers(room.id, setMembers, () => {}), [room.id]);
  const partnerUid = room.members.find((u) => u !== me) || '';
  const partner = partnerUid ? members[partnerUid] : undefined;
  const alone = !partnerUid;
  const name = alone
    ? (room.invites[0] ? firstName(room.invites[0]) : 'New invite')
    : firstName(partner?.name, '…');
  const last = room.lastMessage;
  const lastMs = ms(last?.at);
  const readTs = last ? members[me]?.lastRead?.[last.tabId] : undefined;
  const readMs = readTs ? readTs.toMillis() : 0;
  const unread = !!last && last.uid !== me && lastMs > readMs + 500;
  const sub = alone
    ? (room.invites[0] ? `Waiting for ${room.invites[0]} to join` : 'Invite link not used yet')
    : last ? `${last.uid === me ? 'You: ' : ''}${last.text}` : 'Say hi';
  const mood = partner?.mood ? MOODS.find((m) => m.id === partner.mood) : undefined;

  return (
    <li class="chat-row">
      <button type="button" class="chat-open" onClick={onOpen}
        aria-label={`${name}${mood ? `, mood ${mood.label}` : ''}${unread ? ', unread messages' : ''}. ${sub}`}>
        <span class="avatar" aria-hidden="true">
          {partner?.photoURL ? <img src={partner.photoURL} alt="" referrerpolicy="no-referrer" /> : alone ? '+' : initial(name)}
        </span>
        <span class="chat-text" aria-hidden="true">
          <span class="chat-top">
            <span class="chat-name">{name}</span>
            {partner?.mood && <MoodIcon mood={partner.mood} size={18} />}
            <span class="chat-time">{timeLabel(lastMs)}</span>
          </span>
          <span class={`chat-sub${unread ? ' unread' : ''}`}>{sub}</span>
        </span>
        {unread && <span class="chat-dot" aria-hidden="true" />}
      </button>
      {alone && room.owner === me && (
        <button type="button" class="chip-btn" onClick={onInvite} aria-label={`Share the invite for ${name} again`}>Share</button>
      )}
    </li>
  );
}
