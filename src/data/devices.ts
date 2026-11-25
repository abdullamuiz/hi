import {
  collection, doc, getDoc, onSnapshot, query, serverTimestamp, setDoc, Timestamp, updateDoc, where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  GoogleAuthProvider, reauthenticateWithPopup, reauthenticateWithRedirect, type User,
} from 'firebase/auth';
import { auth, db, functions } from '../firebase';
import { deviceId, labelFor, needsReauth, savePendingAction, type DeviceKind } from '../lib/device';
import { sendEmailLink } from './auth';
import { isStandalone } from './push';

export type DeviceStatus = 'active' | 'pending' | 'signedOut';

export interface Device {
  id: string;
  label: string;
  kind: DeviceKind;
  customName?: string;
  status: DeviceStatus;
  createdAt: Timestamp | null;
  lastActiveAt: Timestamp | null;
  /** auth_time (seconds) of the sign-in this device registered with. */
  signedInAt: number;
  pushToken?: string | null;
}

/** Account-wide security settings, on users/{uid}. */
export interface Security {
  primaryDevice: string | null;
  deviceProtection: boolean;
}

const devCol = (uid: string) => collection(db, 'users', uid, 'devices');
const devRef = (uid: string, id: string) => doc(db, 'users', uid, 'devices', id);
const userRef = (uid: string) => doc(db, 'users', uid);

export const nameOf = (d: Pick<Device, 'customName' | 'label'>) => d.customName?.trim() || d.label;

function toDevice(id: string, x: any): Device {
  return {
    id,
    label: x.label || 'A device',
    kind: x.kind || 'computer',
    customName: x.customName || undefined,
    status: x.status || 'active',
    createdAt: x.createdAt ?? null,
    lastActiveAt: x.lastActiveAt ?? null,
    signedInAt: x.signedInAt || 0,
    pushToken: x.pushToken ?? null,
  };
}

async function authTime(user: User): Promise<number> {
  const t = await user.getIdTokenResult();
  return Math.floor(new Date(t.authTime).getTime() / 1000);
}

/**
 * Called once after sign-in. Creates this device's entry, or refreshes it.
 * With device protection on (and a primary set elsewhere), a new device starts as "pending".
 */
export async function registerDevice(user: User): Promise<void> {
  const id = deviceId();
  const { label, kind } = labelFor(navigator.userAgent, isStandalone(), navigator.maxTouchPoints || 0);
  const ref = devRef(user.uid, id);
  const at = await authTime(user);
  const existing = await getDoc(ref).catch(() => null);
  if (existing?.exists()) {
    const d = existing.data();
    const patch: Record<string, unknown> = { lastActiveAt: serverTimestamp() };
    if (d.label !== label) patch.label = label;
    if ((d.signedInAt || 0) < at) patch.signedInAt = at;
    // A device signed out remotely that signs in again starts over (and may need approval again).
    if (d.status === 'signedOut') patch.status = await startStatus(user.uid, id);
    await updateDoc(ref, patch);
    return;
  }
  await setDoc(ref, {
    label, kind, status: await startStatus(user.uid, id),
    createdAt: serverTimestamp(), lastActiveAt: serverTimestamp(), signedInAt: at,
  });
}

async function startStatus(uid: string, id: string): Promise<DeviceStatus> {
  const u = await getDoc(userRef(uid)).catch(() => null);
  const x = u?.data() || {};
  return x.deviceProtection === true && x.primaryDevice && x.primaryDevice !== id ? 'pending' : 'active';
}

/** "Active" time, written at most every 10 minutes (presence stays cheap; see docs/SCALING.md). */
let lastTouch = 0;
export function touchDevice(uid: string) {
  if (Date.now() - lastTouch < 10 * 60_000) return;
  lastTouch = Date.now();
  updateDoc(devRef(uid, deviceId()), { lastActiveAt: serverTimestamp() }).catch(() => {});
}

/** This device's own entry. onGone fires when it was signed out remotely (or can't be read). */
export function watchThisDevice(uid: string, cb: (d: Device | null) => void, onGone: () => void) {
  const id = deviceId();
  return onSnapshot(devRef(uid, id), (s) => {
    const d = s.exists() ? toDevice(id, s.data()) : null;
    if (d?.status === 'signedOut') onGone(); else cb(d);
  }, (e) => { if ((e as any)?.code === 'permission-denied') onGone(); });
}

