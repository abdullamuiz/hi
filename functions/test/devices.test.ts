import { describe, expect, it } from 'vitest';
import { alertPayload, alertTargets, emailApprovalOk, Refused, signOutOthersPlan, tokensOfDevice } from '../src/devices';

const tokens = [
  { id: 't-primary', deviceId: 'primary01' },
  { id: 't-laptop', deviceId: 'laptop001' },
  { id: 't-new', deviceId: 'newdev001' },
  { id: 't-old' },
];

describe('new sign-in alert', () => {
  it('goes to the primary device only', () => {
    expect(alertTargets('newdev001', 'primary01', tokens)).toEqual(['t-primary']);
  });
  it('without a primary (or one with no token), every other device hears about it', () => {
    expect(alertTargets('newdev001', null, tokens)).toEqual(['t-primary', 't-laptop', 't-old']);
    expect(alertTargets('newdev001', 'gone00001', tokens)).toEqual(['t-primary', 't-laptop', 't-old']);
  });
  it('says what signed in, and asks for approval when it is pending', () => {
    expect(alertPayload('newdev001', { label: 'Chrome on Windows' }).body).toBe('New sign-in: Chrome on Windows');
    expect(alertPayload('newdev001', { label: 'Chrome on Windows', status: 'pending' }).body).toBe('Approve new sign-in? Chrome on Windows');
    expect(alertPayload('newdev001', {}).url).toBe('./?device=newdev001');
  });
  it('a signed-out device loses its own tokens only', () => {
    expect(tokensOfDevice('laptop001', { pushToken: 't-old' }, tokens)).toEqual(['t-laptop', 't-old']);
  });
});

describe('sign out all other devices', () => {
  const now = 1_800_000_000;
  const devices = [
    { id: 'me0000001', status: 'active' as const, signedInAt: now - 30 },
    { id: 'laptop001', status: 'active' as const, signedInAt: now - 86_400 },
    { id: 'gone00001', status: 'signedOut' as const, signedInAt: now - 99 },
  ];
  it('cuts off every older sign-in and signs the others out', () => {
    expect(signOutOthersPlan('me0000001', now - 30, now, devices)).toEqual({ cutoff: now - 30, signOut: ['laptop001'] });
  });
  it('needs a recent sign-in that is newer than the other devices', () => {
    expect(() => signOutOthersPlan('me0000001', now - 3600, now, devices)).toThrow(Refused);
    const newer = [...devices, { id: 'thief0001', status: 'active' as const, signedInAt: now - 5 }];
    expect(() => signOutOthersPlan('me0000001', now - 30, now, newer)).toThrow(/more recently/);
  });
});

describe('approve by e-mail', () => {
  const now = 1_800_000_000;
  it('needs a fresh e-mail-link sign-in', () => {
    expect(emailApprovalOk({ auth_time: now - 60, firebase: { sign_in_provider: 'password' } }, now)).toBe(true);
    expect(emailApprovalOk({ auth_time: now - 60, firebase: { sign_in_provider: 'google.com' } }, now)).toBe(false);
    expect(emailApprovalOk({ auth_time: now - 3600, firebase: { sign_in_provider: 'password' } }, now)).toBe(false);
  });
});
