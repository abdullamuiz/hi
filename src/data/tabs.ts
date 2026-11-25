import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc,
  Timestamp, updateDoc, where,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Tab } from '../types';
import { tabTtl, validTtl } from '../lib/disappear';

export const GENERAL = 'general';

/** Tab dot colours: all keep ≥3:1 contrast against white for the dot and badge. */
export const TAB_COLOURS = ['#252C48', '#2F5BEA', '#1E7F93', '#2F6B4F', '#E0A23E', '#F2A15F', '#B83F72', '#7A5AF8'];

const tabsCol = (roomId: string) => collection(db, 'rooms', roomId, 'tabs');

function toTab(id: string, d: any): Tab {
  return {
    id,
    name: d.name || 'Tab',
    colour: d.colour || TAB_COLOURS[0],
    wallpaper: d.wallpaper ?? null,
    mode: d.mode === 'work' ? 'work' : 'casual',
    disappearing: !!d.disappearing,
    ttlHours: validTtl(d.ttlHours),
    archived: !!d.archived,
    order: typeof d.order === 'number' ? d.order : 0,
    createdBy: d.createdBy || '',
    createdAt: d.createdAt ?? null,
    lastMessageAt: d.lastMessageAt ?? null,
  };
}

// Disappearing setting of every tab we're watching, so a new message gets its expiry.
const ttlCache = new Map<string, number>();
/** Hours a new message in this tab lives for (0 = kept). Known once the tab list has loaded. */
export const ttlOf = (roomId: string, tabId: string) => ttlCache.get(`${roomId}/${tabId}`) || 0;

export function watchTabs(roomId: string, cb: (tabs: Tab[], fromServer: boolean) => void, onError?: (e: Error) => void) {
  return onSnapshot(
    query(tabsCol(roomId), orderBy('order')),
    { includeMetadataChanges: true },
    (s) => {
      const tabs = s.docs.map((d) => toTab(d.id, d.data({ serverTimestamps: 'estimate' })));
      tabs.forEach((t) => ttlCache.set(`${roomId}/${t.id}`, tabTtl(t)));
      cb(tabs, !s.metadata.fromCache);
    },
    onError,
  );
}

/** One-off read of a room's tabs (search, export). */
export async function loadTabs(roomId: string): Promise<Tab[]> {
  const s = await getDocs(query(tabsCol(roomId), orderBy('order')));
  return s.docs.map((d) => toTab(d.id, d.data({ serverTimestamps: 'estimate' })));
}

function newTabDoc(uid: string, name: string, colour: string, order: number) {
  return {
    name: name.trim().slice(0, 30), colour, wallpaper: null, mode: 'casual', disappearing: false,
    archived: false, order, createdBy: uid, createdAt: serverTimestamp(), lastMessageAt: null,
  };
}

export const generalTabDoc = (uid: string) => newTabDoc(uid, 'General', TAB_COLOURS[0], 0);

/** Repairs a room that has no General tab (rooms created before tabs existed). */
export async function ensureGeneralTab(roomId: string, uid: string) {
  const ref = doc(db, 'rooms', roomId, 'tabs', GENERAL);
  const snap = await getDoc(ref).catch(() => null);
  if (snap && !snap.exists()) await setDoc(ref, generalTabDoc(uid)).catch(() => {});
}

export async function createTab(roomId: string, uid: string, name: string, colour: string, order: number) {
  const ref = doc(tabsCol(roomId));
  await setDoc(ref, newTabDoc(uid, name, colour, order));
  return ref.id;
}

export function updateTab(roomId: string, tabId: string, patch: Partial<Pick<Tab, 'name' | 'colour' | 'archived' | 'order'>>) {
  const p: Record<string, unknown> = { ...patch };
  if (typeof p.name === 'string') p.name = (p.name as string).trim().slice(0, 30);
  return updateDoc(doc(db, 'rooms', roomId, 'tabs', tabId), p);
}

/**
 * Live count of the other person's messages in a tab since `since` (capped at 99).
 * Only used for tabs you're not looking at.
 */
export function watchUnread(roomId: string, tabId: string, since: Timestamp | null, me: string, cb: (n: number) => void) {
  const q = query(
    collection(db, 'rooms', roomId, 'tabs', tabId, 'messages'),
    where('createdAt', '>', since ?? Timestamp.fromMillis(0)),
    orderBy('createdAt'),
    limit(99),
  );
  return onSnapshot(q, (s) => cb(s.docs.filter((d) => d.data().uid !== me).length), () => cb(0));
}

