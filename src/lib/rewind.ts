import { addDays, dayKeyIn, daysBetween } from './streak';

/**
 * Rewind: a story-style recap of a month or a year, worked out on the phone from the
 * chat's recent history (the same capped read search and export use).
 */

export interface RewindMessage {
  id: string;
  tabId: string;
  uid: string;
  kind: string;
  text: string;
  ms: number;
  photoPath?: string | null;
  dropId?: string;
  deleted?: boolean;
  hidden?: boolean;
}

export interface RewindPeriod {
  from: number;
  to: number;
  label: string;
}

export interface RewindStats {
  total: number;
  /** uid → messages sent. */
  perPerson: Record<string, number>;
  topEmojis: { emoji: string; n: number }[];
  topWords: { word: string; n: number }[];
  drops: number;
  /** Most-played Drop type, if any. */
  topDrop: { type: string; n: number } | null;
  /** Longest run of days on which both of you sent something. */
  longestRun: number;
  busiestDay: { key: string; n: number } | null;
  first: RewindMessage | null;
  photos: string[];
  topTab: { tabId: string; n: number } | null;
  /** Longest quiet stretch between two messages. */
  biggestGapMs: number;
  activeDays: number;
}

// Common English words (and chat filler) that would otherwise top every list.
export const STOPWORDS = new Set(`
a about above after again against all am an and any are aren't as at be because been before being below between both
but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further
had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i
i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once
only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such
than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this
those through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's
where where's which while who who's whom why why's will with won't would wouldn't you you'd you'll you're you've your
yours yourself yourselves just like yeah yes yep okay ok oh also really got get gonna wanna one now well still even
know think going go see want lol haha hahaha hmm umm thats dont im ive youre its cant didnt wont doesnt isnt u ur
`.trim().split(/\s+/));

const EMOJI = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*/gu;

export function emojisIn(text: string): string[] {
  return text.match(EMOJI) || [];
}

export function wordsIn(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[’‘]/g, "'")
    .split(/[^\p{L}\p{N}']+/u)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

function top<K>(counts: Map<K, number>, n: number): [K, number][] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n);
}

const bump = <K>(m: Map<K, number>, k: K, by = 1) => m.set(k, (m.get(k) || 0) + by);

/**
 * Stats for the messages in `period`. `dropTypes` maps a Drop's id (message.dropId) to its type,
 * for "favourite Drop"; `tz` decides where days start.
 */
export function computeRewind(
  all: RewindMessage[], period: RewindPeriod, me: string, them: string, dropTypes: Record<string, string>, tz?: string,
  /** Words to leave out of the top words (your names). */
  skipWords: ReadonlySet<string> = new Set(),
): RewindStats {
  const msgs = all
    .filter((m) => m.ms >= period.from && m.ms < period.to && !m.deleted && !m.hidden && m.kind !== 'system')
    .sort((a, b) => a.ms - b.ms);
  const perPerson: Record<string, number> = {};
  const emojis = new Map<string, number>();
  const words = new Map<string, number>();
  const dropsBy = new Map<string, number>();
  const perDay = new Map<string, number>();
  const daySenders = new Map<string, Set<string>>();
  const tabs = new Map<string, number>();
  const photos: string[] = [];
  let drops = 0;
  let gap = 0;
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    perPerson[m.uid] = (perPerson[m.uid] || 0) + 1;
    emojisIn(m.text).forEach((e) => bump(emojis, e));
    wordsIn(m.text).forEach((w) => { if (!skipWords.has(w)) bump(words, w); });
    if (m.kind === 'drop') {
      drops++;
      const t = m.dropId ? dropTypes[m.dropId] : undefined;
      if (t) bump(dropsBy, t);
    }
    if (m.kind === 'photo' && m.photoPath) photos.push(m.photoPath);
    const day = dayKeyIn(m.ms, tz);
    bump(perDay, day);
    if (!daySenders.has(day)) daySenders.set(day, new Set());
    daySenders.get(day)!.add(m.uid);
    bump(tabs, m.tabId);
    if (i > 0) gap = Math.max(gap, m.ms - msgs[i - 1].ms);
  }
  // Longest run of consecutive days where both of us sent something.
  const bothDays = [...daySenders.entries()].filter(([, s]) => s.has(me) && s.has(them)).map(([d]) => d).sort();
  let run = 0;
  let longest = 0;
  bothDays.forEach((d, i) => {
    run = i > 0 && daysBetween(bothDays[i - 1], d) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  });
  const busiest = top(perDay, 1)[0];
  const topTab = top(tabs, 1)[0];
  const topDrop = top(dropsBy, 1)[0];
  return {
    total: msgs.length,
    perPerson,
    topEmojis: top(emojis, 5).map(([emoji, n]) => ({ emoji, n })),
    topWords: top(words, 5).map(([word, n]) => ({ word, n })),
    drops,
    topDrop: topDrop ? { type: topDrop[0], n: topDrop[1] } : null,
    longestRun: longest,
    busiestDay: busiest ? { key: busiest[0], n: busiest[1] } : null,
    first: msgs.find((m) => m.kind === 'text' || m.kind === 'link') || msgs[0] || null,
    photos: photos.slice(-6),
    topTab: topTab ? { tabId: topTab[0], n: topTab[1] } : null,
    biggestGapMs: gap,
    activeDays: perDay.size,
  };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Ready-made periods, in the room's zone. `which`: this month, last month or this year. */
export function rewindPeriod(which: 'this-month' | 'last-month' | 'this-year', now: number, tz?: string, startOfDay?: (key: string) => number): RewindPeriod {
  const today = dayKeyIn(now, tz);
  const [y, m] = today.split('-').map(Number);
  const start = startOfDay || ((k: string) => Date.parse(`${k}T00:00:00Z`));
  const key = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}-01`;
  if (which === 'this-year') {
    return { from: start(key(y, 1)), to: start(addDays(today, 1)), label: String(y) };
  }
  if (which === 'this-month') {
    return { from: start(key(y, m)), to: start(addDays(today, 1)), label: `${MONTHS[m - 1]} so far` };
  }
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return { from: start(key(py, pm)), to: start(key(y, m)), label: `${MONTHS[pm - 1]}${py !== y ? ` ${py}` : ''}` };
}

/** "3 days", "5 hours", "40 minutes". */
export function gapLabel(ms: number): string {
  const h = ms / 3_600_000;
  if (h >= 48) return `${Math.round(h / 24)} days`;
  if (h >= 1.5) return `${Math.round(h)} hours`;
  return `${Math.max(1, Math.round(ms / 60_000))} minutes`;
}

export const monthName = (i: number) => MONTHS[i];
