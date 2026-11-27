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
  /** uid of the person who left (removed the contact). The chat is then read-only. */
  left: string | null;
  /** Hot streak (opt-in): proposed by one, on once the other accepts. */
  streak: RoomStreak | null;
  /** Up to 3 messages pinned to the top of the chat (oldest first). */
  pinned: TopPin[];
  /** Notes to self: one person forever, never joined or invited to. */
  self: boolean;
  /** Drops waiting on each person ("Your move"): uid → dropId → true. */
  moves: Record<string, Record<string, true>>;
  /** Latest thread reply anywhere in the chat (for the chat list's 💬 dot). */
  lastThreadReplyAt: Timestamp | null;
  lastThreadReplyBy: string | null;
  /** How many Watch list items are "Want to watch" (the 🎬 badge, without listening to the list). */
  mediaWantCount: number;
  /** Music: the pinned song of the day. */
  songOfDay: { id: string; by: string } | null;
}

/** room.pinned[]: a message pinned to the top of the chat. */
export interface TopPin {
  msgId: string;
  tabId: string;
  /** Who wrote the message (for its colour and name). */
  uid: string;
  /** Who pinned it. */
  by: string;
  /** Snippet (sealed/whisper text stays hidden). */
  text: string;
  at: Timestamp | null;
}

/**
 * room.streak. The count is worked out on the phones from rooms/{id}/days; `count`,
 * `best` and `day` are just a cache for the chat list.
 */
export interface RoomStreak {
  state: 'proposed' | 'on';
  /** Who proposed it. */
  by: string;
  at: Timestamp | null;
  /** When it was accepted: days are counted from then. */
  since?: Timestamp | null;
  count?: number;
  best?: number;
  /** Day key the cached count was worked out on. */
  day?: string;
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
  /** Disappearing messages: new messages are removed after `ttlHours`. */
  disappearing: boolean;
  /** 24, 168 (7 days) or 2160 (90 days). Only meaningful while `disappearing` is on. */
  ttlHours: number;
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
  /** Gone once a view-once / view-twice photo has been used up. */
  path?: string;
  width: number;
  height: number;
  /** ~480px copy for bubbles and the scrapbook (photos sent before it existed have none). */
  thumbPath?: string;
}

/** rooms/{roomId}/tabs/{tabId}/messages/{id} */
export interface Message {
  id: string;
  tabId: string;
  uid: string;
  kind: 'text' | 'link' | 'photo' | 'voice' | 'drop' | 'system';
  text: string;
  /** kind 'system': what happened ("disappearing" = the tab's setting changed). */
  system?: 'disappearing';
  /** kind 'system' / disappearing: the new setting in hours (0 = turned off). */
  ttlHours?: number;
  /** Disappearing tabs: when the message goes (hidden at once, deleted by a TTL policy). */
  expiresAt?: Timestamp | null;
  link?: LinkPreview;
  photo?: PhotoRef;
  voice?: VoiceRef;
  /** Voice notes: uids who have played it. */
  playedBy?: string[];
  /** Voice notes: reactions dropped at a moment in the audio. */
  voiceReactions?: VoiceReaction[];
  dropId?: string;
  createdAt: Timestamp | null;
  /** Reply-quote of an earlier message. */
  replyTo?: ReplyRef;
  /** A reply to the other person's 24-hour note. */
  replyToNote?: { text: string; emoji: string };
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
  /** Delivered from a scheduled message. */
  scheduled?: boolean;
  /** Sent as Urgent: may break through the other person's quiet hours (3 a day). */
  urgent?: boolean;
  /** A screen or bubble effect (SPEC §4), from the list in src/lib/effects.ts. */
  effect?: import('./lib/effects').EffectCode;
  /** Thread tile: the side discussion under this message. */
  thread?: { count: number; lastAt: Timestamp | null; lastBy: string; lastId: string };
  /** View-once (1) / view-twice (2) photo. */
  viewLimit?: 1 | 2;
  /** How often the recipient has opened it. */
  viewCount?: number;
  /** Client-only: still waiting to reach the server. */
  pending?: boolean;
}

/** rooms/{roomId}/scheduled/{id} — only the sender can see it. Its id becomes the message id. */
export interface Scheduled {
  id: string;
  roomId: string;
  senderId: string;
  tabId: string;
  text: string;
  replyTo: ReplyRef | null;
  sendAt: number;
}

export interface VoiceRef {
  path: string;
  durationMs: number;
  /** About 64 values from 0 to 1. */
  peaks: number[];
  mime: string;
}

export interface VoiceReaction { uid: string; atMs: number; reaction: ReactionCode }

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

/** rooms/{roomId}/pins/{id}: one scrap in the scrapbook. */
export type ScrapKind = 'drop' | 'message' | 'photo' | 'note';
export interface Pin {
  id: string;
  /** Who pinned (or wrote the note). */
  by: string;
  title: string;
  /** Snippet, or the note's text. */
  detail: string;
  dropId: string | null;
  messageId: string | null;
  tabId: string | null;
  createdAt: Timestamp | null;
  /** Missing on older pins: worked out from dropId / messageId. */
  kind?: ScrapKind;
  /** Board position (higher = nearer the top). Older pins use their creation time. */
  order?: number;
  /** Sticky-note colour (notes). */
  colour?: string;
  /** Photo scraps: the Storage path (pinned photos are kept by any future media clean-up). */
  photoPath?: string | null;
  /** Message/photo scraps: who wrote it. */
  senderId?: string | null;
  editedBy?: string | null;
  editedAt?: Timestamp | null;
}

/** rooms/{id}/media/{itemId}: one Watch list title or Music song. */
export interface MediaItem {
  id: string;
  kind: 'watch' | 'music';
  url: string;
  provider: 'netflix' | 'prime' | 'disney' | 'youtube' | 'spotify' | 'apple' | 'other';
  title: string;
  image: string | null;
  siteName: string | null;
  description: string | null;
  /** YouTube video id, when it's a YouTube link. */
  videoId: string | null;
  addedBy: string;
  addedAt: Timestamp | null;
  /** Watch list only. */
  status: 'want' | 'watching' | 'watched' | null;
  /** "S2 E5" for a series being watched. */
  episode: string;
  /** uid → 1..5 stars. */
  ratings: Record<string, number>;
  /** uid → one emoji. */
  reactions: Record<string, string>;
  order: number;
  /** The server fills title/image from the page (pending → ok | failed). */
  preview: 'pending' | 'ok' | 'failed';
}

/** rooms/{id}/together/now: what's playing together (YouTube) or a 3-2-1 countdown. */
export interface Together {
  kind: 'video' | 'countdown';
  itemId: string;
  title: string;
  provider: MediaItem['provider'];
  videoId: string | null;
  state: 'playing' | 'paused';
  positionSec: number;
  /** Writer's clock (ms) when this state was set; phones' clocks are close enough for sync. */
  atMs: number;
  /** 3-2-1: when to press play (ms). */
  countdownAtMs: number | null;
  by: string;
}
