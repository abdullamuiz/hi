import {
  collection, deleteDoc, doc, getDocs, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where,
  arrayRemove, writeBatch, Timestamp,
} from 'firebase/firestore';
import { deleteUser, updateProfile, type User } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import type { Note } from '../lib/profile';

/** profiles/{uid} — public: no e-mail. */
export interface Profile {
  uid: string;
  name: string;
  /** data: URL (inline JPEG) or https URL; null = coloured initial. */
  photo: string | null;
  about: string;
  note: Note | null;
}

/** users/{me}/contacts/{uid} — private to me. */
export interface ContactPrefs {
  nickname: string;
  /** Muted for good. */
  muted: boolean;
  /** Muted until this time (ms), e.g. 8 hours or a week. */
  mutedUntil: number | null;
  /** The daily question in this chat (on unless I turned it off). */
  dailyQuestion?: boolean;
  /** On This Day cards and the monthly Rewind in this chat. */
  memories?: boolean;
}

export interface Blocked {
  uid: string;
  name: string;
}

function toProfile(uid: string, d: any): Profile {
  const n = d?.note;
  return {
    uid,
    name: typeof d?.name === 'string' ? d.name : '',
    photo: typeof d?.photo === 'string' ? d.photo : null,
    about: typeof d?.about === 'string' ? d.about : '',
    note: n && typeof n === 'object'
      ? { text: String(n.text || ''), emoji: String(n.emoji || ''), atMs: n.at && typeof n.at.toMillis === 'function' ? n.at.toMillis() : null }
      : null,
  };
}

// One listener per profile, shared by every avatar and name on screen.
type Entry = { value: Profile | null | undefined; subs: Set<(p: Profile | null) => void>; stop?: () => void };
const cache = new Map<string, Entry>();

/** Calls back with the profile, or null when that person hasn't made one. */
export function watchProfile(uid: string, cb: (p: Profile | null) => void): () => void {
  let e = cache.get(uid);
  if (!e) {
    const entry: Entry = { value: undefined, subs: new Set() };
    e = entry;
    cache.set(uid, entry);
    entry.stop = onSnapshot(doc(db, 'profiles', uid), (s) => {
      entry.value = s.exists() ? toProfile(uid, s.data({ serverTimestamps: 'estimate' })) : null;
      entry.subs.forEach((f) => f(entry.value as Profile | null));
    }, () => {
      entry.value = null;
      entry.subs.forEach((f) => f(null));
    });
  }
  e.subs.add(cb);
  if (e.value !== undefined) cb(e.value);
  const entry = e;
  return () => {
    entry.subs.delete(cb);
    if (!entry.subs.size) {
      // Keep it briefly, so switching screens doesn't re-download.
      setTimeout(() => {
        if (!entry.subs.size && cache.get(uid) === entry) { entry.stop?.(); cache.delete(uid); }
      }, 30_000);
    }
  };
}

export interface ProfileInput {
  name: string;
  photo: string | null;
  about: string;
}

/**
 * Saves my profile, updates the sign-in name (so new chats use it) and the name and
 * Google photo shown inside each chat I'm in.
 */
export async function saveProfile(user: User, input: ProfileInput, roomIds: string[]) {
  const name = input.name.trim().slice(0, 40);
  const about = input.about.trim().slice(0, 80);
  await setDoc(doc(db, 'profiles', user.uid), { name, photo: input.photo, about, updatedAt: serverTimestamp() }, { merge: true });
  if (user.displayName !== name) await updateProfile(user, { displayName: name }).catch(() => {});
  if (roomIds.length) {
    const b = writeBatch(db);
    const photoURL = input.photo && input.photo.startsWith('https://') ? input.photo : null;
    roomIds.forEach((id) => b.set(doc(db, 'rooms', id, 'members', user.uid), { uid: user.uid, name, photoURL }, { merge: true }));
    await b.commit().catch(() => {});
  }
}

export const setNote = (uid: string, text: string, emoji: string) =>
  updateDoc(doc(db, 'profiles', uid), {
    note: { text: text.trim().slice(0, 60), emoji, at: serverTimestamp() },
    updatedAt: serverTimestamp(),
  });

