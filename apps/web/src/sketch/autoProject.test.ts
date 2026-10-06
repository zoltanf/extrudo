import type { BodyId, SketchFrame } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { describe, expect, it } from 'vitest';
import { memoryPreferences } from '../platform';
import { type PickScene, projectPoint } from '../selection/pick';
import { createViewportStore } from '../viewport/store';
import { autoProjectSnap, modelSnapAt } from './autoProject';

const FRAME: SketchFrame = {
  origin: [0, 0, 0],
  normal: [0, 0, 1],
  x: [1, 0, 0],
  y: [0, 1, 0],
};

/** A mesh with one vertex at the origin and one edge along +x; a far face for occlusion. */
function body(): BodyMesh {
  return {
    positions: new Float32Array([0, 0, -1000, 10, 0, -1000, 0, 10, -1000]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    faceRanges: new Uint32Array([0, 1]),
    edgePoints: new Float32Array([0, 0, 0, 10, 0, 0]),
    edgeRanges: new Uint32Array([0, 2]),
    edgeFlags: new Uint8Array([0]),
    vertices: new Float32Array([0, 0, 0]),
    faceIds: ['face0'],
    edgeIds: ['e[face0|face1]'],
    vertexIds: ['v[face0|face1]'],
  };
}

function setup() {
  const viewport = createViewportStore({
    preferences: memoryPreferences(),
    reducedMotion: () => true,
  });
  const mesh = body();
  const bodies: Record<BodyId, BodyMesh> = { ['Body1' as BodyId]: mesh };
  const scene: PickScene = {
    bodies: [{ id: 'Body1' as BodyId, mesh }],
    sketches: [],
    occluding: true,
  };
  const camera = {
    view: viewport.getState().view,
    projection: viewport.getState().projection,
    width: 1000,
    height: 1000,
  };
  return { viewport, scene, camera, bodies };
}

describe('auto-project model snaps (P6-07)', () => {
  it('offers a body vertex under the pointer, in sketch coordinates', () => {
    const { viewport, scene, camera, bodies } = setup();
    const snap = autoProjectSnap(viewport, scene, camera, FRAME, [500, 500], [0, 0], bodies);
    expect(snap).toMatchObject({ kind: 'vertex', point: [0, 0], ref: { kind: 'vertex' } });
    expect(snap?.ref.id).toBe('v[face0|face1]');
  });

  it('offers an edge when only an edge is near', () => {
    const { scene, camera, bodies } = setup();
    // The edge's midpoint (5,0,0) on screen: the vertex is 5 mm (≈25 px) away.
    const at = projectPoint(camera, [5, 0, 0]);
    if (!at) throw new Error('behind the camera');
    const snap = modelSnapAt(scene, camera, FRAME, at, [5, 0], bodies);
    expect(snap?.kind).toBe('edge');
    expect(snap?.ref.id).toBe('e[face0|face1]');
  });

  it('offers nothing when the preference is off', () => {
    const { viewport, scene, camera, bodies } = setup();
    viewport.getState().setAutoProject(false);
    expect(
      autoProjectSnap(viewport, scene, camera, FRAME, [500, 500], [0, 0], bodies),
    ).toBeUndefined();
  });

  it('offers nothing over empty space', () => {
    const { viewport, scene, camera, bodies } = setup();
    expect(
      autoProjectSnap(viewport, scene, camera, FRAME, [50, 50], [0, 0], bodies),
    ).toBeUndefined();
  });
});
