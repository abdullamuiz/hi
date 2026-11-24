import type { Message } from '../types';
import { isExpired } from './disappear';

/** Search filters: everything, or one kind of message (a media gallery when there's no query). */
export type SearchFilter = 'all' | 'photos' | 'links' | 'voice' | 'drops';

export const FILTERS: { id: SearchFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'photos', label: 'Photos' },
  { id: 'links', label: 'Links' },
  { id: 'voice', label: 'Voice' },
  { id: 'drops', label: 'Drops' },
];

const KIND: Record<Exclude<SearchFilter, 'all'>, Message['kind']> = { photos: 'photo', links: 'link', voice: 'voice', drops: 'drop' };

/** Lower case, without accents: "Café" → "cafe". */
export const normalise = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** The words to look for (normalised, blanks dropped). */
export const terms = (q: string) => normalise(q).split(/\s+/).filter(Boolean);

/** All the text a message can be found by: its text, and a link's title, description, site and address. */
export function searchableText(m: Pick<Message, 'text' | 'link'>): string {
  const l = m.link;
  return [m.text, l?.title, l?.description, l?.siteName, l?.url].filter(Boolean).join(' \n ');
}

/** Can this message turn up in my search at all? */
export function searchable(m: Pick<Message, 'kind' | 'deleted' | 'hiddenFor' | 'expiresAt'>, me: string, now = Date.now()) {
  return m.kind !== 'system' && !m.deleted && !m.hiddenFor?.includes(me) && !isExpired(m, now);
}

/** Every term appears somewhere in the message (any order). */
export function matches(m: Pick<Message, 'text' | 'link'>, q: string[]): boolean {
  if (!q.length) return true;
  const hay = normalise(searchableText(m));
  return q.every((t) => hay.includes(t));
}

export function passesFilter(m: Pick<Message, 'kind'>, f: SearchFilter) {
  return f === 'all' || m.kind === KIND[f];
}

export interface Hit<T> { item: T; at: number }

/**
 * Filters and orders messages for a query, newest first, capped at `limit`.
 * With no query, only a kind filter applies (that's the media gallery); "All" with no
 * query returns nothing, so an empty search box shows a hint, not the whole chat.
 */
export function search<T extends { msg: Message }>(items: T[], q: string, f: SearchFilter, me: string, now = Date.now(), limit = 200): T[] {
  const t = terms(q);
  if (!t.length && f === 'all') return [];
  return items
    .filter(({ msg }) => searchable(msg, me, now) && passesFilter(msg, f) && matches(msg, t))
    .sort((a, b) => ms(b.msg.createdAt) - ms(a.msg.createdAt))
    .slice(0, limit);
}

const ms = (t: unknown) => {
  const x = t as { toMillis?: () => number } | null | undefined;
  return x && typeof x.toMillis === 'function' ? x.toMillis() : 0;
};

export interface Part { text: string; hit: boolean }

/**
 * Splits `text` into plain and matching parts, for highlighting. Matching ignores case and
 * accents, but the parts keep the original characters.
 */
export function highlight(text: string, q: string[]): Part[] {
  if (!text) return [];
  if (!q.length) return [{ text, hit: false }];
  // Normalise character by character, remembering where each normalised char came from.
  let norm = '';
  const from: number[] = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const n = normalise(ch);
    for (let k = 0; k < n.length; k++) from.push(i);
    norm += n;
    i += ch.length;
  }
  from.push(text.length);
  const hit = new Array<boolean>(text.length).fill(false);
  for (const t of q) {
    let at = norm.indexOf(t);
    while (at >= 0) {
      const a = from[at];
      const b = from[at + t.length] ?? text.length;
      for (let i = a; i < Math.max(b, a + 1) && i < text.length; i++) hit[i] = true;
      at = norm.indexOf(t, at + Math.max(1, t.length));
    }
  }
  const parts: Part[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.hit === hit[i]) last.text += text[i];
    else parts.push({ text: text[i], hit: hit[i] });
  }
  return parts;
}

/** A short window of `text` around the first match, so long messages show the relevant bit. */
export function excerpt(text: string, q: string[], max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max || !q.length) return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
  const n = normalise(flat);
  const first = Math.min(...q.map((t) => n.indexOf(t)).filter((i) => i >= 0), Infinity);
  if (!isFinite(first)) return flat.slice(0, max - 1) + '…';
  const start = Math.max(0, Math.min(first - 40, flat.length - max));
  return (start > 0 ? '…' : '') + flat.slice(start, start + max - (start > 0 ? 2 : 1)) + (start + max < flat.length ? '…' : '');
}
