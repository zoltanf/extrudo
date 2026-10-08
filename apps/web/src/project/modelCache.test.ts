import { type BodyId, createDocument, createModelStore } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { followModelCache } from './modelCache';

const doc = createDocument({ name: 'T', now: '2026-10-08T00:00:00.000Z' });
const bodies = (...ids: string[]) =>
  Object.fromEntries(ids.map((id) => [id, {}])) as Record<BodyId, object>;

function setup(known?: string[]) {
  const model = createModelStore<object>();
  const writes: string[][] = [];
  const stop = followModelCache(
    model,
    async (ids) => {
      writes.push(ids);
    },
    known,
  );
  const finish = (...ids: string[]) =>
    model.getState().computed({ features: {}, bodies: bodies(...ids), doc });
  return { model, writes, stop, finish };
}

describe('followModelCache', () => {
  it('writes on change only', () => {
    const { model, writes, finish } = setup();
    finish('a:0', 'b:0');
    finish('a:0', 'b:0');
    model.getState().computing();
    finish('a:0', 'b:0');
    expect(writes).toEqual([['a:0', 'b:0']]);
    finish('a:0');
    expect(writes).toEqual([['a:0', 'b:0'], ['a:0']]);
  });
  it('does not rewrite what storage already holds', () => {
    const { writes, finish } = setup(['a:0']);
    finish('a:0');
    expect(writes).toEqual([]);
    finish('a:0', 'b:0');
    expect(writes).toHaveLength(1);
  });
  it('ignores a failed or running recompute and stops when asked', () => {
    const { model, writes, stop, finish } = setup();
    model.getState().computing();
    model.getState().failed('boom');
    expect(writes).toEqual([]);
    stop();
    finish('a:0');
    expect(writes).toEqual([]);
  });
});
