/** Builds the push notification text for a new message. Never includes Drop answers. */
export const DROP_TITLES: Record<string, string> = {
  'feeling-map': 'a Feeling Map',
  'blind-reveal': 'a Blind Reveal',
  'gap-slider': 'a Gap Slider',
  'tag-team-story': 'a Tag-team Story',
  'two-truths': 'Two Truths & a Lie',
  'predict-me': 'a Predict Me',
  'rank-it': 'a Rank It',
  'decision-wheel': 'a Decision Wheel',
  'watch-party': 'a Watch Party',
  'countdown': 'a Countdown',
  'poll': 'a Poll',
  'this-or-that': 'a This or That',
  'time-capsule': 'a Time Capsule',
  'mood-check': 'a Mood Check',
  'daily-question': 'today’s question',
};

export interface MsgLike {
  kind?: string;
  text?: string;
  link?: { url?: string; domain?: string };
  dropType?: string;
  effect?: string;
}

/** Effect names for the push text (keep in step with src/lib/effects.ts). */
const EFFECT_NAMES: Record<string, string> = {
  confetti: '🎉', balloons: '🎈', fireworks: '🎆', glow: '✨',
};

export function notificationBody(m: MsgLike): string {
  const text = (m.text || '').replace(/\s+/g, ' ').trim();
  const cut = (s: string) => (s.length > 140 ? s.slice(0, 139) + '…' : s);
  // Sealed and whispered messages keep their words off the lock screen.
  if (m.effect === 'sealed') return '✉️ Sent you a sealed message';
  if (m.effect === 'whisper') return '🤫 Whispered something';
  const fx = m.effect && EFFECT_NAMES[m.effect] ? `${EFFECT_NAMES[m.effect]} ` : '';
  switch (m.kind) {
    case 'text': return fx + (cut(text) || 'New message');
    case 'link': return cut(text ? `${text} · ${m.link?.domain || 'link'}` : `Shared a link from ${m.link?.domain || 'the web'}`);
    case 'photo': return cut(text ? `Photo: ${text}` : 'Sent a photo');
    case 'voice': return '🎤 Voice note';
    case 'drop': return `Dropped ${DROP_TITLES[m.dropType || ''] || 'a Drop'} — your move`;
    default: return 'New message';
  }
}

/** Push text for a reply in a thread (side discussion). */
export function threadBody(text: string): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return `💬 In a thread: ${t.length > 120 ? t.slice(0, 119) + '…' : t || 'New reply'}`;
}

/** Where a tapped notification opens: the right chat and tab. */
export function openUrl(roomId: string, tabId: string): string {
  return `./?room=${encodeURIComponent(roomId)}&tab=${encodeURIComponent(tabId)}`;
}
