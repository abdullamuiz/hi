import {
  arrayUnion, collection, deleteField, doc, documentId, getCountFromServer, getDoc, getDocs, limit, onSnapshot,
  orderBy, query, serverTimestamp, Timestamp, updateDoc, where, writeBatch, type Transaction, type WriteBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { dayKeyIn, dayWindow, sameDayAgo, type DayMap } from '../lib/streak';
import { computeRewind, type RewindMessage, type RewindPeriod, type RewindStats } from '../lib/rewind';
import { expiryFor } from '../lib/disappear';
import { snippetOf } from '../lib/messages';
import { loadHistory } from './history';
import { GENERAL, ttlOf } from './tabs';
import type { Message, RoomStreak, Tab } from '../types';

// ---------------------------------------------------------------------------- activity days

/** Each room's time zone, so a message is filed under the right day without passing it around. */
const zones = new Map<string, string>();
export const setRoomZone = (roomId: string, tz: string) => { zones.set(roomId, tz); };
export const zoneOf = (roomId: string) => zones.get(roomId);

/** Days this phone has already marked, so it writes at most once a day per chat. */
const marked = new Set<string>();

function activity(roomId: string, uid: string) {
  const day = dayKeyIn(Date.now(), zoneOf(roomId));
  const key = `${roomId}/${day}/${uid}`;
  if (marked.has(key)) return null;
  marked.add(key);
  return { ref: doc(db, 'rooms', roomId, 'days', day), data: { uids: arrayUnion(uid) } };
}

/**
 * Notes that I sent something today (rooms/{id}/days/{YYYY-MM-DD}), in the same batch as
 * the message. That's what streaks and Rewind count. Once a day per chat per phone.
 */
export function markActivity(b: WriteBatch, roomId: string, uid: string) {
  const a = activity(roomId, uid);
  if (a) b.set(a.ref, a.data, { merge: true });
}
export function markActivityTx(tx: Transaction, roomId: string, uid: string) {
  const a = activity(roomId, uid);
  if (a) tx.set(a.ref, a.data, { merge: true });
}

/** Activity days from `sinceKey` on (live). */
export function watchDays(roomId: string, sinceKey: string, cb: (d: DayMap) => void, onError?: (e: Error) => void) {
  const q = query(collection(db, 'rooms', roomId, 'days'), where(documentId(), '>=', sinceKey), orderBy(documentId()), limit(1200));
  return onSnapshot(q, (s) => {
    const out: DayMap = {};
    s.docs.forEach((d) => { const u = d.data().uids; out[d.id] = Array.isArray(u) ? u : []; });
    cb(out);
  }, onError);
}

// ---------------------------------------------------------------------------- streak on/off

const roomRef = (roomId: string) => doc(db, 'rooms', roomId);

export function proposeStreak(roomId: string, uid: string) {
  return updateDoc(roomRef(roomId), { streak: { state: 'proposed', by: uid, at: serverTimestamp() } });
}

export function acceptStreak(roomId: string, s: RoomStreak) {
  return updateDoc(roomRef(roomId), { streak: { state: 'on', by: s.by, at: s.at, since: serverTimestamp() } });
}

/** Decline, withdraw or turn off. */
export function stopStreak(roomId: string) {
  return updateDoc(roomRef(roomId), { streak: deleteField() });
}

/** Keeps the chat list's 🔥 number in step with what this phone worked out. */
export function cacheStreak(roomId: string, s: RoomStreak, count: number, best: number, day: string) {
  if (s.state !== 'on' || (s.count === count && s.best === best && s.day === day)) return Promise.resolve();
  return updateDoc(roomRef(roomId), { streak: { state: 'on', by: s.by, at: s.at, since: s.since ?? null, count, best, day } });
}

// ---------------------------------------------------------------------------- counts

const countCache = new Map<string, { at: number; n: number }>();

/** Messages in the chat so far (all tabs). Cheap count queries; reused for 10 minutes. */
export async function countMessages(roomId: string, tabs: Tab[]): Promise<number> {
  const hit = countCache.get(roomId);
  if (hit && Date.now() - hit.at < 600_000) return hit.n;
  const counts = await Promise.all(tabs.map((t) => getCountFromServer(collection(db, 'rooms', roomId, 'tabs', t.id, 'messages')).then((s) => s.data().count)));
  const n = counts.reduce((a, b) => a + b, 0);
  countCache.set(roomId, { at: Date.now(), n });
  return n;
}

// ---------------------------------------------------------------------------- On This Day

export interface Memory {
  message: Message;
  /** How long ago, e.g. 1 (year) or 2 (months, with the test switch). */
  ago: number;
  unit: 'year' | 'month';
  dayKey: string;
}

const SHOWABLE = new Set(['text', 'link', 'photo', 'voice', 'drop']);

/**
 * Something from this day 1, 2, 3… years ago (nearest first). With the device switch
 * `hi.otd.unit = month` it looks months back instead, so it can be tried out without
 * waiting a year.
 */
export async function findOnThisDay(roomId: string, tabs: Tab[], me: string, tz: string, now = Date.now()): Promise<Memory | null> {
  let unit: 'year' | 'month' = 'year';
  try { if (localStorage.getItem('hi.otd.unit') === 'month') unit = 'month'; } catch { /* ignore */ }
  const today = dayKeyIn(now, tz);
  for (let ago = 1; ago <= 5; ago++) {
    const key = sameDayAgo(today, ago, unit);
    const [from, to] = dayWindow(key, tz);
    for (const t of tabs) {
      const s = await getDocs(query(
        collection(db, 'rooms', roomId, 'tabs', t.id, 'messages'),
        where('createdAt', '>=', Timestamp.fromMillis(from)), where('createdAt', '<', Timestamp.fromMillis(to)),
        orderBy('createdAt'), limit(20),
      ));
      const found = s.docs
        .map((d) => ({ id: d.id, tabId: t.id, text: '', ...(d.data() as any) }) as Message)
        .find((m) => SHOWABLE.has(m.kind) && !m.deleted && !m.expiresAt && !m.hiddenFor?.includes(me));
      if (found) return { message: found, ago, unit, dayKey: key };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------- Rewind

export interface RewindData {
  stats: RewindStats;
  names: Record<string, string>;
  tabNames: Record<string, string>;
  truncated: boolean;
}

export async function loadRewind(roomId: string, period: RewindPeriod, me: string, them: string, tz: string): Promise<RewindData> {
  const [h, drops] = await Promise.all([
    loadHistory(roomId),
    getDocs(query(collection(db, 'rooms', roomId, 'drops'),
      where('createdAt', '>=', Timestamp.fromMillis(period.from)), where('createdAt', '<', Timestamp.fromMillis(period.to)), limit(500))),
  ]);
  const dropTypes: Record<string, string> = {};
  drops.docs.forEach((d) => { dropTypes[d.id] = String(d.data().type || ''); });
  const msgs: RewindMessage[] = h.messages.map((m) => ({
    id: m.id, tabId: m.tabId, uid: m.uid, kind: m.kind, text: m.deleted ? '' : m.text || '',
    ms: m.createdAt ? m.createdAt.toMillis() : 0,
    photoPath: m.photo?.path ?? null, dropId: m.dropId,
    deleted: !!m.deleted, hidden: !!m.hiddenFor?.includes(me),
  }));
  const tabNames: Record<string, string> = {};
  h.tabs.forEach((t) => { tabNames[t.id] = t.name; });
  // Only part of the period may have been read (history is capped).
  const oldest = h.messages.length ? h.messages[h.messages.length - 1].createdAt?.toMillis() ?? 0 : 0;
  return {
    stats: computeRewind(msgs, period, me, them, dropTypes, tz),
    names: h.names, tabNames,
    truncated: h.truncated && oldest > period.from,
  };
}

/** Doc id of the monthly Rewind (for the month it covers), shared by the Drop and its message. */
export const rewindId = (month: string) => `rewind-${month}`;

/**
 * In the first week of a month, drops last month's Rewind into General once — if the
 * chat was busy enough last month to make it worth watching. Either phone may do it.
 */
export async function ensureMonthlyRewind(roomId: string, uid: string, tabs: Tab[], period: RewindPeriod, month: string): Promise<boolean> {
  const id = rewindId(month);
  const dropRef = doc(db, 'rooms', roomId, 'drops', id);
  if ((await getDoc(dropRef)).exists()) return false;
  const counts = await Promise.all(tabs.map((t) => getCountFromServer(query(
    collection(db, 'rooms', roomId, 'tabs', t.id, 'messages'),
    where('createdAt', '>=', Timestamp.fromMillis(period.from)), where('createdAt', '<', Timestamp.fromMillis(period.to)),
  )).then((s) => s.data().count)));
  if (counts.reduce((a, b) => a + b, 0) < 10) return false;
  const b = writeBatch(db);
  b.set(dropRef, { type: 'rewind', createdBy: uid, createdAt: serverTimestamp(), content: { from: period.from, to: period.to, label: period.label, auto: true } });
  const exp = expiryFor(ttlOf(roomId, GENERAL));
  b.set(doc(db, 'rooms', roomId, 'tabs', GENERAL, 'messages', id), {
    uid, kind: 'drop', text: '', dropId: id, createdAt: serverTimestamp(), ...(exp ? { expiresAt: Timestamp.fromMillis(exp) } : {}),
  });
  b.update(doc(db, 'rooms', roomId, 'tabs', GENERAL), { lastMessageAt: serverTimestamp() });
  b.update(roomRef(roomId), {
    lastMessage: { id, uid, tabId: GENERAL, text: snippetOf({ kind: 'drop', text: '' }, `${period.label} Rewind`), at: serverTimestamp() },
  });
  try { await b.commit(); return true; } catch { return false; }
}
