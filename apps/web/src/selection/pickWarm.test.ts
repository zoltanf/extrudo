import { describe, expect, it } from 'vitest';
import { hasPickIndex, meshBvh, warmPickIndex } from './pick';
import { boxMesh } from './testing';

/** A fake idle queue: callbacks run when the test says so. */
function idleQueue() {
  const queue: (() => void)[] = [];
  return {
    idle: (run: () => void) => {
      queue.push(run);
      return () => {
        const i = queue.indexOf(run);
        if (i >= 0) queue.splice(i, 1);
      };
    },
    step: () => queue.shift()?.(),
    get size() {
      return queue.length;
    },
  };
}

describe('warmPickIndex (ADR-0102 §2)', () => {
  it('builds one mesh per idle callback, and picking then uses that index', () => {
    const a = boxMesh();
    const b = boxMesh([0, 0, 0], [5, 5, 5]);
    const q = idleQueue();
    warmPickIndex([a, b], undefined, q.idle);
    expect(hasPickIndex(a)).toBe(false);
    q.step();
    expect(hasPickIndex(a)).toBe(true);
    expect(hasPickIndex(b)).toBe(false);
    const bvh = meshBvh(a);
    q.step();
    expect(hasPickIndex(b)).toBe(true);
    expect(q.size).toBe(0);
    // The cached index, not a new one.
    expect(meshBvh(a)).toBe(bvh);
  });

  it('stops when aborted, and skips meshes already indexed', () => {
    const a = boxMesh();
    const b = boxMesh();
    const q = idleQueue();
    const abort = new AbortController();
    warmPickIndex([a, b], abort.signal, q.idle);
    q.step();
    abort.abort();
    expect(q.size).toBe(0);
    expect(hasPickIndex(b)).toBe(false);
    warmPickIndex([a], undefined, q.idle);
    expect(q.size).toBe(0);
  });
});
