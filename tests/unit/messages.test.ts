import { describe, expect, it } from 'vitest';
import { canEdit, copyText, phraseSegments, reactionChips, snippetOf, visibleTo, wordsOf } from '../../src/lib/messages';

describe('canEdit', () => {
  const now = 1_000_000_000;
  const m = { uid: 'a', kind: 'text' as const, deleted: false, createdMs: now - 60_000 };
  it('own text within 15 minutes', () => {
    expect(canEdit(m, 'a', now)).toBe(true);
    expect(canEdit({ ...m, createdMs: now - 15 * 60_000 }, 'a', now)).toBe(false);
    expect(canEdit(m, 'b', now)).toBe(false);
    expect(canEdit({ ...m, kind: 'photo' }, 'a', now)).toBe(false);
    expect(canEdit({ ...m, deleted: true }, 'a', now)).toBe(false);
  });
});

describe('snippetOf / copyText', () => {
  it('summarises each kind without Drop answers', () => {
    expect(snippetOf({ kind: 'text', text: '  hello\n there ' })).toBe('hello there');
    expect(snippetOf({ kind: 'photo', text: '' })).toBe('📷 Photo');
    expect(snippetOf({ kind: 'drop', text: '' }, 'a Blind Reveal')).toBe('Dropped a Blind Reveal');
    expect(snippetOf({ kind: 'text', text: 'x', deleted: true })).toBe('Message deleted');
    expect(snippetOf({ kind: 'text', text: 'a'.repeat(200) }, '', 10)).toBe('aaaaaaaaa…');
  });
  it('copies text or the link URL', () => {
    expect(copyText({ kind: 'link', text: 'look', link: { url: 'https://x.y' } as any })).toBe('look https://x.y');
    expect(copyText({ kind: 'drop', text: '' })).toBe('');
  });
});

describe('words and phrases', () => {
  it('finds words with offsets', () => {
    expect(wordsOf(' hi  there')).toEqual([{ start: 1, end: 3, text: 'hi' }, { start: 5, end: 10, text: 'there' }]);
  });
  it('splits text around reacted phrases and places chips at the end', () => {
    const p = { uid: 'b', start: 6, end: 11, reaction: 'heart' as const };
    const segs = phraseSegments('Hello there friend', [p]);
    expect(segs.map((s) => [s.text, s.marked, s.chips.length])).toEqual([['Hello ', false, 0], ['there', true, 1], [' friend', false, 0]]);
    expect(segs.map((s) => s.text).join('')).toBe('Hello there friend');
  });
  it('handles overlaps and out-of-range offsets', () => {
    const segs = phraseSegments('abcdef', [
      { uid: 'a', start: 0, end: 4, reaction: 'fire' },
      { uid: 'b', start: 2, end: 99, reaction: 'up' },
      { uid: 'b', start: 50, end: 60, reaction: 'sad' },
    ]);
    expect(segs.map((s) => s.text).join('')).toBe('abcdef');
    expect(segs.flatMap((s) => s.chips).length).toBe(2);
    expect(segs.every((s) => s.marked)).toBe(true);
  });
});

describe('reactions & hidden messages', () => {
  it('counts reactions and marks mine', () => {
    expect(reactionChips({ heart: ['a', 'b'], fire: [] }, 'a')).toEqual([{ code: 'heart', emoji: '❤️', label: 'Love', count: 2, mine: true }]);
  });
  it('hides messages I deleted for myself', () => {
    expect(visibleTo([{ hiddenFor: ['a'] }, { hiddenFor: ['b'] }, {}], 'a')).toHaveLength(2);
  });
});
