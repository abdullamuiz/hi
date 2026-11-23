import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { fetchPreview } from './og.js';
import { notificationBody } from './notify.js';

initializeApp();
// Small, capped instances keep a two-person app comfortably inside the free tier.
setGlobalOptions({ region: 'us-central1', maxInstances: 3, memory: '256MiB' });

const MESSAGE = 'rooms/{roomId}/messages/{msgId}';
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

/** Sends a Web Push to the other member's devices. */
export const notifyPartner = onDocumentCreated(MESSAGE, async (event) => {
  const msg = event.data?.data();
  if (!msg) return;
  const { roomId } = event.params;
  const db = getFirestore();
  const room = (await db.doc(`rooms/${roomId}`).get()).data();
  const recipients: string[] = (room?.members || []).filter((u: string) => u !== msg.uid);
  if (!recipients.length) return;

  const sender = (await db.doc(`rooms/${roomId}/members/${msg.uid}`).get()).data();
  const title = String(sender?.name || 'Drops Chat').split(/\s+/)[0];
  let dropType: string | undefined;
  if (msg.kind === 'drop' && msg.dropId) {
    dropType = (await db.doc(`rooms/${roomId}/drops/${msg.dropId}`).get()).data()?.type;
  }
  const body = notificationBody({ ...msg, dropType });

  for (const uid of recipients) {
    const tokensSnap = await db.collection(`users/${uid}/tokens`).get();
    const tokens = tokensSnap.docs.map((d) => d.id);
    if (!tokens.length) continue;
    const res = await getMessaging().sendEachForMulticast({
      tokens,
      webpush: {
        headers: { Urgency: 'high', TTL: '86400' },
        data: { title, body, tag: `room-${roomId}`, url: './' },
      },
    });
    const dead = res.responses
      .map((r, i) => ({ r, t: tokens[i] }))
      .filter(({ r }) => !r.success && /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(r.error?.code || ''));
    await Promise.all(dead.map(({ t }) => db.doc(`users/${uid}/tokens/${t}`).delete()));
    logger.info('push sent', { roomId, success: res.successCount, removed: dead.length });
  }
});

