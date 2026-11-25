import type { Pin, ScrapKind } from '../types';

/** Sticky-note colours (light enough for dark ink in both themes). */
export const NOTE_COLOURS = ['#FFE9A8', '#FFD6C9', '#D7F0C7', '#CFE6FF', '#E8D9FF', '#F4E4D0'] as const;
export const NOTE_MAX = 1000;
/** Messages pinned to the top of a chat. */
export const TOP_PINS_MAX = 3;

export type ScrapFilter = 'all' | 'note' | 'photo' | 'message' | 'drop';

export function kindOf(p: Pick<Pin, 'kind' | 'dropId' | 'messageId'>): ScrapKind {
  if (p.kind) return p.kind;
  if (p.dropId) return 'drop';
  if (p.messageId) return 'message';
  return 'note';
}

/** Board position: newer pins without an explicit order sit by creation time. */
export function orderOf(p: Pick<Pin, 'order' | 'createdAt'>): number {
  if (typeof p.order === 'number' && Number.isFinite(p.order)) return p.order;
  const ms = p.createdAt?.toMillis?.();
  return typeof ms === 'number' ? ms : Number.MAX_SAFE_INTEGER / 2;
}

/** Highest first (the top of the board). Ties: newer first. */
export function sortScraps<T extends Pick<Pin, 'id' | 'order' | 'createdAt'>>(pins: T[]): T[] {
  return [...pins].sort((a, b) => orderOf(b) - orderOf(a) || (a.id < b.id ? 1 : -1));
}

/** An order value for a brand-new pin: above everything. */
export function topOrder(pins: Array<Pick<Pin, 'order' | 'createdAt'>>, now = Date.now()): number {
  const max = pins.reduce((m, p) => Math.max(m, orderOf(p)), -Infinity);
  return Math.max(now, Number.isFinite(max) ? max + 1 : now);
}

/**
 * Order for an item placed between `above` and `below` (board is highest first), so a
 * move is one write. At the ends it steps 1024 past the neighbour.
 */
export function orderBetween(above: number | null, below: number | null): number {
  if (above == null && below == null) return 0;
  if (above == null) return (below as number) + 1024;
  if (below == null) return above - 1024;
  if (above === below) return above;
  return (above + below) / 2;
}

/**
 * Move `id` to position `to` in the sorted board `list` and return its new order value,
 * or null when it doesn't move.
 */
export function moveOrder<T extends Pick<Pin, 'id' | 'order' | 'createdAt'>>(list: T[], id: string, to: number): number | null {
  const from = list.findIndex((p) => p.id === id);
  if (from < 0) return null;
  const rest = list.filter((p) => p.id !== id);
  const at = Math.max(0, Math.min(rest.length, to));
  if (at === from) return null;
  const above = at > 0 ? orderOf(rest[at - 1]) : null;
  const below = at < rest.length ? orderOf(rest[at]) : null;
  return orderBetween(above, below);
}

export function matchesFilter(p: Pick<Pin, 'kind' | 'dropId' | 'messageId'>, f: ScrapFilter): boolean {
  return f === 'all' || kindOf(p) === f;
}

/** "12d 4h 33m", "4h 03m", "2m 05s"; "0s" once reached. */
export function countdownText(msLeft: number): string {
  if (msLeft <= 0) return '0s';
  const s = Math.floor(msLeft / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (d > 0) return `${d}d ${h}h ${pad(m)}m`;
  if (h > 0) return `${h}h ${pad(m)}m`;
  return `${m}m ${pad(sec)}s`;
}

export interface CountdownItem { dropId: string; title: string; atMs: number }

/** Countdowns to show: not yet reached, or reached less than a day ago. Soonest first. */
export function activeCountdowns<T extends CountdownItem>(items: T[], now: number, dismissed: Set<string> = new Set()): T[] {
  return items
    .filter((c) => Number.isFinite(c.atMs) && c.atMs > 0 && now < c.atMs + 86_400_000 && !dismissed.has(c.dropId))
    .sort((a, b) => a.atMs - b.atMs);
}
