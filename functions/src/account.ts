/** What happens to each of my chats when I delete my account. */
export interface RoomLike {
  id: string;
  members?: unknown;
}

export interface AccountPlan {
  /** Chats only I am in (never joined, or the other person left): deleted. */
  remove: string[];
  /** Chats with someone else: I leave, and they see "X left this chat". */
  leave: string[];
}

export function accountPlan(uid: string, rooms: RoomLike[]): AccountPlan {
  const plan: AccountPlan = { remove: [], leave: [] };
  for (const r of rooms) {
    const members = Array.isArray(r.members) ? r.members.filter((m): m is string => typeof m === 'string') : [];
    if (!members.includes(uid)) continue;
    if (members.length <= 1) plan.remove.push(r.id);
    else plan.leave.push(r.id);
  }
  return plan;
}
