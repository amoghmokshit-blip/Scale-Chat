import { applyVoteLocally } from '@/features/chat/data/poll-vote-math';
import type { PollMessage } from '@/features/chat/types';

/**
 * applyVoteLocally — optimistic vote math (Tranche 2.F).
 *
 * The api repo flips the cached aggregate using this BEFORE the server ack
 * lands, then reconciles with the authoritative aggregate from the
 * `poll:voted` socket. The math has to match the server-side branch (single-
 * select replace vs multi-select diff) so the bubble doesn't flicker on
 * reconcile.
 */

const A: PollMessage['options'][number] = { id: 'opt-a', ordinal: 0, label: 'A', count: 0, votedByMe: false };
const B: PollMessage['options'][number] = { id: 'opt-b', ordinal: 1, label: 'B', count: 0, votedByMe: false };
const C: PollMessage['options'][number] = { id: 'opt-c', ordinal: 2, label: 'C', count: 0, votedByMe: false };

describe('applyVoteLocally — single-select', () => {
  it('first vote: my chosen option gains +1 + votedByMe=true', () => {
    const out = applyVoteLocally([A, B], ['opt-a'], false);
    expect(out[0]).toEqual({ ...A, count: 1, votedByMe: true });
    expect(out[1]).toEqual(B);
  });

  it('revote: prior option goes -1 + votedByMe=false, new option +1 + true', () => {
    const before: PollMessage['options'] = [
      { ...A, count: 1, votedByMe: true },
      B,
    ];
    const out = applyVoteLocally(before, ['opt-b'], false);
    expect(out[0]).toEqual({ ...A, count: 0, votedByMe: false });
    expect(out[1]).toEqual({ ...B, count: 1, votedByMe: true });
  });

  it('count never goes negative even on stale aggregates', () => {
    const before: PollMessage['options'] = [{ ...A, count: 0, votedByMe: true }]; // weird state
    const out = applyVoteLocally(before, [], false);
    expect(out[0]?.count).toBe(0);
    expect(out[0]?.votedByMe).toBe(false);
  });
});

describe('applyVoteLocally — multi-select', () => {
  it('vote [A,B] from no prior selection → both +1 + votedByMe=true', () => {
    const out = applyVoteLocally([A, B, C], ['opt-a', 'opt-b'], true);
    expect(out[0]?.count).toBe(1);
    expect(out[0]?.votedByMe).toBe(true);
    expect(out[1]?.count).toBe(1);
    expect(out[1]?.votedByMe).toBe(true);
    expect(out[2]?.count).toBe(0);
    expect(out[2]?.votedByMe).toBe(false);
  });

  it('diff [A,B] → [B,C]: A drops to 0/false, B stays 1/true, C jumps to 1/true', () => {
    const before: PollMessage['options'] = [
      { ...A, count: 1, votedByMe: true },
      { ...B, count: 1, votedByMe: true },
      C,
    ];
    const out = applyVoteLocally(before, ['opt-b', 'opt-c'], true);
    expect(out[0]).toEqual({ ...A, count: 0, votedByMe: false });
    expect(out[1]).toEqual({ ...B, count: 1, votedByMe: true });
    expect(out[2]).toEqual({ ...C, count: 1, votedByMe: true });
  });

  it('idempotent: same vote applied again is a no-op', () => {
    const before: PollMessage['options'] = [
      { ...A, count: 1, votedByMe: true },
      B,
    ];
    const out = applyVoteLocally(before, ['opt-a'], true);
    expect(out).toEqual(before);
  });
});
