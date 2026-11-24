import type { Timestamp } from 'firebase/firestore';

export type MoodId = 'sunny' | 'cloudy' | 'foggy' | 'stormy';

/** rooms/{roomId} */
export interface Room {
  id: string;
  owner: string;
  ownerName: string;
  /** uids, max 2. */
  members: string[];
  /** Lower-cased e-mail addresses allowed to join. */
  invites: string[];
  /** IANA zone for all "day" logic (streaks, On This Day). */
  timezone: string;
  createdAt: Timestamp | null;
  /** Secret part of the share link while nobody has joined yet (owner only sees it). */
  inviteCode: string | null;
  /** Latest message, for the chat list. */
  lastMessage: LastMessage | null;
}

export interface LastMessage {
  id: string;
  uid: string;
  tabId: string;
  /** Short preview text. Never a hidden Drop answer. */
  text: string;
  at: Timestamp | null;
}

/** rooms/{roomId}/members/{uid} — public profile inside the room. */
export interface Member {
  uid: string;
  name: string;
  photoURL: string | null;
  mood: MoodId | null;
  lastSeen: Timestamp | null;
  typingUntil: Timestamp | null;
  /** Which tab the typing is in. */
  typingTab: string | null;
  /** Per-tab "read up to" times, for unread counts. */
  lastRead: Record<string, Timestamp>;
}

/** rooms/{roomId}/tabs/{tabId} — a parallel conversation inside the room. */
export interface Tab {
  id: string;
  name: string;
  colour: string;
  wallpaper: string | null;
  mode: 'casual' | 'work';
  disappearing: boolean;
  archived: boolean;
  order: number;
  createdBy: string;
  createdAt: Timestamp | null;
  lastMessageAt: Timestamp | null;
}

export interface LinkPreview {
  url: string;
  domain: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  isVideo: boolean;
  /** 'pending' until the Cloud Function has read the Open Graph tags. */
  status: 'pending' | 'ok' | 'failed';
}

export interface PhotoRef {
  path: string;
  width: number;
  height: number;
}

/** rooms/{roomId}/tabs/{tabId}/messages/{id} */
export interface Message {
  id: string;
  tabId: string;
  uid: string;
  kind: 'text' | 'link' | 'photo' | 'drop';
  text: string;
  link?: LinkPreview;
  photo?: PhotoRef;
  dropId?: string;
  createdAt: Timestamp | null;
  /** Reply-quote of an earlier message. */
  replyTo?: ReplyRef;
  /** Set when the sender edited the text (within 15 minutes). */
  editedAt?: Timestamp | null;
  /** uids who chose "Delete for me". */
  hiddenFor?: string[];
  /** "Delete for everyone": content is cleared. */
  deleted?: boolean;
  /** Quick reactions: reaction code → uids. */
  reactions?: Partial<Record<ReactionCode, string[]>>;
  /** Reactions to a span of the text. */
  phraseReactions?: PhraseReaction[];
}

export type ReactionCode = 'heart' | 'laugh' | 'wow' | 'sad' | 'up' | 'fire';

export interface ReplyRef {
  msgId: string;
  snippet: string;
  senderId: string;
}

export interface PhraseReaction {
  uid: string;
  /** Character offsets into the message text, end exclusive. */
  start: number;
  end: number;
  reaction: ReactionCode;
}

/** rooms/{roomId}/drops/{dropId} */
export interface DropDoc {
  id: string;
  type: string;
  createdBy: string;
  createdAt: Timestamp | null;
  content: Record<string, unknown>;
}

/** rooms/{roomId}/drops/{dropId}/sealed/{uid}_{key} — a private answer. */
export interface Sealed<V = unknown> {
  uid: string;
  key: string;
  value: V;
  locked: boolean;
}

/** rooms/{roomId}/drops/{dropId}/entries/{id} — public, append-only. */
export interface Entry {
  id: string;
  uid: string;
  text: string;
  createdAt: Timestamp | null;
}

/** rooms/{roomId}/pins/{id} */
export interface Pin {
  id: string;
  by: string;
  title: string;
  detail: string;
  dropId: string | null;
  messageId: string | null;
  tabId: string | null;
  createdAt: Timestamp | null;
}
