/** Storage files to remove when a message is deleted for everyone. */
export interface MsgFiles {
  deleted?: boolean;
  photo?: { path?: unknown; thumbPath?: unknown } | null;
  voice?: { path?: unknown } | null;
  viewLimit?: unknown;
  viewCount?: unknown;
}

const SAFE = /^rooms\/[A-Za-z0-9_-]+\/((photos|voice)\/[A-Za-z0-9_-]+|once\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+)\/[A-Za-z0-9_-]+\.(jpg|webm|m4a|ogg)$/;

const pathsOf = (d: MsgFiles) => [d.photo?.path, d.photo?.thumbPath, d.voice?.path];

export function filesToDelete(before: MsgFiles | undefined, after: MsgFiles | undefined, roomId: string): string[] {
  if (!before || !after || before.deleted === true || after.deleted !== true) return [];
  return pathsOf(before)
    .filter((p): p is string => typeof p === 'string' && SAFE.test(p) && p.startsWith(`rooms/${roomId}/`));
}

/**
 * Storage files of a message that was deleted outright (a disappearing tab's TTL policy,
 * or a deleted chat). Same safety checks as above.
 */
export function filesOfRemoved(data: MsgFiles | undefined, roomId: string): string[] {
  if (!data || data.deleted === true) return [];
  return pathsOf(data)
    .filter((p): p is string => typeof p === 'string' && SAFE.test(p) && p.startsWith(`rooms/${roomId}/`));
}

/**
 * A view-once / view-twice photo whose last view was just counted: its file is removed
 * and the message keeps only "Opened". Returns the path to delete, or null.
 */
export function exhaustedOnce(before: MsgFiles | undefined, after: MsgFiles | undefined, roomId: string): string | null {
  if (!after || after.deleted === true) return null;
  const limit = after.viewLimit, count = after.viewCount;
  if (typeof limit !== 'number' || limit <= 0 || typeof count !== 'number' || count < limit) return null;
  const was = typeof before?.viewCount === 'number' ? before.viewCount : 0;
  if (was >= limit) return null; // already handled
  const p = after.photo?.path;
  return typeof p === 'string' && SAFE.test(p) && p.startsWith(`rooms/${roomId}/once/`) ? p : null;
}
