import { describe, expect, it } from 'vitest';
import { accountPlan } from '../src/account';

describe('accountPlan', () => {
  it('leaves shared chats and removes chats only I am in', () => {
    expect(accountPlan('a', [
      { id: 'shared', members: ['a', 'b'] },
      { id: 'solo', members: ['a'] },
      { id: 'other', members: ['b', 'c'] },
      { id: 'odd', members: 'a' },
    ])).toEqual({ leave: ['shared'], remove: ['solo'] });
  });
  it('handles no chats at all', () => {
    expect(accountPlan('a', [])).toEqual({ leave: [], remove: [] });
  });
});
