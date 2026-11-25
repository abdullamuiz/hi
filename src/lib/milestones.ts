/**
 * Celebrations shown once per phone: streak lengths, message counts and the yearly
 * anniversary of the chat. Each has a stable id so it's only celebrated once.
 */
export interface Milestone {
  id: string;
  emoji: string;
  title: string;
  body: string;
}

export const STREAK_MILESTONES = [7, 30, 100, 365];
export const MESSAGE_MILESTONES = [100, 1000, 10000];

export interface MilestoneInput {
  /** Current streak (0 when off) and the first day of its run. */
  streak: number;
  runStart: string;
  /** Messages in the chat so far, or null when not counted yet. */
  messages: number | null;
  /** When the chat started, as a day key in the room's zone ('' if unknown). */
  startedOn: string;
  todayKey: string;
  partner: string;
}

const n = (x: number) => x.toLocaleString('en');

/** Every milestone reached right now, biggest first. */
export function reachedMilestones(i: MilestoneInput): Milestone[] {
  const out: Milestone[] = [];
  if (i.startedOn && i.startedOn.slice(5) === i.todayKey.slice(5)) {
    const years = Number(i.todayKey.slice(0, 4)) - Number(i.startedOn.slice(0, 4));
    if (years >= 1) {
      out.push({
        id: `anniv-${years}`, emoji: '🎂',
        title: years === 1 ? 'One year of Hi' : `${years} years of Hi`,
        body: `You and ${i.partner} started chatting on this day ${years === 1 ? 'a year' : `${years} years`} ago.`,
      });
    }
  }
  for (const t of [...STREAK_MILESTONES].reverse()) {
    if (i.streak >= t && i.runStart) {
      out.push({
        id: `streak-${t}-${i.runStart}`, emoji: '🔥',
        title: `${n(t)}-day streak`,
        body: `${n(t)} days in a row of you and ${i.partner} both saying hi.`,
      });
    }
  }
  for (const t of [...MESSAGE_MILESTONES].reverse()) {
    if ((i.messages ?? 0) >= t) {
      out.push({ id: `msgs-${t}`, emoji: '💬', title: `${n(t)} messages`, body: `You and ${i.partner} have sent each other ${n(t)} messages.` });
    }
  }
  return out;
}

/**
 * Which milestone to show now: the first unseen one. Everything reached is then marked
 * seen, so an old chat doesn't replay "100 messages" after "1,000 messages".
 */
export function nextMilestone(reached: Milestone[], seen: ReadonlySet<string>): { show: Milestone | null; mark: string[] } {
  const show = reached.find((m) => !seen.has(m.id)) || null;
  return { show, mark: show ? reached.map((m) => m.id) : [] };
}

