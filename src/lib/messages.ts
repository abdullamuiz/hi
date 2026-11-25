import type { Message, PhraseReaction, ReactionCode } from '../types';

export const REACTIONS: { code: ReactionCode; emoji: string; label: string }[] = [
  { code: 'heart', emoji: '❤️', label: 'Love' },
  { code: 'laugh', emoji: '😂', label: 'Haha' },
  { code: 'wow', emoji: '😮', label: 'Wow' },
  { code: 'sad', emoji: '😢', label: 'Sad' },
  { code: 'up', emoji: '👍', label: 'Like' },
  { code: 'fire', emoji: '🔥', label: 'Fire' },
];
export const emojiOf = (code: string) => REACTIONS.find((r) => r.code === code)?.emoji || '';

export const EDIT_WINDOW_MS = 15 * 60_000;

/** Can `uid` still edit this message? (own text, not deleted, within 15 minutes) */
export function canEdit(m: Pick<Message, 'uid' | 'kind' | 'deleted'> & { createdMs: number }, uid: string, now = Date.now()): boolean {
  return m.uid === uid && m.kind === 'text' && !m.deleted && m.createdMs > 0 && now - m.createdMs < EDIT_WINDOW_MS;
}

const cut = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

/** Short, safe text for reply-quotes and the chat list. Never includes Drop answers. */
export function snippetOf(m: Pick<Message, 'kind' | 'text' | 'link' | 'deleted'> & { viewLimit?: number }, dropTitle = 'a Drop', max = 120): string {
  if (m.deleted) return 'Message deleted';
  switch (m.kind) {
    case 'text': return cut(m.text || '', max);
    case 'link': return cut(m.text ? `${m.text} ${m.link?.url || ''}` : m.link?.url || 'Link', max);
    case 'photo': return m.viewLimit ? '📷 Photo' : cut(m.text ? `📷 ${m.text}` : '📷 Photo', max);
    case 'voice': return '🎤 Voice note';
    case 'drop': return cut(`Dropped ${dropTitle}`, max);
    default: return '';
  }
}

/** Text to put on the clipboard for "Copy". */
export function copyText(m: Pick<Message, 'kind' | 'text' | 'link' | 'deleted'>): string {
  if (m.deleted) return '';
  if (m.kind === 'link') return [m.text, m.link?.url].filter(Boolean).join(' ');
  if (m.kind === 'text' || m.kind === 'photo') return m.text || '';
  return '';
}

export interface Word { start: number; end: number; text: string }

/** Words with their character offsets, for the phrase picker. */
export function wordsOf(text: string): Word[] {
  const out: Word[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  return out;
}

export interface Segment {
  text: string;
  /** Part of at least one reacted phrase. */
  marked: boolean;
  /** Reactions whose phrase ends right after this segment. */
  chips: PhraseReaction[];
}

/** Splits text into plain and reacted parts. Ranges outside the text are clamped. */
export function phraseSegments(text: string, phrases: PhraseReaction[] = []): Segment[] {
  const len = text.length;
  const clamp = (n: number) => Math.max(0, Math.min(len, n));
  const ranges = phrases
    .map((p) => ({ p, start: clamp(p.start), end: clamp(p.end) }))
    .filter((r) => r.end > r.start);
  if (!ranges.length) return text ? [{ text, marked: false, chips: [] }] : [];
  const points = [...new Set<number>([0, len, ...ranges.flatMap((r) => [r.start, r.end])])].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    out.push({ text: text.slice(a, b), marked: ranges.some((r) => r.start < b && r.end > a), chips: [] });
  }
  // Each phrase's chip sits right after the segment its phrase ends on.
  ranges.forEach((r) => { out[points.indexOf(r.end) - 1]?.chips.push(r.p); });
  return out;
}

/** Reaction chips under a bubble: code, emoji, count, whether I reacted. */
export function reactionChips(reactions: Message['reactions'], me: string) {
  return REACTIONS
    .map((r) => {
      const uids = reactions?.[r.code] || [];
      return { code: r.code, emoji: r.emoji, label: r.label, count: uids.length, mine: uids.includes(me) };
    })
    .filter((c) => c.count > 0);
}

/** Messages minus the ones I deleted for myself. */
export const visibleTo = <T extends Pick<Message, 'hiddenFor'>>(msgs: T[], uid: string) =>
  msgs.filter((m) => !m.hiddenFor?.includes(uid));
