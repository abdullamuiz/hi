/** Push to someone invited by e-mail who already has a Hi account. */

export interface RoomLike {
  owner?: string;
  ownerName?: string;
  members?: string[];
  invites?: string[];
  self?: boolean;
  left?: string | null;
}

/** Addresses newly invited by this write (none for Notes to self, full or left chats). */
export function newInvites(before: RoomLike | undefined, after: RoomLike | undefined): string[] {
  if (!after || after.self === true || after.left || (after.members || []).length !== 1) return [];
  const had = new Set((before?.invites || []).map((e) => e.toLowerCase()));
  return [...new Set((after.invites || []).map((e) => String(e).toLowerCase()))].filter((e) => e && !had.has(e));
}

export interface InviteDeps {
  /** uid of the account with this e-mail, or null. */
  lookup(email: string): Promise<string | null>;
  /** Has `uid` blocked `owner`? */
  blocked(uid: string, owner: string): Promise<boolean>;
  /** Records the push once; false if it was already sent. */
  claim(key: string): Promise<boolean>;
  push(uid: string, data: Record<string, string>): Promise<void>;
}

export function inviteText(ownerName: string | undefined): string {
  const first = String(ownerName || '').trim().split(/\s+/)[0] || 'Someone';
  return `${first} invited you to chat on Hi`;
}

/** Sends at most one push per room and address. Returns how many were sent. */
export async function sendInvitePushes(roomId: string, before: RoomLike | undefined, after: RoomLike | undefined, deps: InviteDeps): Promise<number> {
  let sent = 0;
  for (const email of newInvites(before, after)) {
    const uid = await deps.lookup(email);
    if (!uid || uid === after!.owner) continue;
    if (after!.owner && await deps.blocked(uid, after!.owner)) continue;
    if (!(await deps.claim(`${roomId}_${email}`.replace(/\//g, '_')))) continue;
    await deps.push(uid, {
      title: 'Hi',
      body: inviteText(after!.ownerName),
      tag: `invite-${roomId}`,
      url: `./?invite=${encodeURIComponent(roomId)}`,
      invite: roomId,
    });
    sent++;
  }
  return sent;
}
