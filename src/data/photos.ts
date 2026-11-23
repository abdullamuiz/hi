import { getDownloadURL, ref } from 'firebase/storage';
import { storage } from '../firebase';

const cache = new Map<string, Promise<string>>();

export function photoURL(path: string): Promise<string> {
  let p = cache.get(path);
  if (!p) {
    p = getDownloadURL(ref(storage, path));
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}
