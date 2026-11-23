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
  createdAt: Timestamp | null;
}

/** rooms/{roomId}/members/{uid} — public profile inside the room. */
export interface Member {
  uid: string;
  name: string;
  photoURL: string | null;
  mood: MoodId | null;
  lastSeen: Timestamp | null;
  typingUntil: Timestamp | null;
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

/** rooms/{roomId}/messages/{id} */
export interface Message {
  id: string;
  uid: string;
  kind: 'text' | 'link' | 'photo' | 'drop';
  text: string;
  link?: LinkPreview;
  photo?: PhotoRef;
  dropId?: string;
  createdAt: Timestamp | null;
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
  createdAt: Timestamp | null;
}