export const clearNote = (uid: string) =>
  updateDoc(doc(db, 'profiles', uid), { note: null, updatedAt: serverTimestamp() });

// ---------------------------------------------------------------- my private lists

export function watchContacts(me: string, cb: (c: Record<string, ContactPrefs>) => void) {
  return onSnapshot(collection(db, 'users', me, 'contacts'), (s) => {
    const out: Record<string, ContactPrefs> = {};
    s.docs.forEach((d) => {
      const x = d.data();
      const until = x.mutedUntil && typeof x.mutedUntil.toMillis === 'function' ? x.mutedUntil.toMillis() : null;
      out[d.id] = { nickname: String(x.nickname || ''), muted: x.muted === true, mutedUntil: until, dailyQuestion: x.dailyQuestion !== false, memories: x.memories !== false };
    });
    cb(out);
  }, () => cb({}));
}

export function setContact(me: string, uid: string, patch: Partial<ContactPrefs>) {
  const data: Record<string, unknown> = { ...patch, updatedAt: serverTimestamp() };
  if ('mutedUntil' in patch) data.mutedUntil = patch.mutedUntil == null ? null : Timestamp.fromMillis(patch.mutedUntil);
  return setDoc(doc(db, 'users', me, 'contacts', uid), data, { merge: true });
}

export function watchBlocked(me: string, cb: (b: Blocked[]) => void) {
  return onSnapshot(collection(db, 'users', me, 'blocked'), (s) => {
    cb(s.docs.map((d) => ({ uid: d.id, name: String(d.data().name || '') })));
  }, () => cb([]));
}

export const unblock = (me: string, uid: string) => deleteDoc(doc(db, 'users', me, 'blocked', uid));

// ---------------------------------------------------------------- leaving

/** Remove contact: I leave the chat. It stays, read-only, for the other person. */
export const leaveRoom = (roomId: string, me: string) =>
  updateDoc(doc(db, 'rooms', roomId), { members: arrayRemove(me), left: me, invites: [] });

/** The last one in a chat deletes it from their list. */
export const deleteRoom = (roomId: string) => deleteDoc(doc(db, 'rooms', roomId));

/** Block: they can't join my chats again, and I leave any chat we share. */
export async function blockContact(me: string, uid: string, name: string, sharedRoomIds: string[]) {
  await setDoc(doc(db, 'users', me, 'blocked', uid), { name: name.slice(0, 80), at: serverTimestamp() });
  for (const id of sharedRoomIds) await leaveRoom(id, me);
}

// ---------------------------------------------------------------- delete account

/** True when the last sign-in is recent enough to delete the sign-in account directly. */
export const recentlySignedIn = (user: User, now = Date.now()) =>
  now - Date.parse(user.metadata.lastSignInTime || '0') < 5 * 60 * 1000;

/**
 * Deletes everything. Uses the Cloud Function when it's deployed; otherwise does the
 * same steps from the app (which needs a recent sign-in for the last step).
 */
export async function deleteAccount(user: User): Promise<void> {
  try {
    await httpsCallable(functions, 'deleteAccount')();
    return;
  } catch (e: any) {
    const code = String(e?.code || '');
    // Anything other than "the function isn't there" is a real error.
    if (!/not-found|unavailable|internal|unimplemented/.test(code)) throw e;
  }
  if (!recentlySignedIn(user)) {
    const err = new Error('For your safety, sign out and sign in again, then delete your account.');
    (err as any).code = 'requires-recent-login';
    throw err;
  }
  const mine = await getDocs(query(collection(db, 'rooms'), where('members', 'array-contains', user.uid)));
  for (const r of mine.docs) {
    const members: string[] = r.data().members || [];
    if (members.length <= 1) await deleteDoc(r.ref);
    else await leaveRoom(r.id, user.uid);
  }
  for (const sub of ['contacts', 'blocked', 'tokens', 'reads']) {
    const s = await getDocs(collection(db, 'users', user.uid, sub));
    await Promise.all(s.docs.map((d) => deleteDoc(d.ref)));
  }
  await deleteDoc(doc(db, 'users', user.uid)).catch(() => {});
  await deleteDoc(doc(db, 'profiles', user.uid)).catch(() => {});
  await deleteUser(user);
}
