/** Devices: new sign-in alerts, remote sign-out, "sign out all other devices", e-mail approval. */

export interface DeviceDoc {
  label?: string;
  customName?: string;
  status?: 'active' | 'pending' | 'signedOut';
  signedInAt?: number;
  pushToken?: string | null;
}
export interface TokenDoc { id: string; deviceId?: string }

/** Which push tokens hear about a new device: the primary's, else every other device's. */
export function alertTargets(newId: string, primary: string | null | undefined, tokens: TokenDoc[]): string[] {
  if (primary && primary !== newId) {
    const own = tokens.filter((t) => t.deviceId === primary).map((t) => t.id);
    if (own.length) return own;
  }
  return tokens.filter((t) => t.deviceId !== newId).map((t) => t.id);
}

export function alertPayload(id: string, d: DeviceDoc): Record<string, string> {
  const name = d.customName || d.label || 'a new device';
  return {
    title: 'Hi',
    body: d.status === 'pending' ? `Approve new sign-in? ${name}` : `New sign-in: ${name}`,
    tag: `device-${id}`,
    url: `./?device=${encodeURIComponent(id)}`,
    device: id,
  };
}

/** Tokens to forget when a device is signed out (its own, matched by device id or pushToken). */
export function tokensOfDevice(id: string, d: DeviceDoc | undefined, tokens: TokenDoc[]): string[] {
  return tokens.filter((t) => t.deviceId === id || (d?.pushToken && t.id === d.pushToken)).map((t) => t.id);
}

export class Refused extends Error {
  constructor(public code: 'reauth' | 'not-allowed', msg: string) { super(msg); }
}

/**
 * "Sign out all other devices": the caller must have signed in within the last 10 minutes and
 * more recently than any other active device. The cut-off becomes the caller's sign-in time, so
 * every older sign-in (all the others) is refused by the database rules from now on.
 */
export function signOutOthersPlan(
  callerDevice: string, authTime: number, nowSec: number,
  devices: Array<{ id: string } & DeviceDoc>,
): { cutoff: number; signOut: string[] } {
  if (!authTime || nowSec - authTime > 600) throw new Refused('reauth', 'Confirm it’s you first.');
  const others = devices.filter((d) => d.id !== callerDevice && d.status !== 'signedOut');
  if (others.some((d) => (d.signedInAt || 0) > authTime)) throw new Refused('reauth', 'Another device signed in more recently. Confirm it’s you first.');
  return { cutoff: authTime, signOut: others.map((d) => d.id) };
}

/** Approving a device by e-mail needs a fresh e-mail-link sign-in on that device. */
export function emailApprovalOk(token: { auth_time?: number; firebase?: { sign_in_provider?: string } }, nowSec: number): boolean {
  const provider = token.firebase?.sign_in_provider;
  return (provider === 'password' || provider === 'emailLink')
    && typeof token.auth_time === 'number' && nowSec - token.auth_time <= 900;
}
