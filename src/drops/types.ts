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
  | {
    key: string; label: string; kind: 'text'; placeholder?: string; maxLength?: number;
    /** May be left empty (the Drop's `prepare` can fill it in). */
    optional?: boolean;
    /** Shows a 🎲 button that fills the field with this suggestion. */
    suggest?(): string;
  }
  | { key: string; label: string; kind: 'lines'; placeholder?: string; min?: number; max?: number }
  /** A calendar date, stored as "YYYY-MM-DD". */
  | { key: string; label: string; kind: 'date' }
  /**
   * A private pick among other fields' values (e.g. "which statement is the lie").
   * Not stored in `content`: it's sealed and locked under `key` for the sender as the
   * Drop is created, so the other person can't read it until they lock the same key.
   */
  | { key: string; label: string; kind: 'secret'; from: string[] };

/**
 * What a Drop renderer can see and do. Everything is scoped to the current
 * viewer; the security rules guarantee `theirs()` stays empty until both
 * people have locked the same key.
 */
export interface DropApi {
  /** The chat this Drop is in. */
  roomId: string;
  /** This Drop's id (stable; handy for "play once" keys). */
  dropId: string;
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

  // --- Photos ---------------------------------------------------------------
  /** Compresses and uploads a photo for this Drop; resolves to its Storage path. */
  uploadPhoto(file: File): Promise<string>;
  /** A viewable URL for a photo path from `uploadPhoto` (members only). */
  photoUrl(path: string): Promise<string>;
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
  /** Card title when it depends on the content (e.g. which Session test). Defaults to `title`. */
  cardTitle?(content: C): string;
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
  /** Not offered in the tray (e.g. the Daily question, which the app drops itself). */
  hidden?: boolean;
  /** Works with nobody else in the chat, so it's offered in Notes to self too. */
  solo?: boolean;
  /**
   * Last chance to check or derive content before dropping (e.g. turn a date into
   * a timestamp). Return an error message to stop, or the content to store.
   */
  prepare?(content: C): C | string;
  /**
   * Whose move it is, for the "Your move" chip on the chat list. Leave it out for
   * hidden-answer Drops: by default the partner locked a key I haven't → 'me', and the
   * other way round → 'partner'. Return null when nobody needs to act.
   */
  waitingOn?(content: C, api: DropApi): 'me' | 'partner' | null;
  Renderer: ComponentType<DropRendererProps<C>>;
}

export function defineDrop<C extends Record<string, unknown>>(def: DropDefinition<C>): DropDefinition<C> {
  return def;
}
