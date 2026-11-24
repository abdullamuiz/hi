import {
  collection, deleteDoc, doc, getDocs, onSnapshot, query, runTransaction, serverTimestamp, setDoc, Timestamp,
  updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { useEffect, useState } from 'preact/hooks';
import { db } from '../firebase';
import { normaliseQuiet, type QuietHours } from '../lib/schedule';
import { snippetOf } from '../lib/messages';
import { expiryFor, tabTtl } from '../lib/disappear';
import type { ReplyRef, Scheduled } from '../types';

// ---------------------------------------------------------------- my settings (users/{me})

export interface DeliveryPrefs {
  /** Share "read up to" times with the people I chat with (and see theirs). */
  readReceipts: boolean;
  quiet: QuietHours;
  /** Urgent messages sent today (counted by the server). */
  urgent: { day?: string; count?: number } | null;
}

const DEFAULT_PREFS: DeliveryPrefs = { readReceipts: true, quiet: normaliseQuiet(null), urgent: null };

function toPrefs(d: any): DeliveryPrefs {
  return {
    readReceipts: d?.readReceipts !== false,
    quiet: normaliseQuiet(d?.quiet),
    urgent: d?.urgent && typeof d.urgent === 'object' ? { day: String(d.urgent.day || ''), count: Number(d.urgent.count || 0) } : null,
  };
}

// One shared listener for my own settings doc.
let prefsUid = '';
let prefsValue: DeliveryPrefs = DEFAULT_PREFS;
let prefsStop: (() => void) | null = null;
const prefsSubs = new Set<(p: DeliveryPrefs) => void>();

function watchPrefs(uid: string, cb: (p: DeliveryPrefs) => void) {
  if (prefsUid !== uid) {
    prefsStop?.();
    prefsUid = uid;
    prefsValue = DEFAULT_PREFS;
    prefsStop = onSnapshot(doc(db, 'users', uid), (s) => {
      prefsValue = toPrefs(s.data());
      prefsSubs.forEach((f) => f(prefsValue));
    }, () => {});
  }
  prefsSubs.add(cb);
  cb(prefsValue);
  return () => { prefsSubs.delete(cb); };
}

export function useDeliveryPrefs(uid: string | undefined): DeliveryPrefs {
  const [p, setP] = useState<DeliveryPrefs>(prefsUid === uid ? prefsValue : DEFAULT_PREFS);
  useEffect(() => (uid ? watchPrefs(uid, setP) : undefined), [uid]);
  return p;
}

/** Read receipts on/off. Off also wipes the "read up to" times the other people can see. */
export async function setReadReceipts(uid: string, on: boolean) {
  await setDoc(doc(db, 'users', uid), { readReceipts: on }, { merge: true });
  if (on) return;
  const rooms = await getDocs(query(collection(db, 'rooms'), where('members', 'array-contains', uid)));
  await Promise.all(rooms.docs.map((r) => updateDoc(doc(db, 'rooms', r.id, 'members', uid), { lastRead: {} }).catch(() => {})));
}

export const setQuietHours = (uid: string, q: QuietHours) => setDoc(doc(db, 'users', uid), { quiet: q }, { merge: true });

// ---------------------------------------------------------------- read up to (private copy)

type Reads = Record<string, Record<string, number>>;
let readsUid = '';
let readsValue: Reads = {};
let readsStop: (() => void) | null = null;
const readsSubs = new Set<(r: Reads) => void>();

/** users/{me}/reads/{roomId}: my own "read up to" per tab, kept even with read receipts off. */
function watchReads(uid: string, cb: (r: Reads) => void) {
  if (readsUid !== uid) {
    readsStop?.();
    readsUid = uid;
    readsValue = {};
    readsStop = onSnapshot(collection(db, 'users', uid, 'reads'), (s) => {
      const out: Reads = {};
      s.docs.forEach((d) => {
        const lr = d.data({ serverTimestamps: 'estimate' }).lastRead || {};
        out[d.id] = {};
        Object.entries(lr).forEach(([tab, t]: [string, any]) => { if (t && typeof t.toMillis === 'function') out[d.id][tab] = t.toMillis(); });
      });
      readsValue = out;
      readsSubs.forEach((f) => f(readsValue));
    }, () => {});
  }
  readsSubs.add(cb);
  cb(readsValue);
  return () => { readsSubs.delete(cb); };
}

export function useMyReads(uid: string | undefined): Reads {
  const [r, setR] = useState<Reads>(readsUid === uid ? readsValue : {});
  useEffect(() => (uid ? watchReads(uid, setR) : undefined), [uid]);
  return r;
}

/** Latest of my private copy and the shared one (older rooms only have the shared one). */
export function readUpTo(reads: Reads, roomId: string, tabId: string, shared?: { toMillis(): number } | null): number {
  return Math.max(reads[roomId]?.[tabId] || 0, shared ? shared.toMillis() : 0);
}

/** Mark a tab read: always privately; shared with the other person only when receipts are on. */
export function markRead(roomId: string, uid: string, tabId: string, share: boolean) {
  const b = writeBatch(db);
  b.set(doc(db, 'users', uid, 'reads', roomId), { lastRead: { [tabId]: serverTimestamp() } }, { merge: true });
  if (share) b.set(doc(db, 'rooms', roomId, 'members', uid), { uid, lastRead: { [tabId]: serverTimestamp() } }, { merge: true });
  return b.commit();
}

// ---------------------------------------------------------------- scheduled messages

const schedCol = (roomId: string) => collection(db, 'rooms', roomId, 'scheduled');

/** My scheduled messages in a room (nobody else can see them). */
export function watchScheduled(roomId: string, uid: string, cb: (s: Scheduled[]) => void, onError?: (e: Error) => void) {
  return onSnapshot(query(schedCol(roomId), where('senderId', '==', uid)), (s) => {
    cb(s.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id, roomId, senderId: x.senderId, tabId: x.tabId, text: x.text,
        replyTo: x.replyTo || null, sendAt: x.sendAt?.toMillis?.() ?? 0,
      } as Scheduled;
    }).sort((a, b) => a.sendAt - b.sendAt));
  }, (e) => onError?.(e));
}

