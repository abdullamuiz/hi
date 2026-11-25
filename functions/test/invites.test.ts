import { describe, expect, it } from 'vitest';
import { inviteText, newInvites, sendInvitePushes, type InviteDeps } from '../src/invites';

function fakes(accounts: Record<string, string>, opts: { blocked?: boolean } = {}) {
  const claimed = new Set<string>();
  const pushes: Array<{ uid: string; data: Record<string, string> }> = [];
  const deps: InviteDeps = {
    lookup: async (e) => accounts[e] ?? null,
    blocked: async () => !!opts.blocked,
    claim: async (k) => (claimed.has(k) ? false : (claimed.add(k), true)),
    push: async (uid, data) => { pushes.push({ uid, data }); },
  };
  return { deps, pushes };
}

const room = (invites: string[], extra = {}) => ({ owner: 'alice', ownerName: 'Alice Smith', members: ['alice'], invites, ...extra });

describe('invite push', () => {
  it('pushes to an existing account, once', async () => {
    const { deps, pushes } = fakes({ 'bob@x.com': 'bob' });
    expect(await sendInvitePushes('r1', undefined, room(['bob@x.com']), deps)).toBe(1);
    expect(pushes[0].uid).toBe('bob');
    expect(pushes[0].data.body).toBe('Alice invited you to chat on Hi');
    expect(pushes[0].data.url).toBe('./?invite=r1');
    // Re-writing the room (e.g. a new invite code) doesn't push again…
    expect(await sendInvitePushes('r1', room(['bob@x.com']), room(['bob@x.com'], { inviteCode: 'x' }), deps)).toBe(0);
    // …nor does removing and re-adding the same address.
    expect(await sendInvitePushes('r1', room([]), room(['bob@x.com']), deps)).toBe(0);
    expect(pushes).toHaveLength(1);
  });
  it('sends nothing when no account has the address', async () => {
    const { deps, pushes } = fakes({});
    expect(await sendInvitePushes('r1', undefined, room(['nobody@x.com']), deps)).toBe(0);
    expect(pushes).toHaveLength(0);
  });
  it('skips Notes to self, full and left chats, blocked owners and yourself', async () => {
    const { deps, pushes } = fakes({ 'bob@x.com': 'bob', 'alice@x.com': 'alice' });
    expect(await sendInvitePushes('r', undefined, room(['bob@x.com'], { self: true }), deps)).toBe(0);
    expect(await sendInvitePushes('r', undefined, room(['bob@x.com'], { members: ['alice', 'carol'] }), deps)).toBe(0);
    expect(await sendInvitePushes('r', undefined, room(['bob@x.com'], { left: 'carol' }), deps)).toBe(0);
    expect(await sendInvitePushes('r', undefined, room(['alice@x.com']), deps)).toBe(0);
    const b = fakes({ 'bob@x.com': 'bob' }, { blocked: true });
    expect(await sendInvitePushes('r', undefined, room(['bob@x.com']), b.deps)).toBe(0);
    expect(pushes).toHaveLength(0);
  });
  it('a changed address is new', () => {
    expect(newInvites(room(['a@x.com']), room(['B@x.com']))).toEqual(['b@x.com']);
    expect(newInvites(room(['a@x.com']), room(['a@x.com']))).toEqual([]);
    expect(inviteText('')).toBe('Someone invited you to chat on Hi');
  });
});
