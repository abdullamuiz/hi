/** Message status ticks and the "Not sent" list. Pure helpers. */

export type Status = 'sending' | 'sent' | 'read';

interface MsgLite { id: string; uid: string; createdMs: number | null; pending?: boolean; deleted?: boolean }

/**
 * Status of each of my messages: sending while the write is still local, read once the
 * other person's "read up to" time has reached it (only when both share read receipts),
 * else sent. Returns the id of the newest read message too (the only one labelled "Read").
 */
export function statuses(msgs: MsgLite[], me: string, partnerReadMs: number | null): { byId: Record<string, Status>; lastReadId: string | null } {
  const byId: Record<string, Status> = {};
  let lastReadId: string | null = null;
  for (const m of msgs) {
    if (m.uid !== me || m.deleted) continue;
    if (m.pending || m.createdMs == null) { byId[m.id] = 'sending'; continue; }
    if (partnerReadMs != null && partnerReadMs + 1000 >= m.createdMs) {
      byId[m.id] = 'read';
      lastReadId = m.id;
    } else byId[m.id] = 'sent';
  }
  return { byId, lastReadId };
}

/** A message whose write was refused; kept on this device so it can be retried. */
export interface Failed {
  localId: string;
  tabId: string;
  text: string;
  replyTo: { msgId: string; snippet: string; senderId: string } | null;
  at: number;
  error: string;
}

export function parseFailed(raw: string | null): Failed[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter((f) => f && typeof f.localId === 'string' && typeof f.text === 'string' && typeof f.tabId === 'string').slice(-50);
  } catch { return []; }
}
