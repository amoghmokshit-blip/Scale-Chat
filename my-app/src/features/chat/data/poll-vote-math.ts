import type { PollMessage } from '../types';

/**
 * Optimistic-vote math for the PollBubble (Tranche 2.F).
 *
 * Pure function — given the current `options[]` and the FULL post-tap
 * selection set, return the new `options[]` with `count` + `votedByMe`
 * adjusted. Branches on `multiSelect`:
 *
 *   - **single-select:** at most one option carries `votedByMe`. Tapping a
 *     different option flips the prior one off (-1 count) and the new one on
 *     (+1 count). Tapping an already-checked option is a no-op (single-select
 *     can't deselect — caller is responsible for not invoking it in that case).
 *
 *   - **multi-select:** `votedByMe` becomes membership of `nextSelectedIds`;
 *     options that newly join → +1, options that newly leave → -1.
 *
 * Lives in its own file so the api repo can call it AND the Jest suite can
 * cover the math without pulling in MMKV / socket.io / expo-constants
 * transitively via `api-chat-repository.ts`.
 */
export function applyVoteLocally(
  options: PollMessage['options'],
  nextSelectedIds: string[],
  _multiSelect: boolean,
): PollMessage['options'] {
  const selected = new Set(nextSelectedIds);
  return options.map((opt) => {
    const wantsVote = selected.has(opt.id);
    if (wantsVote && !opt.votedByMe) {
      return { ...opt, count: opt.count + 1, votedByMe: true };
    }
    if (!wantsVote && opt.votedByMe) {
      return { ...opt, count: Math.max(0, opt.count - 1), votedByMe: false };
    }
    return opt;
  });
}
