import { beforeEach, describe, expect, it } from 'vitest';
import { clearPendingJoin, inviteLink, loadPendingJoin, makeInviteCode, parseJoin, savePendingJoin } from '../../src/lib/invite';

describe('makeInviteCode', () => {
  it('makes long URL-safe codes that differ', () => {
    const a = makeInviteCode();
    const b = makeInviteCode();
    expect(a).toMatch(/^[A-Za-z0-9]{22}$/);
    expect(a).not.toBe(b);
  });
  it('maps random bytes onto the alphabet', () => {
    expect(makeInviteCode(4, () => new Uint8Array([0, 1, 2, 3]))).toBe('ABCD');
  });
});

describe('invite links', () => {
  const r = { roomId: 'room_1', code: 'abcdefghijklmnopqrst', from: 'Alice', owner: 'uidA' };
  it('round-trips through the URL', () => {
    const url = inviteLink('https://hi-dropchat.web.app/?tab=x#y', r);
    expect(url).toBe('https://hi-dropchat.web.app/?join=room_1&code=abcdefghijklmnopqrst&from=Alice&u=uidA');
    expect(parseJoin(new URL(url).search)).toEqual(r);
  });
  it('rejects malformed links', () => {
    expect(parseJoin('?join=r1&code=short')).toBeNull();
    expect(parseJoin('?join=../x&code=abcdefghijklmnopqrst')).toBeNull();
    expect(parseJoin('?tab=general')).toBeNull();
  });
});

describe('pending join', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    };
  });
  const r = { roomId: 'r1', code: 'abcdefghijklmnopqrst', from: 'Al', owner: 'u1' };
  it('survives sign-in, for a day', () => {
    savePendingJoin(r, 1000);
    expect(loadPendingJoin(2000)).toEqual(r);
    expect(loadPendingJoin(1000 + 86_400_001)).toBeNull();
  });
  it('can be cleared', () => {
    savePendingJoin(r);
    clearPendingJoin();
    expect(loadPendingJoin()).toBeNull();
  });
});