export function watchDevices(uid: string, cb: (list: Device[]) => void) {
  return onSnapshot(devCol(uid), (s) => {
    const list = s.docs.map((d) => toDevice(d.id, d.data())).filter((d) => d.status !== 'signedOut');
    list.sort((a, b) => (b.lastActiveAt?.toMillis() || 0) - (a.lastActiveAt?.toMillis() || 0));
    cb(list);
  }, () => cb([]));
}

/** Devices waiting for approval (shown to the primary device). */
export function watchPending(uid: string, cb: (list: Device[]) => void) {
  return onSnapshot(query(devCol(uid), where('status', '==', 'pending')),
    (s) => cb(s.docs.map((d) => toDevice(d.id, d.data()))), () => cb([]));
}

export function watchSecurity(uid: string, cb: (s: Security) => void) {
  return onSnapshot(userRef(uid), (s) => {
    const x = s.data() || {};
    cb({ primaryDevice: x.primaryDevice || null, deviceProtection: x.deviceProtection === true });
  }, () => cb({ primaryDevice: null, deviceProtection: false }));
}

export const renameDevice = (uid: string, id: string, name: string) =>
  updateDoc(devRef(uid, id), { customName: name.trim().slice(0, 40) });

export const makePrimary = (uid: string, id: string) =>
  setDoc(userRef(uid), { primaryDevice: id }, { merge: true });

/** Turning protection on makes this device the primary if there is none. */
export async function setProtection(uid: string, on: boolean, current: Security) {
  await setDoc(userRef(uid), {
    deviceProtection: on,
    ...(on && !current.primaryDevice ? { primaryDevice: deviceId() } : {}),
  }, { merge: true });
}

export const approveDevice = (uid: string, id: string) => updateDoc(devRef(uid, id), { status: 'active' });

/** Sign one device out. It signs itself out when it sees this; the server drops its push tokens. */
export const signOutDevice = (uid: string, id: string) => updateDoc(devRef(uid, id), { status: 'signedOut' });

/** Records which push token belongs to this device (so pushes can target the primary). */
export function linkPushToken(uid: string, token: string) {
  updateDoc(devRef(uid, deviceId()), { pushToken: token }).catch(() => {});
}

// ---------------------------------------------------------------- sign out everywhere else

export type SignOutOthersResult = { done: true; count: number } | { done: false; pending: 'email' | 'redirect' };

/**
 * Signs out every other device, enforced: the server records a cut-off and the database
 * rules refuse any sign-in older than it. This device first proves a fresh sign-in
 * (Google pop-up, or an e-mail link for e-mail accounts).
 */
export async function signOutOthers(user: User, others: Device[]): Promise<SignOutOthersResult> {
  const at = await authTime(user);
  if (needsReauth(at, others.map((d) => d.signedInAt))) {
    const google = user.providerData.some((p) => p.providerId === 'google.com');
    if (google) {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ login_hint: user.email || '' });
      if (isStandalone()) {
        savePendingAction('signout-others');
        await reauthenticateWithRedirect(user, provider);
        return { done: false, pending: 'redirect' };
      }
      await reauthenticateWithPopup(user, provider);
    } else {
      if (!user.email) throw new Error('This account has no e-mail to confirm with.');
      savePendingAction('signout-others');
      await sendEmailLink(user.email);
      return { done: false, pending: 'email' };
    }
  }
  return finishSignOutOthers();
}

export async function finishSignOutOthers(): Promise<SignOutOthersResult> {
  await auth.currentUser?.getIdToken(true);
  const res = await httpsCallable<{ deviceId: string }, { count: number }>(functions, 'signOutOthers')({ deviceId: deviceId() });
  return { done: true, count: res.data.count };
}

/** Lost the primary device: approve this one with an e-mail link instead. */
export async function requestEmailApproval(user: User) {
  if (!user.email) throw new Error('This account has no e-mail address.');
  savePendingAction('approve-device');
  await sendEmailLink(user.email);
}

export async function finishEmailApproval() {
  await auth.currentUser?.getIdToken(true);
  await httpsCallable<{ deviceId: string }, { ok: boolean }>(functions, 'approveDeviceByEmail')({ deviceId: deviceId() });
}
