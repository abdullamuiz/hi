import { createHash } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';
import { getStorage } from 'firebase-admin/storage';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentCreated, onDocumentDeleted, onDocumentUpdated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { fetchPreview } from './og.js';
import { notificationBody, openUrl, threadBody } from './notify.js';
import { exhaustedOnce, filesOfRemoved, filesToDelete } from './cleanup.js';
import { accountPlan } from './account.js';
import { sendInvitePushes } from './invites.js';
import { dayKeyIn, due, expiryMs, isMuted, isQuiet, scheduledToMessage, summaryText, urgentDecision, type Held } from './delivery.js';

initializeApp();
// Small, capped instances keep a two-person app comfortably inside the free tier.
setGlobalOptions({ region: 'us-central1', maxInstances: 3, memory: '256MiB' });

const MESSAGE = 'rooms/{roomId}/tabs/{tabId}/messages/{msgId}';
const VIDEO_RE = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|netflix\.com|tiktok\.com|twitch\.tv|dailymotion\.com)$/i;

/** Fills in title/description/image for link messages from the page's Open Graph tags. */
export const linkPreview = onDocumentCreated({ document: MESSAGE, timeoutSeconds: 20 }, async (event) => {
  const snap = event.data;
  const msg = snap?.data();
  if (!snap || msg?.kind !== 'link' || msg.link?.status !== 'pending') return;
  try {
    const og = await fetchPreview(String(msg.link.url));
    const domain = new URL(og.finalUrl).hostname.replace(/^www\./, '');
    await snap.ref.update({
      'link.title': og.title,
      'link.description': og.description,
      'link.image': og.image,
      'link.siteName': og.siteName,
      'link.isVideo': Boolean(msg.link.isVideo) || VIDEO_RE.test(domain),
      'link.status': 'ok',
    });
  } catch (e) {
    logger.info('link preview failed', { url: msg.link.url, error: String(e) });
    await snap.ref.update({ 'link.status': 'failed' });
  }
});

/** Push to all of one person's devices; forgets tokens that no longer work. */
async function pushTo(uid: string, data: Record<string, string>) {
  const db = getFirestore();
  const tokensSnap = await db.collection(`users/${uid}/tokens`).get();
  const tokens = tokensSnap.docs.map((d) => d.id);
  if (!tokens.length) return;
  const res = await getMessaging().sendEachForMulticast({
    tokens,
    webpush: { headers: { Urgency: 'high', TTL: '86400' }, data },
  });
  const dead = res.responses
    .map((r, i) => ({ r, t: tokens[i] }))
    .filter(({ r }) => !r.success && /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(r.error?.code || ''));
  await Promise.all(dead.map(({ t }) => db.doc(`users/${uid}/tokens/${t}`).delete()));
  logger.info('push sent', { success: res.successCount, removed: dead.length });
}

/**
 * Someone was invited by e-mail and already has an account: tell them ("Alice invited you
 * to chat on Hi"). The sender's app is unchanged, so it learns nothing about whether the
 * address has an account. Sent once per chat and address (server-only invitePushes/).
 */
export const notifyInvite = onDocumentWritten('rooms/{roomId}', async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!after) return;
  const db = getFirestore();
  await sendInvitePushes(event.params.roomId, before, after, {
    lookup: async (email) => {
      try { return (await getAuth().getUserByEmail(email)).uid; } catch { return null; }
    },
    blocked: async (uid, owner) => (await db.doc(`users/${uid}/blocked/${owner}`).get()).exists,
    claim: async (key) => {
      // Hashed, so no e-mail address is stored.
      const id = createHash('sha256').update(key).digest('hex').slice(0, 40);
      try { await db.doc(`invitePushes/${id}`).create({ at: FieldValue.serverTimestamp() }); return true; } catch { return false; }
    },
    push: (uid, data) => pushTo(uid, data),
  });
});

/** Push for a new message (see notifyMembers). */
export const notifyPartner = onDocumentCreated(MESSAGE, async (event) => {
  const msg = event.data?.data();
  // Setting changes ("… turned on disappearing messages") don't buzz anyone's phone.
  if (!msg || msg.kind === 'system') return;
  const { roomId, tabId } = event.params;
  let dropType: string | undefined;
  if (msg.kind === 'drop' && msg.dropId) {
    dropType = (await getFirestore().doc(`rooms/${roomId}/drops/${msg.dropId}`).get()).data()?.type;
  }
  await notifyMembers(roomId, tabId, msg, notificationBody({ ...msg, dropType }));
});

/** A reply in a thread: same rules as a message (mute, quiet hours), its own text. */
export const notifyThreadReply = onDocumentCreated(`${MESSAGE}/replies/{replyId}`, async (event) => {
  const reply = event.data?.data();
  if (!reply) return;
  const { roomId, tabId } = event.params;
  await notifyMembers(roomId, tabId, reply, threadBody(String(reply.text || '')));
});

