import { describe, expect, it } from 'vitest';
import {
  countWant, countdownStage, defaultKind, driftFix, embedHeight, embedUrl, expectedPosition, normaliseUrl,
  placeholderTitle, presentWithin, providerOf, spotifyRef, wantDelta, youtubeId,
} from '../../src/lib/media';

describe('providerOf', () => {
  it('knows the services', () => {
    expect(providerOf('https://www.netflix.com/title/80057281')).toBe('netflix');
    expect(providerOf('https://www.primevideo.com/detail/0ABC')).toBe('prime');
    expect(providerOf('https://www.amazon.com/gp/video/detail/B0B8TXXYCD')).toBe('prime');
    expect(providerOf('https://www.amazon.co.uk/gp/video/detail/B0B8TXXYCD')).toBe('prime');
    expect(providerOf('https://www.amazon.com/dp/B0B8TXXYCD')).toBe('other');
    expect(providerOf('https://www.disneyplus.com/movies/x/1')).toBe('disney');
    expect(providerOf('https://youtu.be/dQw4w9WgXcQ')).toBe('youtube');
    expect(providerOf('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube');
    expect(providerOf('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube');
    expect(providerOf('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')).toBe('spotify');
    expect(providerOf('https://music.apple.com/us/album/x/1440?i=1441')).toBe('apple');
    expect(providerOf('https://example.com/film')).toBe('other');
    expect(providerOf('not a url')).toBe('other');
  });
  it('picks a list for a pasted link', () => {
    expect(defaultKind('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')).toBe('music');
    expect(defaultKind('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('music');
    expect(defaultKind('https://youtu.be/dQw4w9WgXcQ')).toBe('watch');
  });
});

describe('youtubeId', () => {
  it('reads every link shape', () => {
    const id = 'dQw4w9WgXcQ';
    for (const u of [
      `https://www.youtube.com/watch?v=${id}&t=30s`, `https://youtu.be/${id}?si=abc`, `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/embed/${id}`, `https://www.youtube.com/live/${id}`, `https://m.youtube.com/watch?v=${id}`,
    ]) expect(youtubeId(u)).toBe(id);
    expect(youtubeId('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(youtubeId('https://vimeo.com/123')).toBeNull();
  });
});

describe('embeds', () => {
  it('builds player URLs', () => {
    expect(embedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1&rel=0');
    expect(embedUrl('https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC?si=x')).toBe('https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC?utm_source=hi');
    expect(embedUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')).toBe('https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M?utm_source=hi');
    expect(embedUrl('https://music.apple.com/us/album/golden-hour/1599?i=1600')).toBe('https://embed.music.apple.com/us/album/golden-hour/1599?i=1600');
    expect(embedUrl('https://www.netflix.com/title/80057281')).toBeNull();
    expect(spotifyRef('https://open.spotify.com/user/x')).toBeNull();
    expect(embedHeight('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')).toBe(80);
    expect(embedHeight('https://open.spotify.com/album/4uLU6hMCjMI75M1A2tKUQC')).toBe(152);
  });
  it('cleans pasted text into a link', () => {
    expect(normaliseUrl('look www.netflix.com/title/1 !')).toBe('https://www.netflix.com/title/1');
    expect(normaliseUrl('http://youtu.be/dQw4w9WgXcQ')).toBe('https://youtu.be/dQw4w9WgXcQ');
    expect(normaliseUrl('netflix.com/title/1')).toBe('https://netflix.com/title/1');
    expect(normaliseUrl('hello there')).toBeNull();
    expect(placeholderTitle('https://www.netflix.com/title/1')).toBe('Netflix title');
    expect(placeholderTitle('https://example.org/x')).toBe('example.org');
  });
});

describe('Want to watch count', () => {
  it('moves with status changes', () => {
    expect(wantDelta('watch', null, 'want')).toBe(1);
    expect(wantDelta('watch', 'want', 'watching')).toBe(-1);
    expect(wantDelta('watch', 'watching', 'watched')).toBe(0);
    expect(wantDelta('watch', 'watched', 'want')).toBe(1);
    expect(wantDelta('music', null, null)).toBe(0);
    expect(countWant([{ kind: 'watch', status: 'want' }, { kind: 'watch', status: 'watched' }, { kind: 'music', status: null }])).toBe(1);
  });
});

describe('watch together', () => {
  const s = { state: 'playing' as const, positionSec: 10, updatedAtMs: 1_000_000 };
  it('works out where the video should be', () => {
    expect(expectedPosition(s, 1_005_000)).toBe(15);
    expect(expectedPosition({ ...s, state: 'paused' }, 1_005_000)).toBe(10);
  });
  it('only seeks when drift is noticeable', () => {
    expect(driftFix(14.5, s, 1_005_000)).toBeNull();
    expect(driftFix(12, s, 1_005_000)).toBe(15);
    expect(driftFix(30, { ...s, state: 'paused' }, 1_005_000)).toBe(10);
  });
  it('presence and 3-2-1', () => {
    expect(presentWithin(1000, 30_000)).toBe(true);
    expect(presentWithin(1000, 60_000)).toBe(false);
    expect(presentWithin(null, 1)).toBe(false);
    expect(countdownStage(10_000, 7_500)).toEqual({ n: 3, go: false, done: false });
    expect(countdownStage(10_000, 9_100)).toEqual({ n: 1, go: false, done: false });
    expect(countdownStage(10_000, 11_000)).toEqual({ n: null, go: true, done: false });
    expect(countdownStage(10_000, 17_000)).toEqual({ n: null, go: false, done: true });
  });
});

import { watchInviteText as _wit, watchInviteTitle as _wiT } from '../../src/lib/media';
describe('watch-together chat line', () => {
  it('round-trips the title', () => { expect(_wiT(_wit('Lofi "live" mix'))).toBe('Lofi "live" mix'); });
  it('reads the older wording', () => { expect(_wiT('▶ Watching "YouTube video" together, tap Join at the top')).toBe('YouTube video'); });
  it('ignores normal text', () => { expect(_wiT('Watching a movie tonight')).toBeNull(); expect(_wiT(undefined)).toBeNull(); });
});
