/** "Open this message": from search (in a chat, or across chats) to the chat that holds it. */
export interface Jump { roomId: string; tabId: string; msgId: string; atMs: number }

let pending: Jump | null = null;

/** Asks the chat that opens next to scroll to a message. */
export const requestJump = (j: Jump) => { pending = j; };

/** The chat takes its jump once, when it opens. */
export function takeJump(roomId: string): Jump | null {
  if (!pending || pending.roomId !== roomId) return null;
  const j = pending;
  pending = null;
  return j;
}
