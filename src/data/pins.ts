import { addDoc, collection, onSnapshot, orderBy, query, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import type { Pin } from '../types';

export function watchPins(roomId: string, cb: (p: Pin[]) => void) {
  return onSnapshot(query(collection(db, 'rooms', roomId, 'pins'), orderBy('createdAt')), (s) =>
    cb(s.docs.map((d) => ({ id: d.id, ...(d.data({ serverTimestamps: 'estimate' }) as any) }))),
  );
}

export function addPin(roomId: string, by: string, p: { title: string; detail: string; dropId?: string; messageId?: string; tabId?: string }) {
  return addDoc(collection(db, 'rooms', roomId, 'pins'), {
    by,
    title: p.title.slice(0, 120),
    detail: p.detail.slice(0, 3000),
    dropId: p.dropId ?? null,
    messageId: p.messageId ?? null,
    tabId: p.tabId ?? null,
    createdAt: serverTimestamp(),
  });
}
