/** Turn a Storage upload error into a message that names the real cause. */
export function friendlyStorageError(e: unknown, what: 'Photos' | 'Voice notes'): Error {
  const code = (e as { code?: string })?.code || '';
  const one = what === 'Photos' ? 'photo' : 'voice note';
  switch (code) {
    case 'storage/canceled':
      break;
    case 'storage/unauthorized':
      return new Error(`Couldn't upload the ${one}: permission refused. If this keeps happening, see README → Photos and voice notes.`);
    case 'storage/bucket-not-found':
    case 'storage/project-not-found':
    case 'storage/no-default-bucket':
      return new Error(`${what} aren't set up on this project yet (Firebase Storage). See README.`);
    case 'storage/quota-exceeded':
      return new Error(`Storage is full for now. Try again later.`);
    case 'storage/retry-limit-exceeded':
      return new Error(`Couldn't upload the ${one}: the connection dropped. Try again.`);
    default:
      if (code.startsWith('storage/')) return new Error(`Couldn't upload the ${one} (${code.slice(8)}). Try again.`);
  }
  return e instanceof Error ? e : new Error(String(e));
}
