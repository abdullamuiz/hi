import {
  addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, runTransaction, serverTimestamp, updateDoc, where,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Pin, ScrapKind, TopPin } from '../types';
import { NOTE_MAX, TOP_PINS_MAX } from '../lib/scrapbook';
import { parseDay } from '../drops/logic';

const pinsCol = (roomId: string) => collection(db, 'rooms', roomId, 'pins');

export function watchPins(roomId: string, cb: (p: Pin[]) => void, onError?: (e: Error) => void) {
  return onSnapshot(query(pinsCol(roomId), orderBy('createdAt')), (s) =>
    cb(s.docs.map((d) => ({ id: d.id, ...(d.data({ serverTimestamps: 'estimate' }) as any) }))),
    onError,
  );
}

export interface NewPin {
  title: string;
  detail: string;
  dropId?: string;
  messageId?: string;
  tabId?: string | null;
  kind?: ScrapKind;
  order?: number;
  photoPath?: string | null;
  senderId?: string | null;
}

export function addPin(roomId: string, by: string, p: NewPin) {
  const kind: ScrapKind = p.kind || (p.dropId ? 'drop' : p.messageId ? 'message' : 'note');
  return addDoc(pinsCol(roomId), {
    by,
    title: p.title.slice(0, 120) || 'Pinned',
    detail: p.detail.slice(0, 3000),
    dropId: p.dropId ?? null,
    messageId: p.messageId ?? null,
    tabId: p.tabId ?? null,
    kind,
    order: typeof p.order === 'number' ? p.order : Date.now(),
    ...(p.photoPath ? { photoPath: p.photoPath } : {}),
    ...(p.senderId ? { senderId: p.senderId } : {}),
    createdAt: serverTimestamp(),
  });
}

/** A note written straight into the scrapbook. */
export const addNote = (roomId: string, by: string, text: string, colour: string, order: number) =>
  addDoc(pinsCol(roomId), {
    by, title: 'Note', detail: text.trim().slice(0, NOTE_MAX), dropId: null, messageId: null, tabId: null,
    kind: 'note', order, colour, createdAt: serverTimestamp(),
  });

/** Either of you can edit a note. */
export const editNote = (roomId: string, pinId: string, by: string, text: string, colour: string) =>
  updateDoc(doc(pinsCol(roomId), pinId), { detail: text.trim().slice(0, NOTE_MAX), colour, editedBy: by, editedAt: serverTimestamp() });

export const movePin = (roomId: string, pinId: string, order: number) => updateDoc(doc(pinsCol(roomId), pinId), { order });

export const removePin = (roomId: string, pinId: string) => deleteDoc(doc(pinsCol(roomId), pinId));

// ---------------------------------------------------------------------------- pinned to the top of the chat

export type TopPinResult = 'pinned' | 'already' | 'full';

/** Pin a message to the top of the chat (max 3). Returns 'full' when there's no room. */
export function pinToTop(roomId: string, p: Omit<TopPin, 'at' | 'by'>, by: string): Promise<TopPinResult> {
  const ref = doc(db, 'rooms', roomId);
  return runTransaction(db, async (tx) => {
    const cur: TopPin[] = ((await tx.get(ref)).data()?.pinned || []).slice(0, TOP_PINS_MAX);
    if (cur.some((x) => x.msgId === p.msgId)) return 'already';
    if (cur.length >= TOP_PINS_MAX) return 'full';
    tx.update(ref, { pinned: [...cur, { ...p, text: p.text.slice(0, 160), by, at: new Date() }] });
    return 'pinned';
  });
}

export function unpinFromTop(roomId: string, msgId: string) {
  const ref = doc(db, 'rooms', roomId);
  return runTransaction(db, async (tx) => {
    const cur: TopPin[] = (await tx.get(ref)).data()?.pinned || [];
    tx.update(ref, { pinned: cur.filter((x) => x.msgId !== msgId) });
  });
}

/** Take a top pin down and keep it in the scrapbook instead. */
export async function moveTopPinToScrapbook(roomId: string, me: string, p: TopPin, title: string, order: number) {
  await addPin(roomId, me, { title, detail: p.text, messageId: p.msgId, tabId: p.tabId, kind: 'message', senderId: p.uid, order });
  await unpinFromTop(roomId, p.msgId);
}

// ---------------------------------------------------------------------------- countdowns

export interface CountdownDrop { dropId: string; title: string; atMs: number }

/** Every Countdown Drop in the chat (the banner shows the live ones). */
export function watchCountdowns(roomId: string, cb: (c: CountdownDrop[]) => void, onError?: (e: Error) => void) {
  return onSnapshot(query(collection(db, 'rooms', roomId, 'drops'), where('type', '==', 'countdown')), (s) => {
    cb(s.docs.map((d) => {
      const c = (d.data().content || {}) as { title?: string; date?: string; atMs?: number };
      const at = typeof c.atMs === 'number' && c.atMs > 0 ? c.atMs : parseDay(c.date || '');
      return { dropId: d.id, title: String(c.title || 'Countdown').slice(0, 80), atMs: at };
    }));
  }, onError);
}
