const URL_RE = /(https?:\/\/[^\s<>"]+|www\.[^\s<>"]+)/i;
const VIDEO_RE = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|netflix\.com|tiktok\.com|twitch\.tv|dailymotion\.com)$/i;

export interface FoundLink {
  url: string;
  domain: string;
  isVideo: boolean;
  /** The message text with the URL removed. */
  rest: string;
}

/** Finds the first link in a message, normalising "www." links to https. */
export function findLink(text: string): FoundLink | null {
  const m = text.match(URL_RE);
  if (!m) return null;
  let raw = m[0].replace(/[),.!?;:'"]+$/, '');
  const url = /^https?:/i.test(raw) ? raw : `https://${raw}`;
  let domain: string;
  try {
    domain = new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return null;
  }
  return {
    url,
    domain,
    isVideo: VIDEO_RE.test(domain),
    rest: text.replace(m[0], '').replace(/\s+/g, ' ').trim(),
  };
}
