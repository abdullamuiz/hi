/**
 * "Your move": which Drops are waiting on whom. The chat list shows a chip from
 * room.moves[me], so it needs no listener per Drop. Whoever has a Drop on screen
 * keeps room.moves in step with what that Drop says (see DropCard).
 */

export type Waiting = 'me' | 'partner' | null;

/**
 * Default for hidden-answer Drops, from the lock markers ("{uid}_{key}"):
 * the partner locked a key I haven't → my move; I locked one they haven't → theirs.
 */
export function waitingFromLocks(locks: Iterable<string>, me: string, partner: string): Waiting {
  const mine = new Set<string>();
  const theirs = new Set<string>();
  for (const id of locks) {
    if (id.startsWith(me + '_')) mine.add(id.slice(me.length + 1));
    else if (id.startsWith(partner + '_')) theirs.add(id.slice(partner.length + 1));
  }
  for (const k of theirs) if (!mine.has(k)) return 'me';
  for (const k of mine) if (!theirs.has(k)) return 'partner';
  return null;
}

/** The writes that bring room.moves in line with `waiting` for one Drop: [uid, on]. */
export function moveChanges(
  moves: Record<string, Record<string, unknown>> | undefined,
  dropId: string, me: string, partner: string, waiting: Waiting,
): Array<[string, boolean]> {
  const out: Array<[string, boolean]> = [];
  const want: Array<[string, boolean]> = [[me, waiting === 'me'], [partner, waiting === 'partner']];
  for (const [uid, on] of want) {
    const has = !!moves?.[uid]?.[dropId];
    if (has !== on) out.push([uid, on]);
  }
  return out;
}

/** How many Drops are waiting on me (for the chat list chip). */
export function myMoves(moves: Record<string, Record<string, unknown>> | undefined, me: string): number {
  return Object.keys(moves?.[me] || {}).length;
}

// ---------------------------------------------------------------------------- threads (per device)

const SEEN = 'hi.threads.roomSeen';

function readSeen(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SEEN) || '{}'); } catch { return {}; }
}

/** When I last opened any thread in this chat, on this phone. */
export const roomThreadsSeen = (roomId: string) => readSeen()[roomId] || 0;

export function markRoomThreadsSeen(roomId: string, at = Date.now()) {
  const all = readSeen();
  all[roomId] = at;
  try { localStorage.setItem(SEEN, JSON.stringify(all)); } catch { /* private mode */ }
}

/** The other person replied in a thread here since I last opened one. */
export function threadDot(lastAtMs: number, lastBy: string | null, me: string, seenMs: number): boolean {
  return !!lastBy && lastBy !== me && lastAtMs > seenMs;
}
