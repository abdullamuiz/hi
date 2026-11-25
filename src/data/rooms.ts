import {
  collection, deleteDoc, deleteField, doc, getDoc, onSnapshot, writeBatch, query, serverTimestamp,
  setDoc, Timestamp, updateDoc, where, arrayUnion,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '../firebase';
import type { Member, MoodId, Room } from '../types';
import { GENERAL, generalTabDoc } from './tabs';
import { makeInviteCode } from '../lib/invite';
import { setRoomZone } from './memories';

const roomsCol = collection(db, 'rooms');
export const DEFAULT_TZ = 'Indian/Maldives';

function toRoom(id: string, d: any): Room {
  return {
    id, owner: d.owner, ownerName: d.ownerName || '', members: d.members || [], invites: d.invites || [],
    timezone: d.timezone || DEFAULT_TZ, createdAt: d.createdAt || null,
    inviteCode: typeof d.inviteCode === 'string' ? d.inviteCode : null,
    lastMessage: d.lastMessage && typeof d.lastMessage === 'object' ? d.lastMessage : null,
    left: typeof d.left === 'string' ? d.left : null,
    streak: d.streak && typeof d.streak === 'object' && (d.streak.state === 'proposed' || d.streak.state === 'on') ? d.streak : null,
    pinned: Array.isArray(d.pinned) ? d.pinned.filter((p: any) => p && typeof p.msgId === 'string').slice(0, 3) : [],
    self: d.self === true,
  };
}

export function watchMyRooms(uid: string, cb: (rooms: Room[], fromServer: boolean) => void, onError?: (e: Error) => void) {
  // Only rooms the server has confirmed: a room I'm still creating isn't readable for
  // its sub-collections yet, so opening it early would get listeners refused.
  return onSnapshot(
    query(roomsCol, where('members', 'array-contains', uid)),
    { includeMetadataChanges: true },
    // (createdAt stays null until the server has accepted the room; later edits don't hide it.)
    (s) => {
      const rooms = s.docs.filter((d) => d.data().createdAt != null).map((d) => toRoom(d.id, d.data({ serverTimestamps: 'estimate' })));
      // Activity days are filed in the room's zone, also for messages sent without the
      // chat open (note replies, scheduled messages).
      rooms.forEach((r) => setRoomZone(r.id, r.timezone));
      cb(rooms, !s.metadata.fromCache);
    },
    onError,
  );
}

/** Rooms that invited this e-mail and that I haven't joined yet. */
export function watchInvites(email: string, uid: string, cb: (rooms: Room[]) => void, onError?: (e: Error) => void) {
  return onSnapshot(
    query(roomsCol, where('invites', 'array-contains', email.toLowerCase())),
    (s) => cb(
      s.docs
        .map((d) => toRoom(d.id, d.data()))
        .filter((r) => !r.members.includes(uid) && r.members.length < 2),
    ),
    onError,
  );
}

/**
 * Starts a chat with a new contact: the room, my profile in it and its General tab in
 * ONE atomic write, so the room never exists without its tab. The e-mail is optional;
 * the share-link code is always made, so the link can be sent right away.
 */
export async function createRoom(user: User, partnerEmail = ''): Promise<{ id: string; code: string }> {
  const ref = doc(roomsCol);
  const code = makeInviteCode();
  const b = writeBatch(db);
  b.set(ref, {
    owner: user.uid,
    ownerName: user.displayName || user.email || '',
    members: [user.uid],
    invites: partnerEmail.trim() ? [partnerEmail.trim().toLowerCase()] : [],
    inviteCode: code,
    timezone: DEFAULT_TZ,
    createdAt: serverTimestamp(),
  });
  b.set(doc(db, 'rooms', ref.id, 'members', user.uid), memberProfile(user));
  b.set(doc(db, 'rooms', ref.id, 'tabs', GENERAL), generalTabDoc(user.uid));
  await b.commit();
  return { id: ref.id, code };
}

/** Set (or clear) the e-mail invite of a room I'm still alone in. */
export async function changeInvite(roomId: string, partnerEmail: string) {
  const v = partnerEmail.trim().toLowerCase();
  await updateDoc(doc(db, 'rooms', roomId), { invites: v ? [v] : [] });
}

/** Makes sure a room I'm alone in has a share-link code (older rooms don't). */
export async function ensureInviteCode(room: Room): Promise<string> {
  if (room.inviteCode) return room.inviteCode;
  const code = makeInviteCode();
  await updateDoc(doc(db, 'rooms', room.id), { inviteCode: code });
  return code;
}

/** A new code: any link sent earlier stops working. */
export async function newInviteCode(roomId: string): Promise<string> {
  const code = makeInviteCode();
  await updateDoc(doc(db, 'rooms', roomId), { inviteCode: code });
  return code;
}

/** Join with an invited, verified e-mail. */
export async function joinRoom(roomId: string, user: User) {
  const b = writeBatch(db);
  b.update(doc(db, 'rooms', roomId), { members: arrayUnion(user.uid), inviteCode: deleteField() });
  b.set(doc(db, 'rooms', roomId, 'members', user.uid), memberProfile(user), { merge: true });
  await b.commit();
}

/**
 * Join with a share-link code. Write-only (I can't read the room before I'm in it):
 * the rules check the code and that only my uid is added; the code is used up.
 */
export async function joinByCode(roomId: string, code: string, user: User) {
  const b = writeBatch(db);
  b.update(doc(db, 'rooms', roomId), { members: arrayUnion(user.uid), invites: [], inviteCode: deleteField(), joinCode: code });
  b.set(doc(db, 'rooms', roomId, 'members', user.uid), memberProfile(user), { merge: true });
  await b.commit();
}

/** Say no to an e-mail invite. */
export const declineInvite = (roomId: string) => updateDoc(doc(db, 'rooms', roomId), { invites: [] });

// ---------------------------------------------------------------- Notes to self

/** The id of the Notes to self room created automatically for a user. */
export const selfRoomId = (uid: string) => `self_${uid}`;

/** My device's time zone (falls back to the app default). */
function deviceZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TZ; } catch { return DEFAULT_TZ; }
}

