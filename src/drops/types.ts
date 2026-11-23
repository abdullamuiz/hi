import type { ComponentType } from 'preact';
import type { Entry } from '../types';

export interface Person {
  uid: string;
  /** First name, e.g. "Sam". */
  name: string;
  isMe: boolean;
}

/** A field the sender fills in when dropping the card (pre-filled from `content`). */
export type SetupField =
  | { key: string; label: string; kind: 'text'; placeholder?: string; maxLength?: number }
  | { key: string; label: string; kind: 'lines'; placeholder?: string; min?: number; max?: number };

/**
 * What a Drop renderer can see and do. Everything is scoped to the current
 * viewer; the security rules guarantee `theirs()` stays empty until both
 * people have locked the same key.
 */
export interface DropApi {
  me: Person;
  /** The other person in the room (a placeholder until they join). */
  partner: Person;
  createdBy: Person;

  // --- Private answers, keyed by a short id like "answer" or "s0" -----------
  /** My answer for `key` (draft or locked). */
  mine<V = unknown>(key: string): V | undefined;
  /** The partner's answer — only available once both have locked `key`. */
  theirs<V = unknown>(key: string): V | undefined;
  iLocked(key: string): boolean;
  theyLocked(key: string): boolean;
  /** Both locked and the partner's answer has arrived. */
  revealed(key: string): boolean;
  /** Save a private answer that can still change. */
  saveDraft(key: string, value: unknown): Promise<void>;
  /** Freeze my answer. Irreversible. */
  lock(key: string, value: unknown): Promise<void>;

  // --- Public, append-only lines -------------------------------------------
  entries: Entry[];
  addEntry(text: string): Promise<void>;

  // --- Public per-person progress (small JSON object) ------------------------
  myProgress: Record<string, unknown>;
  theirProgress: Record<string, unknown>;
  setMyProgress(patch: Record<string, unknown>): Promise<void>;
}

export interface DropRendererProps<C> {
  content: C;
  api: DropApi;
}

/**
 * A Drop = a JSON definition + a renderer. Put one in `src/drops/<name>.drop.tsx`
 * with `export default defineDrop({...})` and it appears in the tray.
 */
export interface DropDefinition<C extends Record<string, unknown> = Record<string, unknown>> {
  /** Stable id stored in Firestore. Lowercase letters, digits and dashes. */
  type: string;
  /** Card + tray title, e.g. "Gap Slider". */
  title: string;
  /** One line in the tray. */
  trayDescription: string;
  /** Default content; also the shape of what's stored on the Drop. */
  content: C;
  /** Fields the sender can edit before dropping. Omit to drop straight away. */
  setup?: SetupField[];
  /** Small grey line under the card title, e.g. "Hot take". */
  subtitle(content: C): string;
  /** Title shown in the scrapbook. Defaults to `title`. */
  pinTitle?(content: C): string;
  /** One-line detail shown in the scrapbook, from the pinner's view. */
  pinDetail(content: C, api: DropApi): string;
  /** Public lines to seed when the Drop is created (e.g. a story's first line). */
  initialEntries?(content: C): string[];
  /** Tray order; lower comes first. */
  order?: number;
  Renderer: ComponentType<DropRendererProps<C>>;
}

export function defineDrop<C extends Record<string, unknown>>(def: DropDefinition<C>): DropDefinition<C> {
  return def;
}
