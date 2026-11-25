import { describe, expect, it } from 'vitest';
import { moveChanges, myMoves, threadDot, waitingFromLocks } from '../../src/lib/moves';

describe('your move', () => {
  it('reads whose move it is from the lock markers', () => {
    expect(waitingFromLocks([], 'a', 'b')).toBeNull();
    expect(waitingFromLocks(['b_answer'], 'a', 'b')).toBe('me');
    expect(waitingFromLocks(['a_answer'], 'a', 'b')).toBe('partner');
    expect(waitingFromLocks(['a_answer', 'b_answer'], 'a', 'b')).toBeNull();
    // Round by round (This or That): they're ahead on round 2.
    expect(waitingFromLocks(['a_r0', 'b_r0', 'b_r1'], 'a', 'b')).toBe('me');
  });
  it('writes only what differs', () => {
    expect(moveChanges({}, 'd', 'a', 'b', 'partner')).toEqual([['b', true]]);
    expect(moveChanges({ a: { d: true } }, 'd', 'a', 'b', 'partner')).toEqual([['a', false], ['b', true]]);
    expect(moveChanges({ b: { d: true } }, 'd', 'a', 'b', 'partner')).toEqual([]);
    expect(moveChanges({ a: { d: true }, b: { d: true } }, 'd', 'a', 'b', null)).toEqual([['a', false], ['b', false]]);
  });
  it('counts my waiting Drops', () => {
    expect(myMoves({ a: { d1: true, d2: true }, b: { d3: true } }, 'a')).toBe(2);
    expect(myMoves(undefined, 'a')).toBe(0);
  });
  it('thread dot: only their replies newer than my last look', () => {
    expect(threadDot(200, 'b', 'a', 100)).toBe(true);
    expect(threadDot(200, 'a', 'a', 100)).toBe(false);
    expect(threadDot(100, 'b', 'a', 200)).toBe(false);
    expect(threadDot(0, null, 'a', 0)).toBe(false);
  });
});
