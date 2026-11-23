import {
  collection, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp, setDoc, where, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { DropDoc, Entry, Sealed } from '../types';

/** Everything one viewer is allowed to know about one Drop, kept live. */
export interface DropState {
  drop: DropDoc | null;
  /** "{uid}_{key}" for every lock marker. */
  locks: Set<string>;
  entries: Entry[];
  /** Public per-user progress docs, by uid. */
  progress: Record<string, Record<string, unknown>>;
  /** My own sealed answers, by key. */
  mine: Record<string, Sealed>;
  /** The partner's sealed answers, by key — only keys both of us have locked. */
  theirs: Record<string, Sealed>;
}

export const emptyDropState = (): DropState => ({
  drop: null, locks: new Set(), entries: [], progress: {}, mine: {}, theirs: {},
});

const dropRef = (roomId: string, dropId: string) => doc(db, 'rooms', roomId, 'drops', dropId);

/**
 * Subscribes to a Drop. The partner's sealed answers are fetched only once both
 * lock markers exist — before that the security rules would refuse the read.
 */
export function watchDrop(
  roomId: string, dropId: string, me: string, partner: string | null, cb: (s: DropState) => void,
): () => void {
  let state = emptyDropState();
  const fetching = new Set<string>();
  const emit = () => cb({ ...state });
  const base = dropRef(roomId, dropId);

  let locksPending = false;
  let stopped = false;
  const tryReveal = (key: string, attempt: number) => {
    fetching.add(key);
    getDoc(doc(base, 'sealed', `${partner}_${key}`))
      .then((s) => {
        fetching.delete(key);
        if (s.exists() && !stopped) {
          state = { ...state, theirs: { ...state.theirs, [key]: s.data() as Sealed } };
          emit();
        }
      })
      .catch((e) => {
        // Usually a race with our own lock reaching the server. Retry a few times.
        if (attempt < 4 && !stopped) setTimeout(() => tryReveal(key, attempt + 1), 400 * 2 ** attempt);
        else { fetching.delete(key); console.warn('reveal failed', key, e); }
      });
  };

  const maybeReveal = () => {
    // Our own lock must be committed server-side before the rules allow the read.
    if (!partner || locksPending) return;
    state.locks.forEach((id) => {
      if (!id.startsWith(partner + '_')) return;
      const key = id.slice(partner.length + 1);
      if (!state.locks.has(`${me}_${key}`) || state.theirs[key] || fetching.has(key)) return;
      tryReveal(key, 0);
    });
  };

  const unsubs = [
    onSnapshot(base, (s) => {
      state = { ...state, drop: s.exists() ? ({ id: s.id, ...(s.data({ serverTimestamps: 'estimate' }) as any) }) : null };
      emit();
    }),
    onSnapshot(collection(base, 'locks'), { includeMetadataChanges: true }, (s) => {
      locksPending = s.metadata.hasPendingWrites;
      state = { ...state, locks: new Set(s.docs.map((d) => d.id)) };
      emit();
      maybeReveal();
    }),
    onSnapshot(query(collection(base, 'entries'), orderBy('createdAt')), (s) => {
      state = { ...state, entries: s.docs.map((d) => ({ id: d.id, ...(d.data({ serverTimestamps: 'estimate' }) as any) })) };
      emit();
    }),
    onSnapshot(collection(base, 'users'), (s) => {
      const progress: DropState['progress'] = {};
      s.docs.forEach((d) => { progress[d.id] = d.data(); });
      state = { ...state, progress };
      emit();
    }),
    onSnapshot(query(collection(base, 'sealed'), where('uid', '==', me)), (s) => {
      const mine: DropState['mine'] = {};
      s.docs.forEach((d) => { const x = d.data() as Sealed; mine[x.key] = x; });
      state = { ...state, mine };
      emit();
    }),
  ];
  return () => { stopped = true; unsubs.forEach((u) => u()); };
}

/** Save a private, still-editable answer. */
export function saveDraft(roomId: string, dropId: string, uid: string, key: string, value: unknown) {
  return setDoc(doc(dropRef(roomId, dropId), 'sealed', `${uid}_${key}`), {
    uid, key, value, locked: false, updatedAt: serverTimestamp(),
  });
}

/** Freeze an answer and publish the "locked" marker in one atomic write. */
export function lockAnswer(roomId: string, dropId: string, uid: string, key: string, value: unknown) {
  const base = dropRef(roomId, dropId);
  const b = writeBatch(db);
  b.set(doc(base, 'sealed', `${uid}_${key}`), { uid, key, value, locked: true, updatedAt: serverTimestamp() });
  b.set(doc(base, 'locks', `${uid}_${key}`), { uid, key, at: serverTimestamp() });
  return b.commit();
}

export function addEntry(roomId: string, dropId: string, uid: string, text: string) {
  return setDoc(doc(collection(dropRef(roomId, dropId), 'entries')), {
    uid, text: text.trim().slice(0, 280), createdAt: serverTimestamp(),
  });
}

export function setProgress(roomId: string, dropId: string, uid: string, patch: Record<string, unknown>) {
  return setDoc(doc(dropRef(roomId, dropId), 'users', uid), patch, { merge: true });
}
