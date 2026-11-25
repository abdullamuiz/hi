import { describe, expect, it } from 'vitest';
import { displayName, NOTE_MS, noteActive, noteLabel, suggestedName } from '../../src/lib/profile';

const now = Date.UTC(2026, 10, 24, 12);

describe('noteActive', () => {
  it('shows a note for 24 hours', () => {
    expect(noteActive({ text: 'hi', emoji: '', atMs: now - 1000 }, now)).toBe(true);
    expect(noteActive({ text: 'hi', emoji: '', atMs: now - NOTE_MS + 1000 }, now)).toBe(true);
    expect(noteActive({ text: 'hi', emoji: '', atMs: now - NOTE_MS }, now)).toBe(false);
  });
  it('counts a note still being saved as fresh, and ignores empty ones', () => {
    expect(noteActive({ text: 'hi', emoji: '', atMs: null }, now)).toBe(true);
    expect(noteActive({ text: '  ', emoji: '', atMs: now }, now)).toBe(false);
    expect(noteActive({ text: '', emoji: '☕', atMs: now }, now)).toBe(true);
    expect(noteActive(null, now)).toBe(false);
  });
  it('ignores a note stamped far in the future', () => {
    expect(noteActive({ text: 'hi', emoji: '', atMs: now + 60 * 60 * 1000 }, now)).toBe(false);
  });
});

describe('names', () => {
  it('prefers my nickname, then their profile, then the chat name', () => {
    expect(displayName('Bobby 🐻', 'Bob Smith', 'bob', 'x')).toBe('Bobby 🐻');
    expect(displayName('  ', 'Bob Smith', 'bob', 'x')).toBe('Bob');
    expect(displayName('', '', 'bob@example.com', 'x')).toBe('bob');
    expect(displayName(null, null, null, 'Friend')).toBe('Friend');
  });
  it('suggests a starting name from Google or the e-mail', () => {
    expect(suggestedName('Alice Liddell', 'a@x.com')).toBe('Alice Liddell');
    expect(suggestedName(null, 'alice@example.com')).toBe('alice');
    expect(suggestedName('', null)).toBe('');
  });
  it('labels a note with its emoji', () => {
    expect(noteLabel({ text: 'exam tomorrow ', emoji: '📚', atMs: 0 })).toBe('📚 exam tomorrow');
    expect(noteLabel({ text: 'hi', emoji: '', atMs: 0 })).toBe('hi');
  });
});
