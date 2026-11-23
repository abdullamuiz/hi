import {
  collection, doc, limitToLast, onSnapshot, orderBy, query, serverTimestamp, writeBatch, type WriteBatch,
} from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';
import { findLink } from '../lib/links';
import { compressImage } from '../lib/image';
import type { Message } from '../types';

const msgsCol = (roomId: string, tabId: string) => collection(db, 'rooms', roomId, 'tabs', tabId, 'messages');

export function watchMessages(roomId: string, tabId: string, cb: (m: Message[]) => void, onError?: (e: Error) => void) {
  const q = query(msgsCol(roomId, tabId), orderBy('createdAt'), limitToLast(300));
  return onSnapshot(q, (s) => {
    cb(s.docs.map((d) => ({ id: d.id, tabId, text: '', ...(d.data({ serverTimestamps: 'estimate' }) as any) })));
  }, onError);
}

const newId = (roomId: string, tabId: string) => doc(msgsCol(roomId, tabId)).id;

/** Writes a message and bumps the tab's lastMessageAt in the same atomic batch. */
function addMessage(b: WriteBatch, roomId: string, tabId: string, id: string, data: Record<string, unknown>) {
  b.set(doc(msgsCol(roomId, tabId), id), { ...data, createdAt: serverTimestamp() });
  b.update(doc(db, 'rooms', roomId, 'tabs', tabId), { lastMessageAt: serverTimestamp() });
}

export async function sendText(roomId: string, tabId: string, uid: string, raw: string) {
  const text = raw.trim().slice(0, 4000);
  if (!text) return;
  const link = findLink(text);
  const b = writeBatch(db);
  if (link) {
    addMessage(b, roomId, tabId, newId(roomId, tabId), {
      uid, kind: 'link', text: link.rest,
      link: {
        url: link.url, domain: link.domain, isVideo: link.isVideo,
        title: null, description: null, image: null, siteName: null, status: 'pending',
      },
    });
  } else {
    addMessage(b, roomId, tabId, newId(roomId, tabId), { uid, kind: 'text', text });
  }
  await b.commit();
}

export async function sendPhoto(roomId: string, tabId: string, uid: string, file: File, caption: string) {
  const { blob, width, height } = await compressImage(file, 1600);
  const id = newId(roomId, tabId);
  const path = `rooms/${roomId}/photos/${uid}/${id}.jpg`;
  await uploadBytes(ref(storage, path), blob, { contentType: 'image/jpeg', cacheControl: 'private, max-age=31536000' });
  const b = writeBatch(db);
  addMessage(b, roomId, tabId, id, { uid, kind: 'photo', text: caption.trim().slice(0, 1000), photo: { path, width, height } });
  await b.commit();
}

/** Creates a Drop and the chat message that carries it, atomically. */
export async function createDrop(
  roomId: string, tabId: string, uid: string, type: string, content: Record<string, unknown>, firstEntries: string[] = [],
) {
  const b = writeBatch(db);
  const dropRef = doc(collection(db, 'rooms', roomId, 'drops'));
  b.set(dropRef, { type, createdBy: uid, createdAt: serverTimestamp(), content });
  firstEntries.forEach((text) => {
    b.set(doc(collection(dropRef, 'entries')), { uid, text: text.slice(0, 280), createdAt: serverTimestamp() });
  });
  addMessage(b, roomId, tabId, newId(roomId, tabId), { uid, kind: 'drop', text: '', dropId: dropRef.id });
  await b.commit();
  return dropRef.id;
}
