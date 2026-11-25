import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import { loadTabs } from './tabs';
import type { Message, Tab } from '../types';

/**
 * Firestore has no full-text search, so search and export read recent history into the
 * app and work on it here. Up to HISTORY_CAP messages per chat (newest first, spread over
 * its tabs); older messages are left out of search, and the export says if it was cut.
 */
export const HISTORY_CAP = 2000;

export interface RoomHistory {
  roomId: string;
  tabs: Tab[];
  /** Newest first. */
  messages: Message[];
  /** Names from the room's member profiles. */
  names: Record<string, string>;
  /** True when some tab had more messages than were read. */
  truncated: boolean;
}

const cache = new Map<string, { at: number; p: Promise<RoomHistory> }>();

async function read(roomId: string, cap: number): Promise<RoomHistory> {
  const [tabs, members] = await Promise.all([
    loadTabs(roomId),
    getDocs(collection(db, 'rooms', roomId, 'members')),
  ]);
  const names: Record<string, string> = {};
  members.docs.forEach((d) => { names[d.id] = String(d.data().name || ''); });
  const perTab = Math.max(100, Math.ceil(cap / Math.max(1, tabs.length)));
  let truncated = false;
  const lists = await Promise.all(tabs.map(async (t) => {
    const s = await getDocs(query(collection(db, 'rooms', roomId, 'tabs', t.id, 'messages'), orderBy('createdAt', 'desc'), limit(perTab)));
    if (s.size >= perTab) truncated = true;
    return s.docs.map((d) => ({ id: d.id, tabId: t.id, text: '', ...(d.data({ serverTimestamps: 'estimate' }) as any) }) as Message);
  }));
  const ms = (m: Message) => (m.createdAt ? m.createdAt.toMillis() : 0);
  const messages = lists.flat().sort((a, b) => ms(b) - ms(a)).slice(0, cap);
  return { roomId, tabs, messages, names, truncated };
}

/** Recent history of one chat. Reused for a minute, so typing a search doesn't re-read. */
export function loadHistory(roomId: string, opts: { cap?: number; fresh?: boolean } = {}): Promise<RoomHistory> {
  const cap = opts.cap ?? HISTORY_CAP;
  const hit = cache.get(`${roomId}:${cap}`);
  if (hit && !opts.fresh && Date.now() - hit.at < 60_000) return hit.p;
  const p = read(roomId, cap);
  cache.set(`${roomId}:${cap}`, { at: Date.now(), p });
  p.catch(() => cache.delete(`${roomId}:${cap}`));
  return p;
}
