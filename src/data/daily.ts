import { doc, getDoc, serverTimestamp, Timestamp, writeBatch } from 'firebase/firestore';
import { expiryFor } from '../lib/disappear';
import { db } from '../firebase';
import { dailyQuestionFor, dayKey } from '../drops/logic';
import { dayKeyIn } from '../lib/streak';
import { snippetOf } from '../lib/messages';
import { GENERAL, ttlOf } from './tabs';

/** Doc id shared by the day's Drop and its message, so it's only ever created once. */
export const dailyId = (day: string) => `daily-${day}`;

/**
 * Today as "YYYYMMDD" in the room's time zone, so both phones agree on which day's
 * question it is even when they're in different zones.
 */
export const roomDayKey = (now: Date = new Date(), tz?: string) => (tz ? dayKeyIn(now.getTime(), tz).replace(/-/g, '') : dayKey(now));

/**
 * Drops today's question into General if neither of us has yet. Either phone may do
 * it when the chat opens; the fixed id means a second attempt fails harmlessly.
 */
export async function ensureDailyQuestion(roomId: string, uid: string, tz?: string, now = new Date()): Promise<string | null> {
  const day = roomDayKey(now, tz);
  const id = dailyId(day);
  const dropRef = doc(db, 'rooms', roomId, 'drops', id);
  if ((await getDoc(dropRef)).exists()) return id;
  const question = dailyQuestionFor(roomId, day);
  const b = writeBatch(db);
  b.set(dropRef, { type: 'daily-question', createdBy: uid, createdAt: serverTimestamp(), content: { question, day } });
  // A disappearing General tab needs the expiry on the message (rules check it).
  const exp = expiryFor(ttlOf(roomId, GENERAL));
  b.set(doc(db, 'rooms', roomId, 'tabs', GENERAL, 'messages', id), {
    uid, kind: 'drop', text: '', dropId: id, createdAt: serverTimestamp(), ...(exp ? { expiresAt: Timestamp.fromMillis(exp) } : {}),
  });
  b.update(doc(db, 'rooms', roomId, 'tabs', GENERAL), { lastMessageAt: serverTimestamp() });
  b.update(doc(db, 'rooms', roomId), {
    lastMessage: { id, uid, tabId: GENERAL, text: snippetOf({ kind: 'drop', text: '' }, 'Today’s question'), at: serverTimestamp() },
  });
  try {
    await b.commit();
  } catch {
    // The other phone got there first (or the chat is read-only): nothing to do.
    return (await getDoc(dropRef).catch(() => null))?.exists() ? id : null;
  }
  return id;
}
