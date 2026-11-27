/**
 * Watch list and Music: pure helpers (provider detection, YouTube ids, embed URLs,
 * watch-together drift, the "Want to watch" count). No Firebase here, so it's unit-tested.
 */

export type MediaKind = 'watch' | 'music';
export type Provider = 'netflix' | 'prime' | 'disney' | 'youtube' | 'spotify' | 'apple' | 'other';
export type WatchStatus = 'want' | 'watching' | 'watched';

export const WATCH_STATUSES: WatchStatus[] = ['want', 'watching', 'watched'];
export const STATUS_LABEL: Record<WatchStatus, string> = { want: 'Want to watch', watching: 'Watching', watched: 'Watched' };
export const MEDIA_REACTIONS = ['❤️', '😂', '😮', '🔥', '🍿', '👎'] as const;
export const TOGETHER_REACTIONS = ['😂', '😍', '😱', '🔥', '👏'] as const;

export const PROVIDERS: Record<Provider, { label: string; badge: string; bg: string; fg: string; app: string }> = {
  netflix: { label: 'Netflix', badge: 'NETFLIX', bg: '#E50914', fg: '#FFFFFF', app: 'Netflix' },
  prime: { label: 'Prime Video', badge: 'prime', bg: '#1A98FF', fg: '#FFFFFF', app: 'Prime Video' },
  disney: { label: 'Disney+', badge: 'Disney+', bg: '#113CCF', fg: '#FFFFFF', app: 'Disney+' },
  youtube: { label: 'YouTube', badge: 'YouTube', bg: '#FF0033', fg: '#FFFFFF', app: 'YouTube' },
  spotify: { label: 'Spotify', badge: 'Spotify', bg: '#1DB954', fg: '#06210F', app: 'Spotify' },
  apple: { label: 'Apple Music', badge: 'Music', bg: '#FA2D48', fg: '#FFFFFF', app: 'Apple Music' },
  other: { label: 'Link', badge: 'Link', bg: '#6B7280', fg: '#FFFFFF', app: 'the website' },
};

/** Services that can't be synced from outside (DRM players): offer 3-2-1 Play instead. */
export const COUNTDOWN_PROVIDERS: Provider[] = ['netflix', 'prime', 'disney'];

