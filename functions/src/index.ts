import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';
import { getStorage } from 'firebase-admin/storage';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentCreated, onDocumentDeleted, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { fetchPreview } from './og.js';
import { notificationBody, openUrl } from './notify.js';
import { filesOfRemoved, filesToDelete } from './cleanup.js';
import { accountPlan } from './account.js';
import { due, expiryMs, isMuted, isQuiet, scheduledToMessage, summaryText, urgentDecision, type Held } from './delivery.js';

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
 * Sends a Web Push to the other member's devices. Skipped for a muted chat. During the
 * recipient's quiet hours it's held and summed up later, unless the sender marked it
 * Urgent (three a day).
 */
export const notifyPartner = onDocumentCreated(MESSAGE, async (event) => {
  const msg = event.data?.data();
  // Setting changes ("… turned on disappearing messages") don't buzz anyone's phone.
  if (!msg || msg.kind === 'system') return;
  const { roomId, tabId } = event.params;
  const db = getFirestore();
  const room = (await db.doc(`rooms/${roomId}`).get()).data();
  const recipients: string[] = (room?.members || []).filter((u: string) => u !== msg.uid);
  if (!recipients.length) return;

  const sender = (await db.doc(`rooms/${roomId}/members/${msg.uid}`).get()).data();
  const first = String(sender?.name || 'Hi').split(/\s+/)[0];
  // Name the tab unless it's General, e.g. "Sam · Trip plans".
  const tabName = tabId === 'general' ? '' : String((await db.doc(`rooms/${roomId}/tabs/${tabId}`).get()).data()?.name || '');
  const title = tabName ? `${first} · ${tabName}` : first;
  let dropType: string | undefined;
  if (msg.kind === 'drop' && msg.dropId) {
    dropType = (await db.doc(`rooms/${roomId}/drops/${msg.dropId}`).get()).data()?.type;
  }
  const body = notificationBody({ ...msg, dropType });
  const now = Date.now();

  for (const uid of recipients) {
    const c = (await db.doc(`users/${uid}/contacts/${msg.uid}`).get()).data();
    if (isMuted({ muted: c?.muted, mutedUntilMs: c?.mutedUntil?.toMillis?.() ?? null }, now)) continue;

    const settings = (await db.doc(`users/${uid}`).get()).data();
    if (isQuiet(now, settings?.quiet)) {
      let breakThrough = false;
      if (msg.urgent === true) {
        // Count the sender's urgent messages for today; the 4th and later wait too.
        breakThrough = await db.runTransaction(async (tx) => {
          const ref = db.doc(`users/${msg.uid}`);
          const d = urgentDecision((await tx.get(ref)).data()?.urgent, now);
          if (d.allowed) tx.set(ref, { urgent: d.next }, { merge: true });
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
});

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
        const { message, preview } = scheduledToMessage(cur.data() as any);
        const at = FieldValue.serverTimestamp();
        const exp = expiryMs(tab.data(), Date.now());
        tx.delete(d.ref);
        tx.set(roomRef.collection('tabs').doc(s.tabId).collection('messages').doc(d.id), {
          ...message, ...(exp ? { expiresAt: Timestamp.fromMillis(exp) } : {}), createdAt: at,
        });
        tx.update(roomRef.collection('tabs').doc(s.tabId), { lastMessageAt: at });
        tx.update(roomRef, { lastMessage: { id: d.id, uid: s.senderId, tabId: s.tabId, text: preview, at } });
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

/** "Delete for everyone": removes the message's photo from Storage too. */
export const deleteMessageFiles = onDocumentUpdated(MESSAGE, async (event) => {
  const paths = filesToDelete(event.data?.before.data(), event.data?.after.data(), event.params.roomId);
  if (!paths.length) return;
  const bucket = getStorage().bucket();
  await Promise.all(paths.map((p) => bucket.file(p).delete({ ignoreNotFound: true })));
  logger.info('deleted message files', { roomId: event.params.roomId, count: paths.length });
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
  await db.doc(`profiles/${uid}`).delete();
  await getAuth().deleteUser(uid);
  logger.info('account deleted', { left: plan.leave.length, removed: plan.remove.length });
  return { left: plan.leave.length, removed: plan.remove.length };
});
