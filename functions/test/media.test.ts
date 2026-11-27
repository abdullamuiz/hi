import { describe, expect, it } from 'vitest';
import { cleanTitle, mediaPatch, mediaPushBody } from '../src/media';

describe('media preview', () => {
  it('fills in title, poster, site and description', () => {
    expect(mediaPatch({ title: 'Netflix title', image: null }, {
      title: 'Stranger Things | Netflix Official Site', image: 'https://img/x.jpg', siteName: 'Netflix', description: 'Kids vs. monsters',
    })).toEqual({ preview: 'ok', title: 'Stranger Things', image: 'https://img/x.jpg', siteName: 'Netflix', description: 'Kids vs. monsters' });
  });
  it('keeps the YouTube thumbnail when the page has no image', () => {
    expect(mediaPatch({ image: 'https://i.ytimg.com/vi/x/hqdefault.jpg' }, { title: 'Clip - YouTube', image: null, siteName: null, description: null }))
      .toEqual({ preview: 'ok', title: 'Clip', image: 'https://i.ytimg.com/vi/x/hqdefault.jpg' });
  });
  it('marks a failed fetch', () => expect(mediaPatch({}, null)).toEqual({ preview: 'failed' }));
  it('cleans service suffixes', () => {
    expect(cleanTitle('Watch Dune: Part Two | Prime Video')).toBe('Dune: Part Two');
    expect(cleanTitle('Golden Hour - song and lyrics by JVKE | Spotify')).toBe('Golden Hour - song and lyrics by JVKE');
    expect(cleanTitle('Plain title')).toBe('Plain title');
  });
  it('words the push', () => {
    expect(mediaPushBody('Alice Smith', 'Dune: Part Two', 'watch')).toBe('Alice added Dune: Part Two to your Watch list');
    expect(mediaPushBody('Bob', 'Golden Hour', 'music')).toBe('Bob added Golden Hour to your Music');
    expect(mediaPushBody('', 'x'.repeat(100), 'watch')).toBe('Hi added something to your Watch list');
  });
});
