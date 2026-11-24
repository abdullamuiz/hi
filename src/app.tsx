import { useEffect, useRef, useState } from 'preact/hooks';
import { getRedirectResult, onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from './firebase';
import { watchInvites, watchMyRooms } from './data/rooms';
import { syncThemeFromAccount } from './data/prefs';
import type { Room } from './types';
import { SignIn } from './ui/SignIn';
import { Chats } from './ui/Chats';
import { Chat } from './ui/Chat';
import { JoinScreen } from './ui/JoinScreen';
import { UpdateBar } from './ui/PullToRefresh';
import { watchForUpdates } from './lib/updates';
import { splashReady } from './lib/splash';
import { clearPendingJoin, loadPendingJoin, parseJoin, savePendingJoin, type JoinRequest } from './lib/invite';
import { firstName } from './lib/names';
import { watchBlocked, watchContacts, type Blocked, type ContactPrefs } from './data/profile';
import { ProfileSetup, useProfile } from './ui/Profile';
import { useScheduledDelivery } from './ui/Delivery';
import { handleOverlayPop } from './lib/overlay';

export function App() {
  const [update, setUpdate] = useState(false);
  useEffect(() => watchForUpdates(() => setUpdate(true)), []);
  const bar = update ? <UpdateBar onDismiss={() => setUpdate(false)} /> : null;
  return <>{bar}<Screen /></>;
}

const LAST_ROOM = 'hi.room';
const remember = (id: string | null) => { try { if (id) localStorage.setItem(LAST_ROOM, id); else localStorage.removeItem(LAST_ROOM); } catch { /* ignore */ } };
const lastRoom = () => { try { return localStorage.getItem(LAST_ROOM); } catch { return null; } };
const setTabFor = (roomId: string, tab: string) => { try { localStorage.setItem(`hi.tab.${roomId}`, tab); } catch { /* ignore */ } };

/** A share link (?join=…) is kept until it's used, so it survives signing in. */
function initialJoin(): JoinRequest | null {
  const fromUrl = parseJoin(location.search);
  if (fromUrl) {
    savePendingJoin(fromUrl);
    history.replaceState(history.state, '', location.pathname);
    return fromUrl;
  }
  return loadPendingJoin();
}

function Screen() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [invites, setInvites] = useState<Room[]>([]);
  const [err, setErr] = useState('');
  const [join, setJoin] = useState<JoinRequest | null>(initialJoin);
  const [openId, setOpenId] = useState<string | null>(null);
  // Bumped to remount the chat (e.g. a notification asks for another tab).
  const [nonce, setNonce] = useState(0);
  const decided = useRef(false);
  const roomsRef = useRef<Room[] | null>(null);
  roomsRef.current = rooms;
  // A chat I just joined isn't listed until the server confirms it: open it when it shows up.
  const [awaiting, setAwaiting] = useState<string | null>(null);
  const myProfile = useProfile(user?.uid);
  const [contacts, setContacts] = useState<Record<string, ContactPrefs>>({});
  const [blocked, setBlocked] = useState<Blocked[]>([]);
  // My scheduled messages, sent on time while the app is open.
  const scheduled = useScheduledDelivery(user?.uid, rooms);

  useEffect(() => {
    getRedirectResult(auth).catch((e) => setErr(e?.message || String(e)));
    return onAuthStateChanged(auth, (u) => { setUser(u); setRooms(null); setInvites([]); decided.current = false; setOpenId(null); });
  }, []);

  useEffect(() => {
    if (!user) return;
    syncThemeFromAccount(user.uid);
    const unsubs = [watchMyRooms(user.uid, setRooms, (e) => setErr(e.message))];
    if (user.email && user.emailVerified) unsubs.push(watchInvites(user.email, user.uid, setInvites, (e) => setErr(e.message)));
    unsubs.push(watchContacts(user.uid, setContacts), watchBlocked(user.uid, setBlocked));
    return () => unsubs.forEach((u) => u());
  }, [user?.uid]);

  // --- navigation: the chat list, or one chat. The phone's back gesture returns to the list.
  const open = (id: string) => {
    if (!roomsRef.current?.some((r) => r.id === id)) { setAwaiting(id); return; }
    setOpenId(id);
    remember(id);
    if (history.state?.hiChat !== id) history.pushState({ hiChat: id }, '', location.pathname);
  };
  const back = () => {
    if (history.state?.hiChat) history.back();
    else { setOpenId(null); remember(null); }
  };
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      if (handleOverlayPop()) return;
      const id = e.state?.hiChat || null;
      setOpenId(id);
      remember(id);
    };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (!awaiting) return;
    if (rooms?.some((r) => r.id === awaiting)) { const id = awaiting; setAwaiting(null); open(id); return; }
    const t = setTimeout(() => setAwaiting(null), 10_000);
    return () => clearTimeout(t);
  }, [rooms, awaiting]);

  // A tapped notification while the app is open: the service worker asks us to open a chat.
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type !== 'open-chat' || typeof e.data.room !== 'string') return;
      if (typeof e.data.tab === 'string') setTabFor(e.data.room, e.data.tab);
      setNonce((n) => n + 1);
      open(e.data.room);
    };
    sw.addEventListener('message', onMsg);
    return () => sw.removeEventListener('message', onMsg);
  }, []);

  // First load: open the chat from a notification (?room=), else the last one used,
  // else the only one there is.
  useEffect(() => {
    if (!rooms || decided.current) return;
    decided.current = true;
    const p = new URLSearchParams(location.search);
    const fromUrl = p.get('room');
    if (p.has('room') || p.has('tab')) history.replaceState(history.state, '', location.pathname);
    if (join) return;
    let target: string | null = null;
    if (fromUrl && rooms.some((r) => r.id === fromUrl)) {
      target = fromUrl;
      const tab = p.get('tab');
      if (tab) setTabFor(fromUrl, tab);
    } else if (history.state?.hiChat && rooms.some((r) => r.id === history.state.hiChat)) {
      target = history.state.hiChat;
    } else {
      const last = lastRoom();
      if (last && rooms.some((r) => r.id === last)) target = last;
      else if (rooms.length === 1) target = rooms[0].id;
    }
    if (target) {
      // Keep a list entry underneath, so "back" lands on the chat list instead of leaving the app.
      if (!history.state?.hiChat) history.replaceState(null, '', location.pathname);
      open(target);
    }
  }, [rooms]);

  const loading = user === undefined || (!!user && ((rooms === null && !err) || myProfile === undefined));
  useEffect(() => { if (!loading) splashReady(); }, [loading]);

  if (loading) return <Splash />;
  if (!user) return <SignIn invitedBy={join ? firstName(join.from, '') : undefined} />;
  if (err && rooms === null) return <div class="app"><div class="screen"><div class="err">{err}</div></div></div>;

  // First sign-in: set up a profile before anything else.
  if (myProfile === null) return <ProfileSetup user={user} roomIds={(rooms || []).map((r) => r.id)} onDone={() => {}} />;

  const finishJoin = () => { clearPendingJoin(); setJoin(null); };
  if (join) {
    return (
      <JoinScreen
        user={user}
        join={join}
        rooms={rooms!}
        onOpen={(id) => { finishJoin(); open(id); }}
        onDone={finishJoin}
      />
    );
  }

  if (awaiting) return <div class="app" aria-busy="true"><div class="screen"><div class="sys">Opening chat…</div></div></div>;
  // (A chat that has gone away, e.g. a removed invite, falls back to the list.)
  const room = openId ? rooms!.find((r) => r.id === openId) : undefined;
  if (room) return <Chat key={`${room.id}:${nonce}`} user={user} room={room} contacts={contacts} blocked={blocked} scheduled={scheduled[room.id] || []} onBack={back} />;
  const blockedIds = new Set(blocked.map((b) => b.uid));
  return <Chats user={user} profile={myProfile} rooms={rooms!} invites={invites.filter((r) => !blockedIds.has(r.owner))} contacts={contacts} blocked={blocked} onOpen={open} />;
}

function Splash() {
  return <div class="app" aria-busy="true"><div class="screen" /></div>;
}
