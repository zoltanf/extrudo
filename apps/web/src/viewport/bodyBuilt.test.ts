/**
 * What a body builds from its mesh, kept per mesh (ADR-0102 §10): the same as building it, every
 * number, and built again only for another mesh, palette or set of face states.
 */
import { describe, expect, it } from 'vitest';
import { type FacePalette, paintFaces } from '../selection/highlight';
import { boxMesh } from '../selection/testing';
import { keptEdgeSegments, paintAll } from './bodyBuilt';
import { edgeSegments } from './bodyGeometry';

const palette: FacePalette = { base: [0.2, 0.3, 0.4], accent: [1, 0.5, 0] };
const other: FacePalette = { base: [0.9, 0.9, 0.9], accent: [1, 0.5, 0], error: [1, 0, 0] };
const keyOf = (p: FacePalette) => `${p.base.join()}/${p.accent.join()}/${p.error?.join() ?? ''}`;

/** A whole painting of a new geometry's colours, as the view does without the cache. */
function painted(mesh: ReturnType<typeof boxMesh>, states: Uint8Array, p: FacePalette) {
  const colors = new Float32Array(mesh.positions.length);
  const range = paintFaces(colors, mesh, states, p);
  return { colors, range };
}

describe('bodyBuilt (ADR-0102 §10)', () => {
  it('keeps one edge array per mesh, equal to building it', () => {
    const a = boxMesh();
    const b = boxMesh([0, 0, 0], [5, 6, 7]);
    const edges = keptEdgeSegments(a);
    expect(keptEdgeSegments(a)).toBe(edges);
    expect([...edges]).toEqual([...edgeSegments(a)]);
    expect(keptEdgeSegments(b)).not.toBe(edges);
    expect([...keptEdgeSegments(b)]).toEqual([...edgeSegments(b)]);
  });

  it('paints a new geometry as painting every face does, from the cache or not', () => {
    const mesh = boxMesh();
    const none = new Uint8Array(6);
    const some = Uint8Array.from([0, 1, 0, 2, 0, 0]);
    // Each case twice: the first paints and keeps, the second copies.
    for (const [states, p] of [
      [none, palette],
      [none, palette],
      [some, palette],
      [some, palette],
      [some, other],
      [some, other],
      [none, palette],
    ] as const) {
      const colors = new Float32Array(mesh.positions.length);
      const range = paintAll(colors, mesh, states, p, keyOf(p));
      const fresh = painted(mesh, states, p);
      expect([...colors]).toEqual([...fresh.colors]);
      expect(range).toEqual(fresh.range);
    }
  });

  it("a later change to a geometry's colours or states doesn't reach the kept painting", () => {
    const mesh = boxMesh([0, 0, 0], [3, 3, 3]);
    const states = new Uint8Array(6);
    const first = new Float32Array(mesh.positions.length);
    paintAll(first, mesh, states, palette, keyOf(palette));
    // The view paints a hover into that geometry and the states array changes in place.
    states[2] = 1;
    paintFaces(first, mesh, states, palette, new Uint8Array(6));
    states[2] = 0;
    const second = new Float32Array(mesh.positions.length);
    paintAll(second, mesh, states, palette, keyOf(palette));
    expect([...second]).toEqual([...painted(mesh, new Uint8Array(6), palette).colors]);
  });
});
