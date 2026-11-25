import { describe, expect, it } from 'vitest';
import {
  computePeaks, formatDuration, formatFromBlobType, markerPercent, pickVoiceFormat, resampleLevels, slideIntent,
} from '../../src/lib/voice';
import { friendlyStorageError } from '../../src/lib/errors';

describe('computePeaks', () => {
  it('takes the loudest absolute sample in each bucket, scaled to 0..1', () => {
    const s = new Float32Array([0.1, -0.2, 0.05, 0.4, -0.8, 0.2, 0, 0.1]);
    expect(computePeaks(s, 4)).toEqual([0.25, 0.5, 1, 0.13]);
  });
  it('gives 64 values by default and handles silence', () => {
    const tone = new Float32Array(48_000).map((_, i) => Math.sin(i / 10) * (i / 48_000));
    const p = computePeaks(tone);
    expect(p).toHaveLength(64);
    expect(Math.max(...p)).toBe(1);
    expect(p[0]).toBeLessThan(p[63]);
    expect(computePeaks(new Float32Array(100))).toEqual(new Array(64).fill(0));
  });
  it('never returns more buckets than samples', () => {
    expect(computePeaks(new Float32Array([0.5, 1]), 64)).toEqual([0.5, 1]);
    expect(computePeaks(new Float32Array([]))).toEqual([]);
  });
});

describe('resampleLevels', () => {
  it('keeps short level lists and scales them', () => {
    expect(resampleLevels([1, 2, 4])).toEqual([0.25, 0.5, 1]);
  });
  it('shrinks long lists to 64', () => {
    expect(resampleLevels(new Array(500).fill(0).map((_, i) => i % 7))).toHaveLength(64);
  });
});

describe('formatDuration', () => {
  it('formats minutes and seconds', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(7_400)).toBe('0:07');
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(120_000)).toBe('2:00');
    expect(formatDuration(NaN)).toBe('0:00');
  });
});

describe('recording formats', () => {
  it('prefers Opus in WebM, falls back to MP4/AAC (Safari)', () => {
    expect(pickVoiceFormat((m) => m.startsWith('audio/webm'))?.ext).toBe('webm');
    expect(pickVoiceFormat((m) => m === 'audio/mp4')).toEqual({ recorderMime: 'audio/mp4', contentType: 'audio/mp4', ext: 'm4a' });
    expect(pickVoiceFormat(() => false)).toBeNull();
  });
  it('trusts what the recorder actually produced', () => {
    const webm = { recorderMime: 'audio/webm', contentType: 'audio/webm', ext: 'webm' as const };
    expect(formatFromBlobType('audio/mp4', webm).ext).toBe('m4a');
    expect(formatFromBlobType('audio/webm;codecs=opus', webm).contentType).toBe('audio/webm');
    expect(formatFromBlobType('', webm)).toBe(webm);
  });
});

describe('voice gestures and markers', () => {
  it('slide left cancels, slide up locks', () => {
    expect(slideIntent(-120, 0)).toBe('cancel');
    expect(slideIntent(0, -90)).toBe('lock');
    expect(slideIntent(-20, -10)).toBeNull();
  });
  it('places markers along the waveform', () => {
    expect(markerPercent(1500, 3000)).toBe(50);
    expect(markerPercent(5000, 3000)).toBe(100);
    expect(markerPercent(10, 0)).toBe(0);
  });
});

describe('friendlyStorageError', () => {
  it('explains Storage failures (no Blaze plan yet)', () => {
    expect(friendlyStorageError({ code: 'storage/unauthorized' }, 'Voice notes').message).toBe('Voice notes need the Blaze plan — see README');
    expect(friendlyStorageError({ code: 'storage/unknown' }, 'Photos').message).toBe('Photos need the Blaze plan — see README');
  });
  it('leaves other errors alone', () => {
    expect(friendlyStorageError({ code: 'storage/canceled', message: 'x' }, 'Photos').message).not.toContain('Blaze');
    expect(friendlyStorageError(new Error('offline'), 'Photos').message).toBe('offline');
  });
});
