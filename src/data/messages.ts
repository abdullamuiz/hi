import {
  arrayRemove, arrayUnion, collection, deleteField, doc, FieldPath, limitToLast, onSnapshot, orderBy, query,
  serverTimestamp, Timestamp, updateDoc, where, writeBatch, type WriteBatch,
} from 'firebase/firestore';
import { ttlOf } from './tabs';
import { markActivity } from './memories';
import { expiryFor, ttlLabel } from '../lib/disappear';
import { ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';
import { findLink } from '../lib/links';
import { compressImage } from '../lib/image';
import { snippetOf } from '../lib/messages';
import type { LastMessage, Message, PhraseReaction, ReactionCode, ReplyRef, VoiceReaction } from '../types';
import type { VoiceFormat } from '../lib/voice';
import { friendlyStorageError } from '../lib/errors';
import { effectDef, previewFor, type EffectCode } from '../lib/effects';


const msgsCol = (roomId: string, tabId: string) => collection(db, 'rooms', roomId, 'tabs', tabId, 'messages');

/**
 * The open tab's messages: the latest 300, or (to reach an older message from search)
 * everything from `fromMs` on, up to 1,500.
 */
export function watchMessages(roomId: string, tabId: string, cb: (m: Message[]) => void, onError?: (e: Error) => void, fromMs?: number | null) {
  const q = fromMs != null
    ? query(msgsCol(roomId, tabId), where('createdAt', '>=', Timestamp.fromMillis(fromMs)), orderBy('createdAt'), limitToLast(1500))
    : query(msgsCol(roomId, tabId), orderBy('createdAt'), limitToLast(300));
  // Metadata changes too, so a message flips from "sending" to "sent" when the server has it.
  return onSnapshot(q, { includeMetadataChanges: true }, (s) => {
    cb(s.docs.map((d) => ({
      id: d.id, tabId, text: '', ...(d.data({ serverTimestamps: 'estimate' }) as any), pending: d.metadata.hasPendingWrites,
    })));
  }, onError);
}

const newId = (roomId: string, tabId: string) => doc(msgsCol(roomId, tabId)).id;

/**
 * Writes a message, bumps the tab's lastMessageAt and the room's chat-list preview,
 * all in the same atomic batch.
 */
function addMessage(b: WriteBatch, roomId: string, tabId: string, id: string, data: Record<string, unknown>, preview: string, ttlHours = ttlOf(roomId, tabId)) {
  // Disappearing tab: the message carries its expiry (rules check it matches the tab).
  const exp = expiryFor(ttlHours);
  b.set(doc(msgsCol(roomId, tabId), id), { ...data, ...(exp ? { expiresAt: Timestamp.fromMillis(exp) } : {}), createdAt: serverTimestamp() });
  b.update(doc(db, 'rooms', roomId, 'tabs', tabId), { lastMessageAt: serverTimestamp() });
  b.update(doc(db, 'rooms', roomId), { lastMessage: { id, uid: data.uid, tabId, text: preview.slice(0, 160), at: serverTimestamp() } });
  // Today counts towards the streak and Rewind (system lines like "disappearing on" don't).
  if (data.kind !== 'system') markActivity(b, roomId, String(data.uid));
}

export async function sendText(roomId: string, tabId: string, uid: string, raw: string, replyTo?: ReplyRef | null, opts: { urgent?: boolean; effect?: EffectCode | null } = {}) {
  const text = raw.trim().slice(0, 4000);
  if (!text) return;
  const fx = effectDef(opts.effect);
  // A bubble effect (sealed, whisper…) styles the text itself, so it is sent as plain text, without a link card.
  const link = fx?.kind === 'bubble' ? null : findLink(text);
  const b = writeBatch(db);
  const reply = {
    ...(replyTo ? { replyTo: { msgId: replyTo.msgId, snippet: replyTo.snippet.slice(0, 160), senderId: replyTo.senderId } } : {}),
    ...(opts.urgent ? { urgent: true } : {}),
    ...(fx ? { effect: fx.code } : {}),
  };
  if (link) {
    const data = {
      uid, kind: 'link', text: link.rest, ...reply,
      link: {
        url: link.url, domain: link.domain, isVideo: link.isVideo,
        title: null, description: null, image: null, siteName: null, status: 'pending',
      },
    };
    addMessage(b, roomId, tabId, newId(roomId, tabId), data, snippetOf(data as any));
  } else {
    addMessage(b, roomId, tabId, newId(roomId, tabId), { uid, kind: 'text', text, ...reply }, previewFor(snippetOf({ kind: 'text', text }), fx?.code));
  }
  await b.commit();
}

/** A reply to someone's 24-hour note: a text message that quotes the note. */
export async function sendNoteReply(roomId: string, tabId: string, uid: string, raw: string, note: { text: string; emoji: string }) {
  const text = raw.trim().slice(0, 4000);
  if (!text) return;
  const b = writeBatch(db);
  const replyToNote = { text: note.text.slice(0, 60), emoji: note.emoji.slice(0, 16) };
  addMessage(b, roomId, tabId, newId(roomId, tabId), { uid, kind: 'text', text, replyToNote }, snippetOf({ kind: 'text', text }));
  await b.commit();
}

export async function sendPhoto(roomId: string, tabId: string, uid: string, file: File, caption: string) {
  const { blob, width, height } = await compressImage(file, 1600);
  const id = newId(roomId, tabId);
  const path = `rooms/${roomId}/photos/${uid}/${id}.jpg`;
  try {
    await uploadBytes(ref(storage, path), blob, { contentType: 'image/jpeg', cacheControl: 'private, max-age=31536000' });
  } catch (e) { throw friendlyStorageError(e, 'Photos'); }
  const b = writeBatch(db);
  const text = caption.trim().slice(0, 1000);
  addMessage(b, roomId, tabId, id, { uid, kind: 'photo', text, photo: { path, width, height } }, snippetOf({ kind: 'photo', text }));
  await b.commit();
}

export interface VoiceRecording {
  blob: Blob;
  durationMs: number;
  peaks: number[];
  format: VoiceFormat;
}

/** Uploads a voice note, then posts the message that plays it. */
export async function sendVoice(roomId: string, tabId: string, uid: string, rec: VoiceRecording, replyTo?: ReplyRef | null) {
  const id = newId(roomId, tabId);
  const path = `rooms/${roomId}/voice/${uid}/${id}.${rec.format.ext}`;
  try {
    await uploadBytes(ref(storage, path), rec.blob, { contentType: rec.format.contentType, cacheControl: 'private, max-age=31536000' });
  } catch (e) { throw friendlyStorageError(e, 'Voice notes'); }
  const b = writeBatch(db);
  const voice = {
    path,
    durationMs: Math.max(1, Math.min(180_000, Math.round(rec.durationMs))),
    peaks: rec.peaks.slice(0, 64).map((p) => Math.round(Math.max(0, Math.min(1, p)) * 100) / 100),
    mime: rec.format.contentType,
  };
  const reply = replyTo ? { replyTo: { msgId: replyTo.msgId, snippet: replyTo.snippet.slice(0, 160), senderId: replyTo.senderId } } : {};
  addMessage(b, roomId, tabId, id, { uid, kind: 'voice', text: '', voice, ...reply }, snippetOf({ kind: 'voice', text: '' }));
  await b.commit();
}

/** Creates a Drop and the chat message that carries it, atomically. */
export async function createDrop(
  roomId: string, tabId: string, uid: string, type: string, content: Record<string, unknown>, firstEntries: string[] = [], title = 'a Drop',
  /** A fixed Drop id and extra writes for the same batch (e.g. a Session's own doc). */
  opts: { id?: string; extra?(b: WriteBatch): void } = {},
) {
  const b = writeBatch(db);
  const dropRef = opts.id ? doc(db, 'rooms', roomId, 'drops', opts.id) : doc(collection(db, 'rooms', roomId, 'drops'));
  b.set(dropRef, { type, createdBy: uid, createdAt: serverTimestamp(), content });
  firstEntries.forEach((text) => {
    b.set(doc(collection(dropRef, 'entries')), { uid, text: text.slice(0, 280), createdAt: serverTimestamp() });
  });
  opts.extra?.(b);
  addMessage(b, roomId, tabId, newId(roomId, tabId), { uid, kind: 'drop', text: '', dropId: dropRef.id }, snippetOf({ kind: 'drop', text: '' }, title));
  await b.commit();
  return dropRef.id;
}

/**
 * Turns disappearing messages on (for `hours`) or off for a tab, and posts the
 * "X turned on disappearing messages" line, in one batch (rules require both together).
 */
export async function setDisappearing(roomId: string, tabId: string, uid: string, hours: number) {
  const b = writeBatch(db);
  const on = hours > 0;
  b.update(doc(db, 'rooms', roomId, 'tabs', tabId), on ? { disappearing: true, ttlHours: hours } : { disappearing: false });
  const text = on ? `Disappearing messages: ${ttlLabel(hours)}` : 'Disappearing messages off';
  addMessage(b, roomId, tabId, newId(roomId, tabId), { uid, kind: 'system', system: 'disappearing', ttlHours: on ? hours : 0, text }, text, on ? hours : 0);
  await b.commit();
}

// ---------------------------------------------------------------------------- message actions

const msgRef = (roomId: string, m: Pick<Message, 'id' | 'tabId'>) => doc(db, 'rooms', roomId, 'tabs', m.tabId, 'messages', m.id);

/** If `m` is the chat-list preview, rewrite that preview (keeping its time). */
function fixPreview(b: WriteBatch, roomId: string, last: LastMessage | null, m: Pick<Message, 'id'>, text: string) {
  if (last && last.id === m.id && last.at) {
    b.update(doc(db, 'rooms', roomId), { lastMessage: { ...last, text: text.slice(0, 160) } });
  }
}

/** Edit my own text (rules: within 15 minutes of sending). */
export async function editMessage(roomId: string, m: Message, raw: string, last: LastMessage | null) {
  const text = raw.trim().slice(0, 4000);
  if (!text || text === m.text) return;
  const b = writeBatch(db);
  b.update(msgRef(roomId, m), { text, editedAt: serverTimestamp() });
  fixPreview(b, roomId, last, m, previewFor(snippetOf({ kind: 'text', text }), m.effect));
  await b.commit();
}

/** "Delete for me" (and its undo). */
export const hideMessage = (roomId: string, m: Message, uid: string, hidden = true) =>
  updateDoc(msgRef(roomId, m), { hiddenFor: hidden ? arrayUnion(uid) : arrayRemove(uid) });

/** "Delete for everyone": clears the content; a Cloud Function removes any photo or voice file. */
export async function deleteForEveryone(roomId: string, m: Message, last: LastMessage | null) {
  const b = writeBatch(db);
  b.update(msgRef(roomId, m), {
    deleted: true, text: '',
    link: deleteField(), photo: deleteField(), dropId: deleteField(), replyTo: deleteField(), replyToNote: deleteField(),
    reactions: deleteField(), phraseReactions: deleteField(), editedAt: deleteField(),
    ...(m.effect ? { effect: deleteField() } : {}),
    ...(m.kind === 'voice' ? { voice: deleteField(), voiceReactions: deleteField(), playedBy: deleteField() } : {}),
  });
  fixPreview(b, roomId, last, m, 'Message deleted');
  await b.commit();
}

/** Toggle one of my quick reactions. */
export const setReaction = (roomId: string, m: Message, uid: string, code: ReactionCode, on: boolean) =>
  updateDoc(msgRef(roomId, m), new FieldPath('reactions', code), on ? arrayUnion(uid) : arrayRemove(uid));

export const addPhraseReaction = (roomId: string, m: Message, p: PhraseReaction) =>
  updateDoc(msgRef(roomId, m), { phraseReactions: arrayUnion({ uid: p.uid, start: p.start, end: p.end, reaction: p.reaction }) });

export const removePhraseReaction = (roomId: string, m: Message, p: PhraseReaction) =>
  updateDoc(msgRef(roomId, m), { phraseReactions: arrayRemove({ uid: p.uid, start: p.start, end: p.end, reaction: p.reaction }) });

// ---------------------------------------------------------------------------- voice notes

/** The partner has listened to my voice note. */
export const markPlayed = (roomId: string, m: Message, uid: string) =>
  updateDoc(msgRef(roomId, m), { playedBy: arrayUnion(uid) });

export const addVoiceReaction = (roomId: string, m: Message, r: VoiceReaction) =>
  updateDoc(msgRef(roomId, m), { voiceReactions: arrayUnion({ uid: r.uid, atMs: Math.max(0, Math.round(r.atMs)), reaction: r.reaction }) });

export const removeVoiceReaction = (roomId: string, m: Message, r: VoiceReaction) =>
  updateDoc(msgRef(roomId, m), { voiceReactions: arrayRemove({ uid: r.uid, atMs: r.atMs, reaction: r.reaction }) });
