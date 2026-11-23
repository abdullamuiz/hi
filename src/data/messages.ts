import {
  collection, doc, limitToLast, onSnapshot, orderBy, query, serverTimestamp, setDoc, writeBatch,
} from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';
import { findLink } from '../lib/links';
import { compressImage } from '../lib/image';
import type { Message } from '../types';

export function watchMessages(roomId: string, cb: (m: Message[]) => void, onError?: (e: Error) => void) {
  const q = query(collection(db, 'rooms', roomId, 'messages'), orderBy('createdAt'), limitToLast(300));
  return onSnapshot(q, (s) => {
    cb(s.docs.map((d) => ({ id: d.id, text: '', ...(d.data({ serverTimestamps: 'estimate' }) as any) })));
  }, onError);
}

const newId = (roomId: string) => doc(collection(db, 'rooms', roomId, 'messages')).id;

export async function sendText(roomId: string, uid: string, raw: string) {
  const text = raw.trim().slice(0, 4000);
  if (!text) return;
  const link = findLink(text);
  const msgRef = doc(db, 'rooms', roomId, 'messages', newId(roomId));
  if (link) {
    await setDoc(msgRef, {
      uid, kind: 'link', text: link.rest, createdAt: serverTimestamp(),
      link: {
        url: link.url, domain: link.domain, isVideo: link.isVideo,
        title: null, description: null, image: null, siteName: null, status: 'pending',
      },
    });
  } else {
    await setDoc(msgRef, { uid, kind: 'text', text, createdAt: serverTimestamp() });
  }
}

export async function sendPhoto(roomId: string, uid: string, file: File, caption: string) {
  const { blob, width, height } = await compressImage(file, 1600);
  const id = newId(roomId);
  const path = `rooms/${roomId}/photos/${uid}/${id}.jpg`;
  await uploadBytes(ref(storage, path), blob, { contentType: 'image/jpeg', cacheControl: 'private, max-age=31536000' });
  await setDoc(doc(db, 'rooms', roomId, 'messages', id), {
    uid, kind: 'photo', text: caption.trim().slice(0, 1000), photo: { path, width, height }, createdAt: serverTimestamp(),
  });
}

/** Creates a Drop and the chat message that carries it, atomically. */
export async function createDrop(
  roomId: string, uid: string, type: string, content: Record<string, unknown>, firstEntries: string[] = [],
) {
  const batch = writeBatch(db);
  const dropRef = doc(collection(db, 'rooms', roomId, 'drops'));
  batch.set(dropRef, { type, createdBy: uid, createdAt: serverTimestamp(), content });
  firstEntries.forEach((text) => {
    batch.set(doc(collection(dropRef, 'entries')), { uid, text: text.slice(0, 280), createdAt: serverTimestamp() });
  });
  batch.set(doc(db, 'rooms', roomId, 'messages', newId(roomId)), {
    uid, kind: 'drop', text: '', dropId: dropRef.id, createdAt: serverTimestamp(),
  });
  await batch.commit();
  return dropRef.id;
}
