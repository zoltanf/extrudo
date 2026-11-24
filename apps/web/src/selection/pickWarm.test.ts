import type { BodyId } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTER } from './filter';
import { hasPickIndex, meshBvh, pickBox, warmPickIndex } from './pick';
import { boxMesh, cameraFrom } from './testing';

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

  it("keeps the box select's cull boxes too: a box that misses the body reads none of it", () => {
    // Reads of the mesh's triangles and nodes, counted.
    const counted = () => {
      const reads = { n: 0 };
      const mesh = new Proxy(boxMesh(), {
        get(target, key) {
          if (key === 'indices' || key === 'positions') reads.n++;
          return Reflect.get(target, key);
        },
      }) as BodyMesh;
      return { mesh, reads };
    };
    const top = cameraFrom([0, 0, 1], { target: [5, 5, 5], size: 100 });
    // A box at the view's corner, far from the cube.
    const far = (mesh: BodyMesh) =>
      pickBox(
        { bodies: [{ id: 'b' as BodyId, mesh }], sketches: [], occluding: true },
        top,
        [790, 590],
        [700, 520],
        DEFAULT_FILTER,
      );
    const warmed = counted();
    const q = idleQueue();
    warmPickIndex([warmed.mesh], undefined, q.idle);
    q.step();
    warmed.reads.n = 0;
    expect(far(warmed.mesh)).toEqual([]);
    expect(warmed.reads.n).toBe(0);
    // Not warmed: the box select builds them (reading the mesh once), then reads nothing more.
    const cold = counted();
    expect(far(cold.mesh)).toEqual([]);
    expect(cold.reads.n).toBeGreaterThan(0);
    cold.reads.n = 0;
    expect(far(cold.mesh)).toEqual([]);
    expect(cold.reads.n).toBe(0);
  });
});
