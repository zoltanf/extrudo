import type { SelectionItem } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { describe, expect, it } from 'vitest';
import { selectionLookTarget } from './lookAt';

/**
 * Two quads: face 0 is the square z = 5 over x, y in 0..10 (normal +z), face 1 the square
 * x = 10 over y in 0..10, z in 0..4 (normal +x). One edge along y at (10, y, 4) and a vertex.
 */
function mesh(): BodyMesh {
  const positions = new Float32Array([
    0, 0, 5, 10, 0, 5, 10, 10, 5, 0, 10, 5, 10, 0, 0, 10, 10, 0, 10, 10, 4, 10, 0, 4,
  ]);
  const normals = new Float32Array([
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
  ]);
  return {
    positions,
    normals,
    indices: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
    faceRanges: new Uint32Array([0, 2, 2, 2]),
    edgePoints: new Float32Array([10, 0, 4, 10, 10, 4]),
    edgeRanges: new Uint32Array([0, 2]),
    edgeFlags: new Uint8Array([0]),
    vertices: new Float32Array([3, 4, 5]),
  };
}

const meshes = { b1: mesh() };
const item = (kind: string, id: string): SelectionItem => ({ kind, id }) as SelectionItem;

describe('selectionLookTarget (Look at Selection)', () => {
  it('boxes one face and looks along its normal', () => {
    const target = selectionLookTarget([item('face', 'b1:0')], meshes);
    expect(target?.min).toEqual([0, 0, 5]);
    expect(target?.max).toEqual([10, 10, 5]);
    expect(target?.direction).toEqual([0, 0, 1]);
  });

  it('boxes several faces and keeps the orientation when they face different ways', () => {
    const target = selectionLookTarget([item('face', 'b1:0'), item('face', 'b1:1')], meshes);
    expect(target?.min).toEqual([0, 0, 0]);
    expect(target?.max).toEqual([10, 10, 5]);
    expect(target?.direction).toBeUndefined();
  });

  it('boxes a body, an edge and a vertex', () => {
    expect(selectionLookTarget([item('body', 'b1')], meshes)?.max).toEqual([10, 10, 5]);
    const edge = selectionLookTarget([item('edge', 'b1:0')], meshes);
    expect(edge?.min).toEqual([10, 0, 4]);
    expect(edge?.max).toEqual([10, 10, 4]);
    expect(edge?.direction).toBeUndefined();
    const vertex = selectionLookTarget([item('vertex', 'b1:0')], meshes);
    expect(vertex?.min).toEqual([3, 4, 5]);
    expect(vertex?.max).toEqual([3, 4, 5]);
  });

  it('is undefined for nothing with geometry', () => {
    expect(selectionLookTarget([], meshes)).toBeUndefined();
    expect(selectionLookTarget([item('face', 'gone:0')], meshes)).toBeUndefined();
    expect(selectionLookTarget([item('plane', 'p1')], meshes)).toBeUndefined();
  });
});
