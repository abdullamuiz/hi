import {
  collection, deleteField, doc, FieldPath, arrayRemove, arrayUnion, increment, limitToLast, onSnapshot, orderBy, query,
  serverTimestamp, updateDoc, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Message, ReactionCode } from '../types';

/** One reply in a thread (side discussion under a message). */
export interface Reply {
  id: string;
  uid: string;
  text: string;
  createdAt?: { toMillis(): number } | null;
  deleted?: boolean;
  reactions?: Partial<Record<ReactionCode, string[]>>;
  pending?: boolean;
}

const rootRef = (roomId: string, tabId: string, rootId: string) => doc(db, 'rooms', roomId, 'tabs', tabId, 'messages', rootId);
const repliesCol = (roomId: string, tabId: string, rootId: string) => collection(rootRef(roomId, tabId, rootId), 'replies');

export function watchReplies(roomId: string, tabId: string, rootId: string, cb: (r: Reply[]) => void) {
  return onSnapshot(query(repliesCol(roomId, tabId, rootId), orderBy('createdAt'), limitToLast(500)), { includeMetadataChanges: true }, (s) => {
    cb(s.docs.map((d) => ({ id: d.id, ...(d.data({ serverTimestamps: 'estimate' }) as any), pending: d.metadata.hasPendingWrites })));
  }, () => cb([]));
}

/** Adds a reply and bumps the root's thread summary in one write (rules require both). */
export async function sendReply(roomId: string, root: Message, uid: string, raw: string) {
  const text = raw.trim().slice(0, 4000);
  if (!text) return;
  const tabId = root.tabId;
  const ref = doc(repliesCol(roomId, tabId, root.id));
  const b = writeBatch(db);
  const expiresAt = (root as any).expiresAt ?? null;
  b.set(ref, { uid, text, createdAt: serverTimestamp(), ...(expiresAt ? { expiresAt } : {}) });
  // Field paths + increment: the count is bumped on the server's value, so two replies
  // sent at the same moment both land (a count read from this phone could be stale).
  b.update(rootRef(roomId, tabId, root.id),
    new FieldPath('thread', 'count'), increment(1),
    new FieldPath('thread', 'lastAt'), serverTimestamp(),
    new FieldPath('thread', 'lastBy'), uid,
    new FieldPath('thread', 'lastId'), ref.id);
  // For the chat list's 💬 dot (no listener per thread needed).
  b.update(doc(db, 'rooms', roomId), { lastThreadReplyAt: serverTimestamp(), lastThreadReplyBy: uid });
  await b.commit();
}

export const reactToReply = (roomId: string, tabId: string, rootId: string, r: Reply, uid: string, code: ReactionCode, on: boolean) =>
  updateDoc(doc(repliesCol(roomId, tabId, rootId), r.id), new FieldPath('reactions', code), on ? arrayUnion(uid) : arrayRemove(uid));

export const deleteReply = (roomId: string, tabId: string, rootId: string, r: Reply) =>
  // Rules: a deleted reply keeps no reactions.
  updateDoc(doc(repliesCol(roomId, tabId, rootId), r.id), { deleted: true, text: '', reactions: deleteField() });

// ---------------------------------------------------------------------------- unread (per device)

const SEEN = 'hi.threads.seen';

function readSeen(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SEEN) || '{}'); } catch { return {}; }
}

/** When I last looked at a thread on this phone. */
export const threadSeen = (rootId: string) => readSeen()[rootId] || 0;

export function markThreadSeen(rootId: string, at = Date.now()) {
  const all = readSeen();
  all[rootId] = at;
  // Keep the newest 300 threads.
  const keep = Object.entries(all).sort((a, b) => b[1] - a[1]).slice(0, 300);
  try { localStorage.setItem(SEEN, JSON.stringify(Object.fromEntries(keep))); } catch { /* ignore */ }
}

/** The other person replied since I last opened the thread. */
export function threadUnread(m: Pick<Message, 'id' | 'thread'>, me: string, seen = threadSeen(m.id)): boolean {
  const t = m.thread;
  if (!t || !t.count || t.lastBy === me) return false;
  const at = t.lastAt && typeof (t.lastAt as any).toMillis === 'function' ? (t.lastAt as any).toMillis() : 0;
  return at > seen;
}
