/** Storage refuses or isn't set up (it needs the Blaze plan): say so plainly. */
export function friendlyStorageError(e: unknown, what: 'Photos' | 'Voice notes'): Error {
  const code = (e as { code?: string })?.code || '';
  if (code.startsWith('storage/') && code !== 'storage/canceled') {
    return new Error(`${what} need the Blaze plan — see README`);
  }
  return e instanceof Error ? e : new Error(String(e));
}
