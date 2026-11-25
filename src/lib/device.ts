/**
 * Devices: which browser/app this is, and a stable id for it.
 * The id lives in localStorage, so clearing site data (or another browser) is a new device.
 */

const ID_KEY = 'hi.deviceId';

export function deviceId(): string {
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id || !/^[A-Za-z0-9_-]{12,40}$/.test(id)) {
      const b = new Uint8Array(12);
      crypto.getRandomValues(b);
      id = Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 20);
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch {
    // No storage (private mode): a per-tab id. This device shows up again next time.
    return (globalThis as any).__hiDeviceId ||= `tmp${Math.random().toString(36).slice(2, 14)}`;
  }
}

export type DeviceKind = 'phone' | 'tablet' | 'computer';

/** "Chrome on Mac", "Safari on iPhone", "Hi app on Android" … from the user agent. */
export function labelFor(ua: string, installed = false, touchPoints = 0): { label: string; kind: DeviceKind } {
  const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  const os =
    /iPhone|iPod/.test(ua) ? 'iPhone'
    : iPad ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /CrOS/.test(ua) ? 'Chromebook'
    : /Windows/.test(ua) ? 'Windows'
    : /Macintosh|Mac OS X/.test(ua) ? 'Mac'
    : /Linux/.test(ua) ? 'Linux'
    : 'a device';
  const kind: DeviceKind = os === 'iPhone' || (os === 'Android' && /Mobile/.test(ua)) ? 'phone'
    : iPad || os === 'Android' ? 'tablet' : 'computer';
  if (installed) return { label: `Hi app on ${os}`, kind };
  const browser =
    /EdgA?\//.test(ua) || /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /SamsungBrowser\//.test(ua) ? 'Samsung Internet'
    : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
    : /CriOS\//.test(ua) || /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser';
  return { label: `${browser} on ${os}`, kind };
}

/** "Active now", "Active 5 min ago", "Active 2 days ago". */
export function activeAgo(ms: number | null, now = Date.now()): string {
  if (!ms) return 'Not active yet';
  const d = Math.max(0, now - ms);
  const min = Math.round(d / 60_000);
  if (min < 15) return 'Active now';
  if (min < 60) return `Active ${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `Active ${h} h ago`;
  const days = Math.round(h / 24);
  if (days < 45) return `Active ${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  return `Active ${months} month${months === 1 ? '' : 's'} ago`;
}

/** Sign-out-others needs a sign-in that is recent and newer than every other device's. */
export function needsReauth(authTimeSec: number, otherSignIns: number[], nowMs = Date.now()): boolean {
  if (!authTimeSec) return true;
  if (nowMs - authTimeSec * 1000 > 90_000) return true;
  return otherSignIns.some((t) => t >= authTimeSec);
}

/** Pending actions that continue after an e-mail link or a sign-in redirect. */
export type DeviceAction = 'signout-others' | 'approve-device';
const ACTION_KEY = 'hi.deviceAction';
export function savePendingAction(a: DeviceAction) { try { localStorage.setItem(ACTION_KEY, a); } catch { /* ignore */ } }
export function takePendingAction(): DeviceAction | null {
  try {
    const a = localStorage.getItem(ACTION_KEY) as DeviceAction | null;
    localStorage.removeItem(ACTION_KEY);
    return a === 'signout-others' || a === 'approve-device' ? a : null;
  } catch { return null; }
}
export function peekPendingAction(): DeviceAction | null {
  try { const a = localStorage.getItem(ACTION_KEY); return a === 'signout-others' || a === 'approve-device' ? a : null; } catch { return null; }
}
