import { useEffect, useState } from 'preact/hooks';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { dailyId, roomDayKey } from '../data/daily';

/**
 * "Today's question" strip at the top of General until both of you have answered.
 * Tapping it scrolls to the card.
 */
export function DailyBanner({ roomId, tz, me, partner, partnerName, onOpen }: {
  roomId: string; tz?: string; me: string; partner: string; partnerName: string; onOpen(msgId: string): void;
}) {
  const id = dailyId(roomDayKey(new Date(), tz));
  const [question, setQuestion] = useState<string | null>(null);
  const [locks, setLocks] = useState<Set<string>>(new Set());
  useEffect(() => {
    const base = doc(db, 'rooms', roomId, 'drops', id);
    const a = onSnapshot(base, (s) => setQuestion(s.exists() ? String(s.data().content?.question || '') : null), () => setQuestion(null));
    const b = onSnapshot(collection(base, 'locks'), (s) => setLocks(new Set(s.docs.map((d) => d.id))), () => setLocks(new Set()));
    return () => { a(); b(); };
  }, [roomId, id]);

  const mine = locks.has(`${me}_answer`);
  const theirs = !!partner && locks.has(`${partner}_answer`);
  if (!question || (mine && theirs)) return null;
  return (
    <button type="button" class="daily-banner" onClick={() => onOpen(id)}>
      <span class="daily-kicker">Today’s question</span>
      <span class="daily-q">{question}</span>
      <span class="daily-state">{mine ? `Waiting for ${partnerName}` : theirs ? `${partnerName} answered · your turn` : 'Answer'}</span>
    </button>
  );
}
