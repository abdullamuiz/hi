/** Pure helpers for voice notes: waveform, durations, recording formats. */

export const VOICE_MAX_MS = 120_000;
export const VOICE_MIN_MS = 500;
export const PEAKS = 64;

/**
 * Splits the samples into `n` equal buckets and takes the loudest absolute value of each,
 * scaled so the loudest bucket is 1. Values are rounded to 2 decimals (small to store).
 */
export function computePeaks(samples: ArrayLike<number>, n = PEAKS): number[] {
  const len = samples.length;
  if (!len || n <= 0) return [];
  const count = Math.min(n, len);
  const out: number[] = new Array(count).fill(0);
  for (let b = 0; b < count; b++) {
    const from = Math.floor((b * len) / count);
    const to = Math.max(from + 1, Math.floor(((b + 1) * len) / count));
    let max = 0;
    for (let i = from; i < to; i++) {
      const v = Math.abs(samples[i]);
      if (v > max) max = v;
    }
    out[b] = max;
  }
  return normalise(out);
}

/** Resamples a list of levels (e.g. the live meter) to `n` values, scaled to 0..1. */
export function resampleLevels(levels: number[], n = PEAKS): number[] {
  if (!levels.length) return [];
  if (levels.length <= n) return normalise(levels.slice());
  return computePeaks(levels, n);
}

function normalise(v: number[]): number[] {
  const max = Math.max(...v.map((x) => (Number.isFinite(x) ? x : 0)));
  return v.map((x) => (max > 0 && Number.isFinite(x) ? Math.round((x / max) * 100) / 100 : 0));
}

/** 0:07, 1:05, 12:00. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export interface VoiceFormat {
  /** What MediaRecorder is asked for ('' = browser default). */
  recorderMime: string;
  /** Stored content type, without codecs. */
  contentType: string;
  ext: 'webm' | 'm4a';
}

/** Opus in WebM where supported (Chrome, Firefox, Android); AAC in MP4 on Safari/iOS. */
export function pickVoiceFormat(isSupported: (mime: string) => boolean): VoiceFormat | null {
  const options: VoiceFormat[] = [
    { recorderMime: 'audio/webm;codecs=opus', contentType: 'audio/webm', ext: 'webm' },
    { recorderMime: 'audio/webm', contentType: 'audio/webm', ext: 'webm' },
    { recorderMime: 'audio/mp4;codecs=mp4a.40.2', contentType: 'audio/mp4', ext: 'm4a' },
    { recorderMime: 'audio/mp4', contentType: 'audio/mp4', ext: 'm4a' },
    { recorderMime: 'audio/aac', contentType: 'audio/mp4', ext: 'm4a' },
  ];
  for (const f of options) {
    try { if (isSupported(f.recorderMime)) return f; } catch { /* keep looking */ }
  }
  return null;
}

/** The format a recorder actually produced (it may differ from what was asked). */
export function formatFromBlobType(type: string, fallback: VoiceFormat): VoiceFormat {
  const t = (type || '').toLowerCase();
  if (t.startsWith('audio/webm') || t.startsWith('video/webm')) return { recorderMime: type, contentType: 'audio/webm', ext: 'webm' };
  if (t.startsWith('audio/mp4') || t.startsWith('video/mp4') || t.startsWith('audio/aac') || t.startsWith('audio/x-m4a')) {
    return { recorderMime: type, contentType: 'audio/mp4', ext: 'm4a' };
  }
  return fallback;
}

/** Where a timed reaction sits on the waveform, as a 0–100 percentage. */
export function markerPercent(atMs: number, durationMs: number): number {
  if (!(durationMs > 0)) return 0;
  return Math.min(100, Math.max(0, (atMs / durationMs) * 100));
}

/** Slide gestures while holding the mic: far enough left cancels, far enough up locks. */
export function slideIntent(dx: number, dy: number): 'cancel' | 'lock' | null {
  if (dx < -90) return 'cancel';
  if (dy < -70 && Math.abs(dx) < 60) return 'lock';
  return null;
}
