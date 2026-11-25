/**
 * Keeps photos quick to reopen.
 * - Storage path → download URL is remembered on this device, so reopening a chat needs
 *   no getDownloadURL round trip per photo.
 * - The image bytes live in the service worker's 'hi-media-v1' cache (cache-first, capped).
 * Deleting a photo (for me, for everyone, expiry, view-once used up) and signing out evict
 * both. View-once photos are never put in either cache.
 */

export const MEDIA_CACHE = 'hi-media-v1';
const URL_KEY = 'hi.media.urls';
export const MAX_URLS = 400;

/** path → [url, lastUsedMs] */
type UrlMap = Record<string, [string, number]>;

/** Oldest-first eviction: keep the `max` most recently used entries. */
export function trimLru<T extends [unknown, number]>(map: Record<string, T>, max: number): { kept: Record<string, T>; dropped: string[] } {
  const keys = Object.keys(map);
  if (keys.length <= max) return { kept: map, dropped: [] };
  const sorted = keys.sort((a, b) => map[b][1] - map[a][1]);
  const kept: Record<string, T> = {};
  for (const k of sorted.slice(0, max)) kept[k] = map[k];
  return { kept, dropped: sorted.slice(max) };
}

/** View-once / view-twice photos live under rooms/{r}/once/… and are never cached. */
export const isOncePath = (path: string) => /^rooms\/[^/]+\/once\//.test(path);

function load(): UrlMap {
  try { return JSON.parse(localStorage.getItem(URL_KEY) || '{}') as UrlMap; } catch { return {}; }
}
function save(map: UrlMap) {
  try { localStorage.setItem(URL_KEY, JSON.stringify(map)); } catch { /* full or private mode */ }
}

export function cachedUrl(path: string): string | null {
  if (isOncePath(path)) return null;
  const map = load();
  const hit = map[path];
  if (!hit) return null;
  hit[1] = Date.now();
  save(map);
  return hit[0];
}

export function rememberUrl(path: string, url: string) {
  if (isOncePath(path)) return;
  const all: UrlMap = { ...load(), [path]: [url, Date.now()] };
  const { kept, dropped } = trimLru(all, MAX_URLS);
  save(kept);
  if (dropped.length) void dropBytes(dropped.map((p) => all[p][0]));
}

async function dropBytes(urls: string[]) {
  if (!urls.length || typeof caches === 'undefined') return;
  try {
    const c = await caches.open(MEDIA_CACHE);
    await Promise.all(urls.map((u) => c.delete(u)));
  } catch { /* ignore */ }
}

const listeners = new Set<(paths: string[]) => void>();
/** In-memory caches (e.g. the photoURL promise map) subscribe to evictions. */
export function onEvict(fn: (paths: string[]) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** Forget these Storage paths on this device: the URL and the cached bytes. */
export async function evictMedia(paths: (string | null | undefined)[]) {
  const list = paths.filter((p): p is string => !!p);
  if (!list.length) return;
  const map = load();
  const urls = list.map((p) => map[p]?.[0]).filter(Boolean) as string[];
  for (const p of list) delete map[p];
  save(map);
  listeners.forEach((fn) => fn(list));
  await dropBytes(urls);
}

/** Sign-out: nothing of the last account's media stays on the device. */
export async function clearMediaCache() {
  try { localStorage.removeItem(URL_KEY); } catch { /* ignore */ }
  listeners.forEach((fn) => fn(['*']));
  if (typeof caches !== 'undefined') { try { await caches.delete(MEDIA_CACHE); } catch { /* ignore */ } }
}

/** All Storage paths a message holds (photo, its thumbnail, voice). */
export function mediaPathsOf(m: { photo?: { path?: string; thumbPath?: string } | null; voice?: { path?: string } | null }): string[] {
  return [m.photo?.path, m.photo?.thumbPath, m.voice?.path].filter((p): p is string => !!p);
}

interface Seen { paths: string[]; expiresMs: number; hidden: boolean }

/**
 * Compare two snapshots of the same tab and return the media paths this device should
 * forget: a message that lost its photo/voice (deleted for everyone, view-once used up),
 * one I hid ("Delete for me"), or one removed because it expired. A message that merely
 * scrolled out of the loaded window keeps its cache.
 */
export function evictedBetween(prev: Map<string, Seen>, next: Map<string, Seen>, now = Date.now()): string[] {
  const out: string[] = [];
  for (const [id, before] of prev) {
    const after = next.get(id);
    if (!after) {
      if (before.expiresMs && before.expiresMs <= now + 5000) out.push(...before.paths);
      continue;
    }
    if (after.hidden && !before.hidden) { out.push(...before.paths); continue; }
    for (const p of before.paths) if (!after.paths.includes(p)) out.push(p);
  }
  return out;
}

export function seenOf(messages: { id: string; photo?: { path?: string; thumbPath?: string } | null; voice?: { path?: string } | null; expiresAt?: { toMillis(): number } | null; hiddenFor?: string[] }[], me: string): Map<string, Seen> {
  const m = new Map<string, Seen>();
  for (const x of messages) {
    m.set(x.id, { paths: mediaPathsOf(x), expiresMs: x.expiresAt ? x.expiresAt.toMillis() : 0, hidden: !!x.hiddenFor?.includes(me) });
  }
  return m;
}
