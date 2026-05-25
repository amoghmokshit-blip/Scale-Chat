import { ChatCopy } from '@/features/chat/copy';

/**
 * ChatCopy structural test — guards against missing-key bugs that would
 * otherwise surface only when a specific screen is opened and a copy string
 * resolves to `undefined`.
 *
 * Strategy: assert every leaf is either a non-empty string OR a function that
 * returns a non-empty string when called with a representative argument.
 */

type CopyLeaf = string | ((...args: never[]) => string);

function isCopyLeaf(v: unknown): v is CopyLeaf {
  return typeof v === 'string' || typeof v === 'function';
}

function walk(node: unknown, path: string[] = []): { path: string; value: CopyLeaf }[] {
  if (isCopyLeaf(node)) return [{ path: path.join('.'), value: node }];
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([k, v]) => walk(v, [...path, k]));
  }
  return [];
}

describe('ChatCopy', () => {
  const leaves = walk(ChatCopy);

  it('contains at least the expected top-level sections', () => {
    expect(Object.keys(ChatCopy)).toEqual(
      expect.arrayContaining(['list', 'thread', 'attachments', 'recorder', 'comingSoon'])
    );
  });

  it('has no empty string leaves', () => {
    const empty = leaves.filter((l) => typeof l.value === 'string' && l.value.length === 0);
    expect(empty).toEqual([]);
  });

  it('every callable leaf returns a non-empty string', () => {
    const callables = leaves.filter((l) => typeof l.value === 'function');
    expect(callables.length).toBeGreaterThan(0); // sanity: we have helpers like `greeting(name)`
    for (const { path, value } of callables) {
      const fn = value as (...a: unknown[]) => unknown;
      // Pick a representative argument by name so callables that expect strings
      // don't blow up. Counts get a sample number.
      const sample = path.endsWith('Count') ? 3 : 'Test';
      const out = fn(sample);
      expect(typeof out).toBe('string');
      expect((out as string).length).toBeGreaterThan(0);
    }
  });

  it('comingSoon entries each carry a title + body so the modal can render', () => {
    for (const [key, value] of Object.entries(ChatCopy.comingSoon)) {
      expect(value).toMatchObject({
        title: expect.any(String),
        body: expect.any(String),
      });
      expect((value as { title: string }).title.length).toBeGreaterThan(0);
      expect((value as { body: string }).body.length).toBeGreaterThan(0);
      expect(key).toMatch(/^[a-z][a-zA-Z]+$/); // kebab guard against typos
    }
  });

  it('matches the expected snapshot (regression guard against accidental copy changes)', () => {
    // Snapshot the keys + types only, not the actual strings — string changes
    // are intentional and should not blow up the snapshot test. This guards
    // structural drift: a deleted section / renamed leaf trips the snapshot.
    const shape = leaves
      .map((l) => `${l.path}:${typeof l.value}`)
      .sort();
    expect(shape).toMatchSnapshot();
  });
});
