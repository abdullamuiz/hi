/** Share-link invites: ?join=<roomId>&code=<secret>&from=<name>&u=<owner uid>. */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** A random 22-character code (about 128 bits). */
export function makeInviteCode(len = 22, rand: (n: number) => Uint8Array = defaultRandom): string {
  const bytes = rand(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function defaultRandom(n: number) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export interface JoinRequest {
  roomId: string;
  code: string;
  /** Inviter's first name, for display only. */
  from: string;
  /** Inviter's uid, used to spot a chat you already have with them. */
  owner: string;
}

export function inviteLink(base: string, r: JoinRequest): string {
  const u = new URL(base);
  u.search = '';
  u.hash = '';
  u.searchParams.set('join', r.roomId);
  u.searchParams.set('code', r.code);
  if (r.from) u.searchParams.set('from', r.from.slice(0, 40));
  if (r.owner) u.searchParams.set('u', r.owner);
  return u.toString();
}

export function parseJoin(search: string): JoinRequest | null {
  const p = new URLSearchParams(search);
  const roomId = p.get('join') || '';
  const code = p.get('code') || '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(roomId) || !/^[A-Za-z0-9_-]{16,64}$/.test(code)) return null;
  return { roomId, code, from: (p.get('from') || '').slice(0, 40), owner: (p.get('u') || '').slice(0, 128) };
}

// A link opened before signing in has to survive the sign-in (Google redirect, or an
// e-mail link that may open in another tab), so it's kept in localStorage for a day.
const KEY = 'hi.pendingJoin';
const DAY = 86_400_000;

export function savePendingJoin(r: JoinRequest, now = Date.now()) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...r, at: now })); } catch { /* ignore */ }
}

export function loadPendingJoin(now = Date.now()): JoinRequest | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || now - Number(v.at) > DAY) { localStorage.removeItem(KEY); return null; }
    return parseJoin(`?join=${encodeURIComponent(v.roomId)}&code=${encodeURIComponent(v.code)}&from=${encodeURIComponent(v.from || '')}&u=${encodeURIComponent(v.owner || '')}`);
  } catch { return null; }
}

export function clearPendingJoin() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