/**
 * Sends a Web Push to the other member's devices. Skipped for a muted chat. During the
 * recipient's quiet hours it's held and summed up later, unless the sender marked it
 * Urgent (three a day).
 */
async function notifyMembers(roomId: string, tabId: string, msg: Record<string, any>, body: string) {
  const db = getFirestore();
  const room = (await db.doc(`rooms/${roomId}`).get()).data();
  const recipients: string[] = (room?.members || []).filter((u: string) => u !== msg.uid);
  if (!recipients.length) return;

  const sender = (await db.doc(`rooms/${roomId}/members/${msg.uid}`).get()).data();
  const first = String(sender?.name || 'Hi').split(/\s+/)[0];
  // Name the tab unless it's General, e.g. "Sam · Trip plans".
  const tabName = tabId === 'general' ? '' : String((await db.doc(`rooms/${roomId}/tabs/${tabId}`).get()).data()?.name || '');
  const title = tabName ? `${first} · ${tabName}` : first;
  const now = Date.now();

  for (const uid of recipients) {
    const c = (await db.doc(`users/${uid}/contacts/${msg.uid}`).get()).data();
    if (isMuted({ muted: c?.muted, mutedUntilMs: c?.mutedUntil?.toMillis?.() ?? null }, now)) continue;

    const settings = (await db.doc(`users/${uid}`).get()).data();
    if (isQuiet(now, settings?.quiet)) {
      let breakThrough = false;
      if (msg.urgent === true) {
        // Count the sender's urgent messages for today; the 4th and later wait too.
        // The real count lives in urgentCounts/{uid}, which no client can touch (the
        // sender could delete and re-create users/{uid}); users/{uid}.urgent is a copy
        // for the app's "N left today".
        breakThrough = await db.runTransaction(async (tx) => {
          const ref = db.doc(`urgentCounts/${msg.uid}`);
          const d = urgentDecision((await tx.get(ref)).data(), now);
          if (d.allowed) {
            tx.set(ref, d.next);
            tx.set(db.doc(`users/${msg.uid}`), { urgent: d.next }, { merge: true });
          }
          return d.allowed;
        });
      }
      if (!breakThrough) {
        await db.collection(`users/${uid}/held`).add({ roomId, tabId, from: first, at: FieldValue.serverTimestamp() });
        continue;
      }
    }
    await pushTo(uid, {
      title: msg.urgent === true ? `❗ ${title}` : title,
      body, tag: `room-${roomId}-${tabId}`, url: openUrl(roomId, tabId), room: roomId, tab: tabId,
    });
  }
}

/**
 * Every minute: sends scheduled messages that are due, and the one-line summary of
 * notifications held during quiet hours once those hours are over. (The app also
 * sends a scheduled message itself while the sender has it open; the message takes
 * the scheduled id, so it's never sent twice.)
 */
export const minuteJob = onSchedule({ schedule: 'every 1 minutes', timeoutSeconds: 50 }, async () => {
  const db = getFirestore();
  const now = Date.now();

  const scheduled = await db.collectionGroup('scheduled').get();
  const ready = due(scheduled.docs.map((d) => ({ d, sendAtMs: d.data().sendAt?.toMillis?.() ?? 0 })), now);
  for (const { d } of ready) {
    const roomRef = d.ref.parent.parent!;
    const s = d.data();
    try {
      await db.runTransaction(async (tx) => {
        const cur = await tx.get(d.ref);
        if (!cur.exists) return;
        const tab = await tx.get(roomRef.collection('tabs').doc(s.tabId));
        const room = await tx.get(roomRef);
        // Same as the rules for a message from the app: only a member, in a chat nobody
        // has left. Otherwise (left, blocked, account deleted) the scheduled one is dropped.
        const rd = room.data();
        const members: unknown[] = Array.isArray(rd?.members) ? rd!.members : [];
        if (!rd || rd.left != null || !members.includes(s.senderId)) {
          tx.delete(d.ref);
          return;
        }
        const { message, preview } = scheduledToMessage(cur.data() as any);
        const at = FieldValue.serverTimestamp();
        const exp = expiryMs(tab.data(), Date.now());
        tx.delete(d.ref);
        tx.set(roomRef.collection('tabs').doc(s.tabId).collection('messages').doc(d.id), {
          ...message, ...(exp ? { expiresAt: Timestamp.fromMillis(exp) } : {}), createdAt: at,
        });
        tx.update(roomRef.collection('tabs').doc(s.tabId), { lastMessageAt: at });
        tx.update(roomRef, { lastMessage: { id: d.id, uid: s.senderId, tabId: s.tabId, text: preview, at } });
        // The sender was active today (streaks and Rewind count rooms/{id}/days).
        tx.set(roomRef.collection('days').doc(dayKeyIn(Date.now(), room.data()?.timezone)), { uids: FieldValue.arrayUnion(s.senderId) }, { merge: true });
      });
    } catch (e) {
      logger.warn('scheduled delivery failed', { id: d.id, error: String(e) });
    }
  }

  const held = await db.collectionGroup('held').get();
  const byUser = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
  held.docs.forEach((d) => {
    const uid = d.ref.parent.parent!.id;
    byUser.set(uid, [...(byUser.get(uid) || []), d]);
  });
  for (const [uid, docs] of byUser) {
    const settings = (await db.doc(`users/${uid}`).get()).data();
    if (isQuiet(now, settings?.quiet)) continue;
    const list = docs
      .sort((a, b) => (a.data().at?.toMillis?.() ?? 0) - (b.data().at?.toMillis?.() ?? 0))
      .map((d) => d.data() as Held);
    const sum = summaryText(list);
    if (sum) {
      await pushTo(uid, { title: sum.title, body: sum.body, tag: 'quiet-summary', url: openUrl(sum.roomId, sum.tabId), room: sum.roomId, tab: sum.tabId });
    }
    await Promise.all(docs.map((d) => d.ref.delete()));
  }
  if (ready.length || held.size) logger.info('minute job', { delivered: ready.length, held: held.size });
});


