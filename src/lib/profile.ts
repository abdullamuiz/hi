import { firstName } from './names';

export const NOTE_MS = 24 * 60 * 60 * 1000;
export const NOTE_MAX = 60;
export const ABOUT_MAX = 80;
export const NAME_MAX = 40;
export const NICK_MAX = 40;
export const NOTE_EMOJI = ['💭', '📚', '☕', '🎧', '🏃', '😴', '🎉', '🍜', '✈️', '❤️'];

export interface Note {
  text: string;
  emoji: string;
  /** ms since epoch; null while the server time is pending. */
  atMs: number | null;
}

/** A note shows for 24 hours after it was set. A note still being saved counts as fresh. */
export function noteActive(note: Note | null | undefined, now = Date.now()): note is Note {
  if (!note || (!note.text.trim() && !note.emoji)) return false;
  if (note.atMs == null) return true;
  return now - note.atMs < NOTE_MS && note.atMs - now < 5 * 60 * 1000;
}

/** "📚 exam tomorrow" */
export function noteLabel(note: Note): string {
  return [note.emoji, note.text.trim()].filter(Boolean).join(' ');
}

/**
 * What I call someone: my private nickname if I gave one, else the first name from
 * their profile, else from the chat, else the fallback.
 */
export function displayName(nickname: string | null | undefined, profileName: string | null | undefined, memberName: string | null | undefined, fallback = 'Friend'): string {
  const nick = (nickname || '').trim();
  if (nick) return nick;
  return firstName(profileName || memberName, fallback);
}

/** A starting name for the profile form: the Google name, else the part of the e-mail before @. */
export function suggestedName(displayName: string | null | undefined, email: string | null | undefined): string {
  const d = (displayName || '').trim();
  if (d) return d.slice(0, NAME_MAX);
  return (email || '').split('@')[0].slice(0, NAME_MAX);
}

/** "Since March 2026" */
export function sinceLabel(ms: number): string {
  if (!ms) return '';
  return `Since ${new Date(ms).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`;
}
