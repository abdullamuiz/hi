import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { app, db, usingEmulators } from '../firebase';

// Loaded on demand: keeps the messaging SDK out of the first paint.
const fcm = () => import('firebase/messaging');
import { vapidKey } from '../firebase-config';

export type PushStatus = 'unsupported' | 'needs-install' | 'default' | 'granted' | 'denied';

export const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;

export async function pushStatus(): Promise<PushStatus> {
  // iOS only offers Web Push to apps added to the Home Screen (iOS 16.4+).
  if (isIOS() && !isStandalone()) return 'needs-install';
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return 'unsupported';
  if (!(await fcm().then((m) => m.isSupported()).catch(() => false))) return 'unsupported';
  return Notification.permission as PushStatus;
}

const TOKEN_KEY = 'drops.fcmToken';

/** Ask for permission (must run from a tap) and register this device's FCM token. */
export async function enablePush(uid: string): Promise<void> {
  if (usingEmulators) throw new Error('Push needs a real Firebase project — fill in src/firebase-config.ts.');
  if (vapidKey === 'REPLACE_ME') throw new Error('Add your Web Push key (vapidKey) to src/firebase-config.ts.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were not allowed.');
  const reg = await navigator.serviceWorker.ready;
  const { getMessaging, getToken } = await fcm();
  const token = await getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: reg });
  if (!token) throw new Error('Could not get a push token.');
  await setDoc(doc(db, 'users', uid, 'tokens', token), { token, ua: navigator.userAgent.slice(0, 300), updatedAt: serverTimestamp() });
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
}

/** Forget this device's token (on sign-out) so the partner's messages stop arriving here. */
export async function disablePush(uid: string): Promise<void> {
  let token: string | null = null;
  try { token = localStorage.getItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  if (!token) return;
  await deleteDoc(doc(db, 'users', uid, 'tokens', token)).catch(() => {});
  if (!usingEmulators) {
    const { getMessaging, deleteToken } = await fcm();
    await deleteToken(getMessaging(app)).catch(() => {});
  }
}
