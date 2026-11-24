/** Storage files to remove when a message is deleted for everyone. */
export interface MsgFiles {
  deleted?: boolean;
  photo?: { path?: unknown } | null;
  voice?: { path?: unknown } | null;
}

const SAFE = /^rooms\/[A-Za-z0-9_-]+\/(photos|voice)\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(jpg|webm|m4a|ogg)$/;

export function filesToDelete(before: MsgFiles | undefined, after: MsgFiles | undefined, roomId: string): string[] {
  if (!before || !after || before.deleted === true || after.deleted !== true) return [];
  return [before.photo?.path, before.voice?.path]
    .filter((p): p is string => typeof p === 'string' && SAFE.test(p) && p.startsWith(`rooms/${roomId}/`));
}