export async function scheduleMessage(roomId: string, tabId: string, uid: string, raw: string, sendAt: number, replyTo?: ReplyRef | null) {
  const text = raw.trim().slice(0, 4000);
  if (!text) return;
  const reply = replyTo ? { replyTo: { msgId: replyTo.msgId, snippet: replyTo.snippet.slice(0, 160), senderId: replyTo.senderId } } : {};
  await setDoc(doc(schedCol(roomId)), {
    senderId: uid, tabId, text, ...reply, sendAt: Timestamp.fromMillis(sendAt), createdAt: serverTimestamp(),
  });
}

export const updateScheduled = (s: Scheduled, text: string, sendAt: number) =>
  updateDoc(doc(schedCol(s.roomId), s.id), { text: text.trim().slice(0, 4000), sendAt: Timestamp.fromMillis(sendAt) });

export const cancelScheduled = (s: Scheduled) => deleteDoc(doc(schedCol(s.roomId), s.id));

/**
 * Sends a scheduled message now. The message takes the scheduled id, and the scheduled
 * doc is removed in the same transaction, so this and the server's minute job can never
 * both deliver it. Returns false when it was already sent (or cancelled).
 */
export async function deliverScheduled(s: Scheduled): Promise<boolean> {
  const sref = doc(schedCol(s.roomId), s.id);
  const mref = doc(db, 'rooms', s.roomId, 'tabs', s.tabId, 'messages', s.id);
  return runTransaction(db, async (tx) => {
    const cur = await tx.get(sref);
    if (!cur.exists()) return false;
    const tab = await tx.get(doc(db, 'rooms', s.roomId, 'tabs', s.tabId));
    const x = cur.data();
    const text = String(x.text || '');
    // A disappearing tab: the message expires like any other sent there.
    const exp = expiryFor(tabTtl(tab.data() as any));
    tx.delete(sref);
    tx.set(mref, {
      uid: s.senderId, kind: 'text', text, scheduled: true,
      ...(x.replyTo ? { replyTo: x.replyTo } : {}),
      ...(exp ? { expiresAt: Timestamp.fromMillis(exp) } : {}),
      createdAt: serverTimestamp(),
    });
    tx.update(doc(db, 'rooms', s.roomId, 'tabs', s.tabId), { lastMessageAt: serverTimestamp() });
    tx.update(doc(db, 'rooms', s.roomId), {
      lastMessage: { id: s.id, uid: s.senderId, tabId: s.tabId, text: snippetOf({ kind: 'text', text } as any).slice(0, 160), at: serverTimestamp() },
    });
    return true;
  });
}