/** A message removed outright (disappearing tab TTL, deleted chat): remove its files too. */
export const deleteRemovedFiles = onDocumentDeleted(MESSAGE, async (event) => {
  const paths = filesOfRemoved(event.data?.data(), event.params.roomId);
  if (!paths.length) return;
  const bucket = getStorage().bucket();
  await Promise.all(paths.map((p) => bucket.file(p).delete({ ignoreNotFound: true })));
  logger.info('deleted files of removed message', { roomId: event.params.roomId, count: paths.length });
});

/**
 * A chat deleted from the app (the last person in it removes it): the app can only
 * delete the room doc, so its tabs, messages and the rest are removed here. Each
 * deleted message then has its files removed by deleteRemovedFiles.
 */
export const deleteRoomData = onDocumentDeleted({ document: 'rooms/{roomId}', timeoutSeconds: 120 }, async (event) => {
  const db = getFirestore();
  await db.recursiveDelete(db.doc(`rooms/${event.params.roomId}`));
  logger.info('deleted data of removed chat', { roomId: event.params.roomId });
});

/**
 * "Delete for everyone": removes the message's photo from Storage too.
 * A view-once / view-twice photo that has just been used up: its file goes, and the
 * message keeps only "Opened".
 */
export const deleteMessageFiles = onDocumentUpdated(MESSAGE, async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  const bucket = getStorage().bucket();
  const paths = filesToDelete(before, after, event.params.roomId);
  if (paths.length) {
    await Promise.all(paths.map((p) => bucket.file(p).delete({ ignoreNotFound: true })));
    logger.info('deleted message files', { roomId: event.params.roomId, count: paths.length });
  }
  const once = exhaustedOnce(before, after, event.params.roomId);
  if (once) {
    await bucket.file(once).delete({ ignoreNotFound: true });
    await event.data!.after.ref.update({ 'photo.path': FieldValue.delete() });
    logger.info('view-once photo used up', { roomId: event.params.roomId });
  }
});

/**
 * Settings → Delete account. Leaves every shared chat (the other person sees that you
 * left), deletes chats only you are in, your profile and private data, then the
 * sign-in account itself. The app falls back to doing the same steps itself when
 * Cloud Functions aren't deployed (they need the Blaze plan).
 */
export const deleteAccount = onCall({ timeoutSeconds: 120 }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const db = getFirestore();
  const rooms = await db.collection('rooms').where('members', 'array-contains', uid).get();
  const plan = accountPlan(uid, rooms.docs.map((d) => ({ id: d.id, members: d.data().members })));
  for (const id of plan.leave) {
    await db.doc(`rooms/${id}`).update({ members: FieldValue.arrayRemove(uid), left: uid, invites: [] });
  }
  for (const id of plan.remove) await db.recursiveDelete(db.doc(`rooms/${id}`));
  await db.recursiveDelete(db.doc(`users/${uid}`));
  await db.doc(`urgentCounts/${uid}`).delete();
  await db.doc(`profiles/${uid}`).delete();
  await getAuth().deleteUser(uid);
  logger.info('account deleted', { left: plan.leave.length, removed: plan.remove.length });
  return { left: plan.leave.length, removed: plan.remove.length };
});
