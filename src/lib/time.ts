import type { Timestamp } from 'firebase/firestore';

export function toMillis(t: Timestamp | null | undefined): number {
  return t ? t.toMillis() : Date.now();
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Today", "Yesterday", "Monday", or "3 Nov". */
export function dayLabel(ms: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const d = new Date(ms);
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}

export function lastSeenLabel(ms: number | null, now = Date.now()): string {
  if (ms == null) return 'offline';
  const diff = now - ms;
  if (diff < 90_000) return 'online';
  const min = Math.round(diff / 60_000);
  if (min < 60) return `seen ${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `seen ${h}h ago`;
  return `seen ${dayLabel(ms, now).toLowerCase()}`;
}