/**
 * Creates my Notes to self room (rooms/self_{uid}) with its General tab, my profile in it
 * and the users/{uid}.selfRoom pointer, in one write. The fixed id makes it impossible to
 * end up with two, even from two phones at once (the second write is simply refused).
 */
export async function createSelfRoom(user: User) {
  const id = selfRoomId(user.uid);
  const b = writeBatch(db);
  b.set(doc(db, 'rooms', id), {
    owner: user.uid,
    ownerName: user.displayName || user.email || '',
    members: [user.uid],
    invites: [],
    self: true,
    timezone: deviceZone(),
    createdAt: serverTimestamp(),
  });
  b.set(doc(db, 'rooms', id, 'members', user.uid), memberProfile(user));
  b.set(doc(db, 'rooms', id, 'tabs', GENERAL), generalTabDoc(user.uid));
  b.set(doc(db, 'users', user.uid), { selfRoom: id }, { merge: true });
  await b.commit();
}

/**
 * Turns a chat nobody has joined into my Notes to self: its invite and share link go, and
 * it can never be joined. An empty automatic Notes to self room is removed, so there's one.
 */
export async function makeSelfRoom(room: Room, uid: string) {
  const b = writeBatch(db);
  b.update(doc(db, 'rooms', room.id), { self: true, invites: [], inviteCode: deleteField() });
  b.set(doc(db, 'users', uid), { selfRoom: room.id }, { merge: true });
  await b.commit();
  // The automatic one goes if nothing was ever written in it.
  const autoId = selfRoomId(uid);
  if (autoId === room.id) return;
  try {
    const auto = await getDoc(doc(db, 'rooms', autoId));
    if (auto.exists() && !auto.data().lastMessage) await removeRoom(autoId);
  } catch { /* not there, or not mine */ }
}

/** The Notes to self room to show: a converted one wins over the automatic one. */
export function pickSelfRoom(rooms: Room[], uid: string): Room | null {
  const mine = rooms.filter((r) => r.self && r.owner === uid);
  if (!mine.length) return null;
  return mine.find((r) => r.id !== selfRoomId(uid)) || mine[0];
}

/** Remove a chat nobody has joined yet. */
export const removeRoom = (roomId: string) => deleteDoc(doc(db, 'rooms', roomId));

function memberProfile(user: User) {
  return {
    uid: user.uid,
    name: (user.displayName || user.email || '').slice(0, 80),
    photoURL: user.photoURL ? user.photoURL.slice(0, 2048) : null,
    lastSeen: serverTimestamp(),
  };
}

export async function ensureMember(roomId: string, user: User) {
  await setDoc(doc(db, 'rooms', roomId, 'members', user.uid), memberProfile(user), { merge: true });
}

export function watchMembers(roomId: string, cb: (m: Record<string, Member>) => void, onError?: (e: Error) => void) {
  return onSnapshot(collection(db, 'rooms', roomId, 'members'), { includeMetadataChanges: false }, (s) => {
    const out: Record<string, Member> = {};
    s.docs.forEach((d) => {
      const x = d.data({ serverTimestamps: 'estimate' });
      out[d.id] = {
        uid: d.id,
        name: x.name || '',
        photoURL: x.photoURL ?? null,
        mood: x.mood ?? null,
        lastSeen: x.lastSeen ?? null,
        typingUntil: x.typingUntil ?? null,
        typingTab: x.typingTab ?? null,
        lastRead: x.lastRead || {},
      };
    });
    cb(out);
  }, onError);
}

function memberRef(roomId: string, uid: string) {
  return doc(db, 'rooms', roomId, 'members', uid);
}

export const setMood = (roomId: string, uid: string, mood: MoodId) =>
  setDoc(memberRef(roomId, uid), { uid, mood }, { merge: true });

export const heartbeat = (roomId: string, uid: string) =>
  setDoc(memberRef(roomId, uid), { uid, lastSeen: serverTimestamp() }, { merge: true });

export const setTyping = (roomId: string, uid: string, tabId: string, typing: boolean) =>
  setDoc(memberRef(roomId, uid), { uid, typingTab: tabId, typingUntil: typing ? Timestamp.fromMillis(Date.now() + 6000) : null }, { merge: true });
