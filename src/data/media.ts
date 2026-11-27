import {
  collection, deleteDoc, deleteField, doc, FieldPath, increment, onSnapshot, orderBy, query, serverTimestamp,
  setDoc, updateDoc, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { MediaItem, Together } from '../types';
import {
  defaultKind, placeholderTitle, providerOf, wantDelta, youtubeId, youtubeThumb,
  type MediaKind, type WatchStatus,
} from '../lib/media';

const mediaCol = (roomId: string) => collection(db, 'rooms', roomId, 'media');
const itemRef = (roomId: string, id: string) => doc(db, 'rooms', roomId, 'media', id);
const roomRef = (roomId: string) => doc(db, 'rooms', roomId);
const nowRef = (roomId: string) => doc(db, 'rooms', roomId, 'together', 'now');

function toItem(id: string, d: any): MediaItem {
  return {
    id,
    kind: d.kind === 'music' ? 'music' : 'watch',
    url: String(d.url || ''),
    provider: d.provider || 'other',
    title: String(d.title || ''),
    image: typeof d.image === 'string' ? d.image : null,
    siteName: typeof d.siteName === 'string' ? d.siteName : null,
    description: typeof d.description === 'string' ? d.description : null,
    videoId: typeof d.videoId === 'string' ? d.videoId : null,
    addedBy: String(d.addedBy || ''),
    addedAt: d.addedAt || null,
    status: d.status === 'want' || d.status === 'watching' || d.status === 'watched' ? d.status : null,
    episode: typeof d.episode === 'string' ? d.episode : '',
    ratings: d.ratings && typeof d.ratings === 'object' ? d.ratings : {},
    reactions: d.reactions && typeof d.reactions === 'object' ? d.reactions : {},
    order: typeof d.order === 'number' ? d.order : 0,
    preview: d.preview === 'ok' || d.preview === 'failed' ? d.preview : 'pending',
  };
}

/** Only while a media panel is open (docs/SCALING.md: no listeners on screens you aren't looking at). */
export function watchMedia(roomId: string, cb: (items: MediaItem[], fromServer: boolean) => void, onError?: (e: Error) => void) {
  return onSnapshot(query(mediaCol(roomId), orderBy('order', 'desc')), (s) =>
    cb(s.docs.map((d) => toItem(d.id, d.data({ serverTimestamps: 'estimate' }))), !s.metadata.fromCache),
  onError);
}

/**
 * Adds a pasted link. It shows straight away with what we know (provider badge, YouTube
 * thumbnail, a placeholder title); the server then fills in the page's title and poster.
 */
export async function addMedia(roomId: string, uid: string, url: string, kind: MediaKind = defaultKind(url)) {
  const provider = providerOf(url);
  const videoId = provider === 'youtube' ? youtubeId(url) : null;
  const ref = doc(mediaCol(roomId));
  const b = writeBatch(db);
  b.set(ref, {
    kind, url: url.slice(0, 2048), provider,
    title: placeholderTitle(url),
    image: videoId ? youtubeThumb(videoId) : null,
    siteName: null, description: null, videoId,
    addedBy: uid, addedAt: serverTimestamp(),
    status: kind === 'watch' ? 'want' : null,
    episode: '', ratings: {}, reactions: {},
    order: Date.now(),
    preview: 'pending',
  });
  if (kind === 'watch') b.update(roomRef(roomId), { mediaWantCount: increment(1) });
  await b.commit();
  return ref.id;
}

export async function setStatus(roomId: string, item: MediaItem, status: WatchStatus) {
  if (item.kind !== 'watch' || item.status === status) return;
  const b = writeBatch(db);
  b.update(itemRef(roomId, item.id), { status, order: Date.now() });
  const d = wantDelta('watch', item.status, status);
  if (d) b.update(roomRef(roomId), { mediaWantCount: increment(d) });
  await b.commit();
}

export const setEpisode = (roomId: string, id: string, episode: string) =>
  updateDoc(itemRef(roomId, id), { episode: episode.trim().slice(0, 40) });

export const rate = (roomId: string, id: string, uid: string, stars: number | null) =>
  updateDoc(itemRef(roomId, id), new FieldPath('ratings', uid), stars ? Math.max(1, Math.min(5, Math.round(stars))) : deleteField());

export const react = (roomId: string, id: string, uid: string, emoji: string | null) =>
  updateDoc(itemRef(roomId, id), new FieldPath('reactions', uid), emoji || deleteField());

export async function removeMedia(roomId: string, item: MediaItem) {
  const b = writeBatch(db);
  b.delete(itemRef(roomId, item.id));
  if (item.kind === 'watch' && item.status === 'want') b.update(roomRef(roomId), { mediaWantCount: increment(-1) });
  await b.commit();
}

/** The badge drifted (e.g. an old client): put the true count back, only when it differs. */
export function fixWantCount(roomId: string, have: number, want: number) {
  if (have === want) return Promise.resolve();
  return updateDoc(roomRef(roomId), { mediaWantCount: Math.max(0, want) });
}

export const setSongOfDay = (roomId: string, id: string | null, uid: string) =>
  updateDoc(roomRef(roomId), { songOfDay: id ? { id, by: uid, at: serverTimestamp() } : null });

// ------------------------------------------------------------------ together

function toTogether(d: any): Together | null {
  if (!d || (d.kind !== 'video' && d.kind !== 'countdown')) return null;
  return {
    kind: d.kind, itemId: String(d.itemId || ''), title: String(d.title || ''), provider: d.provider || 'other',
    videoId: typeof d.videoId === 'string' ? d.videoId : null,
    state: d.state === 'playing' ? 'playing' : 'paused',
    positionSec: typeof d.positionSec === 'number' ? d.positionSec : 0,
    atMs: typeof d.atMs === 'number' ? d.atMs : 0,
    countdownAtMs: typeof d.countdownAtMs === 'number' ? d.countdownAtMs : null,
    by: String(d.by || ''),
  };
}

/** One small doc per chat: what's playing together / the 3-2-1. */
export function watchTogether(roomId: string, cb: (t: Together | null) => void) {
  return onSnapshot(nowRef(roomId), (s) => cb(s.exists() ? toTogether(s.data()) : null), () => cb(null));
}

export function startVideo(roomId: string, uid: string, item: MediaItem) {
  return setDoc(nowRef(roomId), {
    kind: 'video', itemId: item.id, title: item.title.slice(0, 200), provider: item.provider, videoId: item.videoId,
    state: 'paused', positionSec: 0, atMs: Date.now(), countdownAtMs: null, by: uid, updatedAt: serverTimestamp(),
  });
}

export function setPlayback(roomId: string, uid: string, state: 'playing' | 'paused', positionSec: number) {
  return updateDoc(nowRef(roomId), {
    state, positionSec: Math.max(0, Math.round(positionSec * 10) / 10), atMs: Date.now(), by: uid, updatedAt: serverTimestamp(),
  });
}

export function startCountdown(roomId: string, uid: string, item: MediaItem, inMs = 5000) {
  return setDoc(nowRef(roomId), {
    kind: 'countdown', itemId: item.id, title: item.title.slice(0, 200), provider: item.provider, videoId: null,
    state: 'paused', positionSec: 0, atMs: Date.now(), countdownAtMs: Date.now() + inMs, by: uid, updatedAt: serverTimestamp(),
  });
}

export const endTogether = (roomId: string) => deleteDoc(nowRef(roomId));

/** "I'm in the watch-together view" (every ~15 s while open). */
export const markPresent = (roomId: string, uid: string) =>
  setDoc(doc(db, 'rooms', roomId, 'together', 'now', 'people', uid), { atMs: Date.now(), at: serverTimestamp() });

export function watchPresence(roomId: string, cb: (lastSeen: Record<string, number>) => void) {
  return onSnapshot(collection(db, 'rooms', roomId, 'together', 'now', 'people'), (s) => {
    const out: Record<string, number> = {};
    s.docs.forEach((d) => { const v = d.data().atMs; if (typeof v === 'number') out[d.id] = v; });
    cb(out);
  }, () => cb({}));
}

/** A floating reaction over the video, for both. */
export const sendTogetherReaction = (roomId: string, uid: string, emoji: string) =>
  setDoc(doc(collection(db, 'rooms', roomId, 'together', 'now', 'rx')), { uid, emoji, atMs: Date.now(), at: serverTimestamp() });

export function watchTogetherReactions(roomId: string, sinceMs: number, cb: (rx: { id: string; uid: string; emoji: string; atMs: number }[]) => void) {
  return onSnapshot(query(collection(db, 'rooms', roomId, 'together', 'now', 'rx'), orderBy('atMs')), (s) => {
    cb(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).filter((r) => typeof r.atMs === 'number' && r.atMs >= sinceMs));
  }, () => cb([]));
}
