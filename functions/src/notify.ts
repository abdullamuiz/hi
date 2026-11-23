/** Builds the push notification text for a new message. Never includes Drop answers. */
export const DROP_TITLES: Record<string, string> = {
  'feeling-map': 'a Feeling Map',
  'blind-reveal': 'a Blind Reveal',
  'gap-slider': 'a Gap Slider',
  'tag-team-story': 'a Tag-team Story',
};

export interface MsgLike {
  kind?: string;
  text?: string;
  link?: { url?: string; domain?: string };
  dropType?: string;
}

export function notificationBody(m: MsgLike): string {
  const text = (m.text || '').replace(/\s+/g, ' ').trim();
  const cut = (s: string) => (s.length > 140 ? s.slice(0, 139) + '…' : s);
  switch (m.kind) {
    case 'text': return cut(text) || 'New message';
    case 'link': return cut(text ? `${text} · ${m.link?.domain || 'link'}` : `Shared a link from ${m.link?.domain || 'the web'}`);
    case 'photo': return cut(text ? `Photo: ${text}` : 'Sent a photo');
    case 'drop': return `Dropped ${DROP_TITLES[m.dropType || ''] || 'a Drop'} — your move`;
    default: return 'New message';
  }
}
