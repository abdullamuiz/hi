import { getDownloadURL, ref } from 'firebase/storage';
import { storage } from '../firebase';
import { cachedUrl, isOncePath, onEvict, rememberUrl } from '../lib/mediaCache';

const cache = new Map<string, Promise<string>>();
onEvict((paths) => {
  if (paths.includes('*')) cache.clear();
  else paths.forEach((p) => cache.delete(p));
});

/**
 * Download URL for a Storage path. Remembered on this device so reopening the app doesn't
 * ask Storage again for every photo (the bytes themselves come from the service worker's
 * media cache). View-once photos are never remembered.
 */
export function photoURL(path: string): Promise<string> {
  if (isOncePath(path)) return getDownloadURL(ref(storage, path));
  let p = cache.get(path);
  if (!p) {
    const known = cachedUrl(path);
    p = known
      ? Promise.resolve(known)
      : getDownloadURL(ref(storage, path)).then((u) => { rememberUrl(path, u); return u; });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}