/** "www.x.com/…", "x.com/…" or a full URL → https URL, or null if it isn't a web link. */
export function normaliseUrl(raw: string): string | null {
  let s = (raw || '').trim();
  const m = s.match(/(https?:\/\/[^\s<>"]+|www\.[^\s<>"]+|[a-z0-9.-]+\.[a-z]{2,}\/[^\s<>"]*)/i);
  if (!m) return null;
  s = m[0].replace(/[),.!?;:'"]+$/, '');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol === 'http:') u.protocol = 'https:';
    if (!u.hostname.includes('.')) return null;
    return u.toString();
  } catch { return null; }
}

const host = (url: string) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const on = (h: string, d: string) => h === d || h.endsWith(`.${d}`);

export function providerOf(url: string): Provider {
  const h = host(url);
  if (!h) return 'other';
  if (on(h, 'netflix.com')) return 'netflix';
  if (on(h, 'primevideo.com') || (/(^|\.)amazon\.[a-z.]+$/.test(h) && /\/(gp\/video|video)\//i.test(url)) || on(h, 'app.primevideo.com')) return 'prime';
  if (on(h, 'disneyplus.com')) return 'disney';
  if (on(h, 'youtube.com') || on(h, 'youtu.be') || on(h, 'youtube-nocookie.com') || on(h, 'music.youtube.com')) return 'youtube';
  if (on(h, 'spotify.com') || on(h, 'spotify.link')) return 'spotify';
  if (on(h, 'music.apple.com')) return 'apple';
  return 'other';
}

/** Which list a pasted link belongs to by default (Music for music services). */
export function defaultKind(url: string): MediaKind {
  const p = providerOf(url);
  if (p === 'spotify' || p === 'apple' || host(url) === 'music.youtube.com') return 'music';
  return 'watch';
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** youtube.com/watch?v=…, youtu.be/…, /shorts/…, /embed/…, /live/…, music.youtube.com → the 11-char id. */
export function youtubeId(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const h = u.hostname.toLowerCase().replace(/^www\./, '');
  let id: string | null = null;
  if (on(h, 'youtu.be')) id = u.pathname.split('/')[1] || null;
  else if (on(h, 'youtube.com') || on(h, 'youtube-nocookie.com')) {
    id = u.searchParams.get('v');
    if (!id) {
      const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
      id = m ? m[1] : null;
    }
  }
  return id && YT_ID.test(id) ? id : null;
}

export const youtubeThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

/** Spotify open.spotify.com/{intl-xx/}{track|album|playlist|episode|show|artist}/{id} → [type, id]. */
export function spotifyRef(url: string): [string, string] | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!on(u.hostname.toLowerCase(), 'open.spotify.com')) return null;
  const parts = u.pathname.split('/').filter(Boolean).filter((p) => !/^intl-[a-z]{2}/i.test(p) && p !== 'embed');
  const [type, id] = parts;
  if (!type || !id || !/^(track|album|playlist|episode|show|artist)$/.test(type) || !/^[A-Za-z0-9]{8,40}$/.test(id)) return null;
  return [type, id];
}

/** An inline player URL for a song/video, or null when the service can't be embedded. */
export function embedUrl(url: string): string | null {
  const p = providerOf(url);
  if (p === 'youtube') {
    const id = youtubeId(url);
    return id ? `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0` : null;
  }
  if (p === 'spotify') {
    const r = spotifyRef(url);
    return r ? `https://open.spotify.com/embed/${r[0]}/${r[1]}?utm_source=hi` : null;
  }
  if (p === 'apple') {
    try {
      const u = new URL(url);
      return `https://embed.music.apple.com${u.pathname}${u.search}`;
    } catch { return null; }
  }
  return null;
}

/** Height that suits each inline player. */
export function embedHeight(url: string): number {
  const p = providerOf(url);
  if (p === 'spotify') return (spotifyRef(url)?.[0] === 'track' || spotifyRef(url)?.[0] === 'episode') ? 80 : 152;
  if (p === 'apple') return /[?&]i=/.test(url) ? 175 : 175;
  return 0; // YouTube: 16:9 box, sized by CSS
}

/** A title to show before the preview arrives: "netflix.com/title/8…" → "Netflix title". */
export function placeholderTitle(url: string): string {
  const p = providerOf(url);
  if (p !== 'other') return p === 'youtube' ? 'YouTube video' : p === 'spotify' ? 'Spotify' : p === 'apple' ? 'Apple Music' : `${PROVIDERS[p].label} title`;
  return host(url) || 'Link';
}

// ------------------------------------------------------------------ "Want to watch" count

/** How much a status change moves room.mediaWantCount (watch items only). */
export function wantDelta(kind: MediaKind, before: WatchStatus | null, after: WatchStatus | null): number {
  if (kind !== 'watch') return 0;
  return (after === 'want' ? 1 : 0) - (before === 'want' ? 1 : 0);
}

export const countWant = (items: { kind: MediaKind; status?: WatchStatus | null }[]) =>
  items.filter((i) => i.kind === 'watch' && i.status === 'want').length;

// ------------------------------------------------------------------ watch together

export interface TogetherState {
  state: 'playing' | 'paused';
  positionSec: number;
  /** When it was written, in server time (ms). */
  updatedAtMs: number;
}

/** Where the video should be now, given the last shared state and the server clock. */
export function expectedPosition(s: TogetherState, serverNowMs: number): number {
  if (s.state !== 'playing') return Math.max(0, s.positionSec);
  return Math.max(0, s.positionSec + Math.max(0, serverNowMs - s.updatedAtMs) / 1000);
}

export const DRIFT_LIMIT_SEC = 1.5;

/** Seconds to seek to, or null when the local player is close enough. */
export function driftFix(localSec: number, s: TogetherState, serverNowMs: number, limit = DRIFT_LIMIT_SEC): number | null {
  const want = expectedPosition(s, serverNowMs);
  return Math.abs(localSec - want) > limit ? want : null;
}

/** "In sync" = the other person's presence was seen in the last ~40 s. */
export const presentWithin = (lastSeenMs: number | null | undefined, nowMs: number, windowMs = 40_000) =>
  typeof lastSeenMs === 'number' && nowMs - lastSeenMs <= windowMs;

/** 3-2-1: what to show at `nowMs` for a countdown ending at `atMs`. */
export function countdownStage(atMs: number, nowMs: number): { n: number | null; go: boolean; done: boolean } {
  const left = atMs - nowMs;
  if (left > 0) return { n: Math.min(9, Math.ceil(left / 1000)), go: false, done: false };
  if (left > -6000) return { n: null, go: true, done: false };
  return { n: null, go: false, done: true };
}

export const fmtTime = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

/** The chat line sent when someone starts watching together. */
export const watchInviteText = (title: string) => `▶ Watching "${title}" together`;
/** The title in a watch-together chat line (also matches the older "…, tap Join at the top" wording), else null. */
export function watchInviteTitle(text: string | undefined | null): string | null {
  const m = /^▶ Watching "(.+)" together(?:, tap Join at the top)?$/s.exec(text || '');
  return m ? m[1] : null;
}
