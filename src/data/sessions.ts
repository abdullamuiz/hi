import {
  collection, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, setDoc, where, writeBatch,
  type Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { createDrop } from './messages';
import type { Answers, SessionTest } from '../sessions/types';

/** rooms/{r}/sessions/{id}: which test, started by whom. The id is also its Drop's id. */
export interface SessionDoc {
  id: string;
  testId: string;
  version: number;
  tabId: string;
  createdBy: string;
  createdAt: Timestamp | null;
}

/** rooms/{r}/sessions/{id}/users/{uid}: public progress and presence. */
export interface SessionProgress {
  answered: number;
  total: number;
  done: boolean;
  seenAt: Timestamp | null;
  /** Result code (e.g. "ENFP"), written once both have finished. */
  code?: string;
  /** Local write not yet on the server. */
  pending?: boolean;
}

/** rooms/{r}/sessions/{id}/private/{uid}: raw answers, private until both finish. */
export interface SessionPrivate {
  uid: string;
  answers: Answers;
  done: boolean;
}

const sesRef = (roomId: string, id: string) => doc(db, 'rooms', roomId, 'sessions', id);
const privRef = (roomId: string, id: string, uid: string) => doc(db, 'rooms', roomId, 'sessions', id, 'private', uid);
const progRef = (roomId: string, id: string, uid: string) => doc(db, 'rooms', roomId, 'sessions', id, 'users', uid);

export { isHere } from '../sessions/logic';

/**
 * Starts a session: its Drop card, its session doc and the chat message, in one batch
 * (the rules require the session and its Drop to be created together).
 */
export async function startSession(roomId: string, tabId: string, uid: string, test: SessionTest): Promise<string> {
  const id = doc(collection(db, 'rooms', roomId, 'drops')).id;
  await createDrop(roomId, tabId, uid, 'session', { testId: test.id, sessionId: id }, [], `a ${test.title}`, {
    id,
    extra(b) {
      b.set(sesRef(roomId, id), { testId: test.id, version: test.version, tabId, createdBy: uid, createdAt: serverTimestamp() });
    },
  });
  return id;
}

export function watchSession(roomId: string, id: string, cb: (s: SessionDoc | null) => void) {
  return onSnapshot(sesRef(roomId, id), (s) => cb(s.exists() ? ({ id: s.id, ...(s.data({ serverTimestamps: 'estimate' }) as any) }) : null));
}

/** Both people's progress, keyed by uid. */
export function watchProgress(roomId: string, id: string, cb: (p: Record<string, SessionProgress>) => void) {
  return onSnapshot(collection(db, 'rooms', roomId, 'sessions', id, 'users'), { includeMetadataChanges: true }, (s) => {
    const out: Record<string, SessionProgress> = {};
    s.docs.forEach((d) => { out[d.id] = { ...(d.data({ serverTimestamps: 'estimate' }) as any), pending: d.metadata.hasPendingWrites }; });
    cb(out);
  });
}

export async function loadMyAnswers(roomId: string, id: string, uid: string): Promise<SessionPrivate | null> {
  const s = await getDoc(privRef(roomId, id, uid));
  return s.exists() ? (s.data() as SessionPrivate) : null;
}

/**
 * The partner's answers. Only readable once both have finished; retries a few times
 * because our own "finished" write may still be on its way to the server.
 */
export async function loadTheirAnswers(roomId: string, id: string, them: string, attempts = 5): Promise<SessionPrivate> {
  for (let i = 0; ; i++) {
    try {
      const s = await getDoc(privRef(roomId, id, them));
      if (s.exists()) return s.data() as SessionPrivate;
      throw new Error('Their answers are not there yet.');
    } catch (e) {
      if (i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
}

/** Save my answers so far (still editable) and my public progress. */
export async function saveAnswers(roomId: string, id: string, uid: string, answers: Answers, answered: number, total: number) {
  const b = writeBatch(db);
  b.set(privRef(roomId, id, uid), { uid, answers, done: false, updatedAt: serverTimestamp() });
  b.set(progRef(roomId, id, uid), { answered, total, done: false, seenAt: serverTimestamp() });
  await b.commit();
}

/** Freeze my answers. Irreversible: after this the rules refuse any change. */
export async function finishSession(roomId: string, id: string, uid: string, answers: Answers, total: number) {
  const b = writeBatch(db);
  b.set(privRef(roomId, id, uid), { uid, answers, done: true, updatedAt: serverTimestamp() });
  b.set(progRef(roomId, id, uid), { answered: total, total, done: true, seenAt: serverTimestamp() });
  await b.commit();
}

/** "I'm here" heartbeat; keeps my progress as it is. */
export function touchPresence(roomId: string, id: string, uid: string, p: Pick<SessionProgress, 'answered' | 'total' | 'done' | 'code'>) {
  return setDoc(progRef(roomId, id, uid), {
    answered: p.answered, total: p.total, done: p.done, seenAt: serverTimestamp(), ...(p.done && p.code ? { code: p.code } : {}),
  });
}

/** Earlier finished runs of the same test in this room (my result codes), newest first. */
export async function myHistory(roomId: string, testId: string, uid: string, exceptId: string): Promise<Array<{ id: string; code: string; at: number }>> {
  const s = await getDocs(query(collection(db, 'rooms', roomId, 'sessions'), where('testId', '==', testId)));
  const rows = await Promise.all(s.docs.filter((d) => d.id !== exceptId).map(async (d) => {
    const p = await getDoc(progRef(roomId, d.id, uid));
    const code = p.exists() ? (p.data().code as string | undefined) : undefined;
    const at = (d.data().createdAt as Timestamp | null)?.toMillis() ?? 0;
    return code ? { id: d.id, code, at } : null;
  }));
  return rows.filter((r): r is { id: string; code: string; at: number } => !!r).sort((a, b) => b.at - a.at);
}
