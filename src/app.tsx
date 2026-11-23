import { useEffect, useState } from 'preact/hooks';
import { getRedirectResult, onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from './firebase';
import { watchInvites, watchMyRooms } from './data/rooms';
import type { Room } from './types';
import { SignIn } from './ui/SignIn';
import { Lobby } from './ui/Lobby';
import { Chat } from './ui/Chat';

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [invites, setInvites] = useState<Room[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    getRedirectResult(auth).catch((e) => setErr(e?.message || String(e)));
    return onAuthStateChanged(auth, (u) => { setUser(u); setRooms(null); setInvites([]); });
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsubs = [watchMyRooms(user.uid, setRooms, (e) => setErr(e.message))];
    if (user.email && user.emailVerified) unsubs.push(watchInvites(user.email, user.uid, setInvites, (e) => setErr(e.message)));
    return () => unsubs.forEach((u) => u());
  }, [user?.uid]);

  if (user === undefined || (user && rooms === null && !err)) return <Splash />;
  if (!user) return <SignIn />;
  if (err && rooms === null) return <div class="app"><div class="screen"><div class="err">{err}</div></div></div>;

  const full = rooms!.find((r) => r.members.length === 2);
  if (full) return <Chat key={full.id} user={user} room={full} />;
  const waiting = rooms!.find((r) => r.owner === user.uid) || null;
  return <Lobby user={user} invites={invites} waiting={waiting} />;
}

function Splash() {
  return <div class="app" aria-busy="true"><div class="screen" /></div>;
}
