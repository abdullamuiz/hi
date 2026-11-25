/** Small pure helpers shared by Drops (kept here so they can be unit-tested). */

/** A stable, non-cryptographic 32-bit hash (FNV-1a). */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * How much two rankings agree, 0–100. Each ranking lists item indexes, best first.
 * 100 = identical order, 0 = exactly reversed.
 */
export function agreement(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 100;
  const posB = new Map(b.map((item, i) => [item, i]));
  let diff = 0;
  a.slice(0, n).forEach((item, i) => { diff += Math.abs(i - (posB.get(item) ?? i)); });
  const max = Math.floor((n * n) / 2);
  return Math.round(100 - (diff / max) * 100);
}

/** Decision Wheel: both phones pick the same option, from the options' ids alone. */
export function wheelPick(optionIds: string[]): number {
  if (!optionIds.length) return -1;
  return hash(optionIds.join('|')) % optionIds.length;
}

export interface Reaction { uid: string; code: string; minute: number }

/** Watch Party reactions are stored as public lines "r|<code>|<minute>". */
export const encodeReaction = (code: string, minute: number) => `r|${code}|${Math.max(0, Math.floor(minute))}`;
export function decodeReaction(uid: string, text: string): Reaction | null {
  const m = /^r\|([a-z]{1,12})\|(\d{1,4})$/.exec(text);
  return m ? { uid, code: m[1], minute: Number(m[2]) } : null;
}

/** Minutes where both people reacted within a minute of each other. */
export function sharedMoments(rx: Reaction[], me: string, them: string): number[] {
  const mine = new Set(rx.filter((r) => r.uid === me).map((r) => r.minute));
  const theirs = rx.filter((r) => r.uid === them).map((r) => r.minute);
  const out = new Set<number>();
  for (const t of theirs) {
    for (const d of [-1, 0, 1]) if (mine.has(t + d)) out.add(Math.min(t, t + d));
  }
  return [...out].sort((x, y) => x - y);
}

/** "YYYY-MM-DD" → local midnight in ms, or NaN. */
export function parseDay(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return NaN;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 ? d.getTime() : NaN;
}

/** Local day key, e.g. "20261125". */
export function dayKey(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
}

/** "3 days 4 hours", "5 hours 2 min", "Today". */
export function timeLeft(ms: number): string {
  if (ms <= 0) return 'Today';
  const min = Math.floor(ms / 60000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  const u = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (d > 0) return h ? `${u(d, 'day')} ${u(h, 'hour')}` : u(d, 'day');
  if (h > 0) return `${u(h, 'hour')} ${m} min`;
  return `${Math.max(1, m)} min`;
}

/** "A / B" → ["A", "B"]. */
export function splitPair(s: string): [string, string] {
  const [a, ...rest] = s.split('/');
  return [a.trim(), rest.join('/').trim() || '…'];
}

// ---------------------------------------------------------------------------- daily question

export const DAILY_QUESTIONS: string[] = [
  'What made you smile today?',
  'What’s one small thing you’re looking forward to this week?',
  'What song has been stuck in your head lately?',
  'If today had a colour, what would it be?',
  'What’s something you learned recently?',
  'What’s a meal you could eat every week and never get bored of?',
  'Who made your day a little better recently?',
  'What would your perfect lazy Sunday look like?',
  'What’s a place you’d love to go back to?',
  'What’s one thing you’re proud of this month?',
  'What’s the best thing you watched or read lately?',
  'What’s a tiny habit that makes your day better?',
  'If you could get really good at one thing overnight, what would it be?',
  'What’s something that made you laugh out loud recently?',
  'What’s one thing on your mind right now?',
  'What did you want to be when you were little?',
  'What’s a smell that takes you straight back to childhood?',
  'What’s your comfort film or show?',
  'What’s one thing you’d like to do together soon?',
  'What’s a compliment you still remember?',
  'What season suits you best, and why?',
  'What’s something you’re a bit nervous about?',
  'What’s the most useful thing you own?',
  'Coffee, tea, or something else, and how?',
  'What’s a question you wish people asked you more?',
  'What would you do with a completely free day tomorrow?',
  'What’s a skill you’d love to learn this year?',
  'What’s your favourite way to spend an evening?',
  'What’s one thing that always calms you down?',
  'What’s a memory with me you think about sometimes?',
  'Sunrise or sunset?',
  'What’s a word that describes this week?',
  'What’s a recent win, big or small?',
  'What snack would you take to a desert island?',
  'What’s something kind you saw someone do?',
  'Which app do you open first in the morning?',
  'What’s a song that always lifts your mood?',
  'What’s a weird thing you find really satisfying?',
  'If you could live anywhere for a month, where?',
  'What’s one thing you want to stop worrying about?',
  'What’s your favourite thing about where you live?',
  'What’s the last photo you took, and why?',
  'What’s something you’re grateful for today?',
  'What’s a hobby you’d pick up if time were no object?',
  'What’s a rule you live by?',
  'What did you have for breakfast, honestly?',
  'What’s a film you could quote from memory?',
  'What’s one thing that would make tomorrow great?',
  'Rain on the window or sun on your face?',
  'What’s a childhood game you still love?',
  'What’s your most-used emoji lately?',
  'What’s something you’ve changed your mind about?',
  'Mountains, beach or city?',
  'What’s the nicest message you got this week?',
  'What’s a book or show you’d recommend to me?',
  'What do you need more of right now?',
  'What’s a small luxury you love?',
  'What’s something you’re curious about lately?',
  'What would your theme song be today?',
  'What’s one thing you’d tell your younger self?',
];

/** Today's question for a chat: the same on both phones, different across chats. */
export function dailyQuestionFor(roomId: string, day: string): string {
  return DAILY_QUESTIONS[hash(`${roomId}:${day}`) % DAILY_QUESTIONS.length];
}
