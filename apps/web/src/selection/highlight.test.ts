import type { BodyId } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import {
  bodyHighlight,
  edgeSegmentsOf,
  type FacePalette,
  faceColor,
  HOVER,
  paintFaces,
  SELECTED,
  vertexPositions,
} from './highlight';
import { boxMesh } from './testing';

const A = 'a' as BodyId;
const mesh = boxMesh();
const palette: FacePalette = { base: [0, 0, 0], accent: [1, 1, 1] };

describe('bodyHighlight', () => {
  it('marks the faces, edges and vertices of its body', () => {
    const h = bodyHighlight(A, mesh, { kind: 'face', id: 'a:1' }, [
      { kind: 'face', id: 'a:1' },
      { kind: 'face', id: 'a:4' },
      { kind: 'edge', id: 'a:3' },
      { kind: 'vertex', id: 'a:7' },
      { kind: 'face', id: 'other:2' },
      { kind: 'profile', id: 's/r' },
    ]);
    expect([...h.faces]).toEqual([0, HOVER | SELECTED, 0, 0, SELECTED, 0]);
    expect(h.selectedEdges).toEqual([3]);
    expect(h.selectedVertices).toEqual([7]);
    expect(h.hoverEdges).toEqual([]);
  });

  it('marks every face of a hovered or selected body', () => {
    expect([...bodyHighlight(A, mesh, { kind: 'body', id: 'a' }, []).faces]).toEqual(
      Array(6).fill(HOVER),
    );
    expect([...bodyHighlight(A, mesh, undefined, [{ kind: 'body', id: 'a' }]).faces]).toEqual(
      Array(6).fill(SELECTED),
    );
    const edge = bodyHighlight(A, mesh, { kind: 'edge', id: 'a:2' }, []);
    expect(edge.hoverEdges).toEqual([2]);
  });
});

describe('paintFaces', () => {
  it('blends the accent in by state', () => {
    expect(faceColor(0, palette)).toEqual([0, 0, 0]);
    expect(faceColor(HOVER, palette)[0]).toBeCloseTo(0.45);
    expect(faceColor(SELECTED, palette)[0]).toBeCloseTo(0.9);
    expect(faceColor(HOVER | SELECTED, palette)[0]).toBeCloseTo(0.9);
  });

  it('writes only the nodes of faces whose state changed', () => {
    const colors = new Float32Array(mesh.positions.length).fill(-1);
    const all = paintFaces(colors, mesh, new Uint8Array(6), palette);
    expect(all).toEqual([0, 24]);
    expect(colors.every((c) => c === 0)).toBe(true);

    const states = new Uint8Array([0, 0, SELECTED, 0, 0, 0]);
    const range = paintFaces(colors, mesh, states, palette, new Uint8Array(6));
    // Face 2 owns nodes 8..11.
    expect(range).toEqual([8, 4]);
    expect(colors[3 * 8]).toBeCloseTo(0.9);
    expect(colors[3 * 12]).toBe(0);
    expect(paintFaces(colors, mesh, states, palette, states)).toBeUndefined();
  });
});

describe('overlay geometry', () => {
  it('collects edge segments and vertex positions', () => {
    expect([...edgeSegmentsOf(mesh, [0])]).toEqual([0, 0, 0, 10, 0, 0]);
    expect(edgeSegmentsOf(mesh, [0, 1])).toHaveLength(12);
    expect([...vertexPositions(mesh, [7])]).toEqual([10, 10, 10]);
  });
});
