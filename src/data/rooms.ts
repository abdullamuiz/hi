import {
  addDoc, collection, doc, onSnapshot, query, runTransaction, serverTimestamp,
  setDoc, Timestamp, updateDoc, where, arrayUnion,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '../firebase';
import type { Member, MoodId, Room } from '../types';

const roomsCol = collection(db, 'rooms');

function toRoom(id: string, d: any): Room {
  return { id, owner: d.owner, ownerName: d.ownerName || '', members: d.members || [], invites: d.invites || [], createdAt: d.createdAt || null };
}

export function watchMyRooms(uid: string, cb: (rooms: Room[]) => void, onError?: (e: Error) => void) {
  return onSnapshot(
    query(roomsCol, where('members', 'array-contains', uid)),
    (s) => cb(s.docs.map((d) => toRoom(d.id, d.data({ serverTimestamps: 'estimate' })))),
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

export async function createRoom(user: User, partnerEmail: string): Promise<string> {
  const ref = await addDoc(roomsCol, {
    owner: user.uid,
    ownerName: user.displayName || user.email || '',
    members: [user.uid],
    invites: [partnerEmail.trim().toLowerCase()],
    createdAt: serverTimestamp(),
  });
  await ensureMember(ref.id, user);
  return ref.id;
}

export async function changeInvite(roomId: string, partnerEmail: string) {
  await updateDoc(doc(db, 'rooms', roomId), { invites: [partnerEmail.trim().toLowerCase()] });
}

export async function joinRoom(roomId: string, user: User) {
  const ref = doc(db, 'rooms', roomId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const members: string[] = snap.data()?.members || [];
    if (members.includes(user.uid)) return;
    if (members.length >= 2) throw new Error('This room already has two people.');
    tx.update(ref, { members: arrayUnion(user.uid) });
  });
  await ensureMember(roomId, user);
}

export async function ensureMember(roomId: string, user: User) {
  await setDoc(
    doc(db, 'rooms', roomId, 'members', user.uid),
    {
      uid: user.uid,
      name: (user.displayName || user.email || '').slice(0, 80),
      photoURL: user.photoURL ? user.photoURL.slice(0, 2048) : null,
      lastSeen: serverTimestamp(),
    },
    { merge: true },
  );
}

export function watchMembers(roomId: string, cb: (m: Record<string, Member>) => void) {
  return onSnapshot(collection(db, 'rooms', roomId, 'members'), (s) => {
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
      };
    });
    cb(out);
  });
}

function memberRef(roomId: string, uid: string) {
  return doc(db, 'rooms', roomId, 'members', uid);
}

export const setMood = (roomId: string, uid: string, mood: MoodId) =>
  setDoc(memberRef(roomId, uid), { uid, mood }, { merge: true });

export const heartbeat = (roomId: string, uid: string) =>
  setDoc(memberRef(roomId, uid), { uid, lastSeen: serverTimestamp() }, { merge: true });

export const setTyping = (roomId: string, uid: string, typing: boolean) =>
  setDoc(memberRef(roomId, uid), { uid, typingUntil: typing ? Timestamp.fromMillis(Date.now() + 6000) : null }, { merge: true });
