import type { BodyId, BodyMeta } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { describe, expect, it } from 'vitest';
import { ghostBodies, ghostBodiesSummary } from './bodyGhosts';

const mesh = (): BodyMesh => ({
  positions: new Float32Array(),
  normals: new Float32Array(),
  indices: new Uint32Array(),
  faceRanges: new Uint32Array(),
  edgePoints: new Float32Array(),
  edgeRanges: new Uint32Array(),
  edgeFlags: new Uint8Array(),
  vertices: new Float32Array(),
});

const bid = (id: string) => id as BodyId;

const bodies: Record<BodyId, BodyMesh> = {
  [bid('A:0')]: mesh(),
  [bid('B:0')]: mesh(),
  [bid('C:0')]: mesh(),
};
const meta: Record<BodyId, BodyMeta> = {
  [bid('A:0')]: { name: 'Body1', visible: true },
  [bid('B:0')]: { name: 'Lid', visible: false, ghost: true },
  [bid('C:0')]: { name: 'Cover', visible: false },
};

describe('ghostBodies (ADR-0030\u2019s amendment)', () => {
  it('lists only the ghosted bodies, in the layer order', () => {
    expect(ghostBodies(bodies, meta).map(([id]) => id)).toEqual(['B:0']);
  });

  it('reads the ghost from visible: false plus ghost: true', () => {
    // A hidden body is not a ghost; a body with no metadata at all is shown.
    const onlyHidden = { ...meta, [bid('A:0')]: { name: 'Body1', visible: false } as BodyMeta };
    expect(ghostBodies(bodies, onlyHidden).map(([id]) => id)).toEqual(['B:0']);
    expect(ghostBodies({ [bid('X:0')]: mesh() }, {})).toEqual([]);
  });
});

describe('ghostBodiesSummary', () => {
  it('joins the ghost names, and is undefined when there are none', () => {
    expect(ghostBodiesSummary(bodies, meta)).toBe('Lid');
    expect(ghostBodiesSummary(bodies, {})).toBeUndefined();
    expect(
      ghostBodiesSummary(bodies, {
        ...meta,
        [bid('A:0')]: { name: 'Body1', visible: false, ghost: true },
      }),
    ).toBe('Body1 Lid');
  });
});
