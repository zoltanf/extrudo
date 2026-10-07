import type { BodyId, SketchFrame } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { memoryPreferences } from '../platform';
import { type PickScene, projectPoint } from '../selection/pick';
import { basis } from '../viewport/camera';
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
    // The nearest point is on the segment, not an endpoint.
    expect(snap?.point[0]).toBeCloseTo(5, 6);
    expect(snap?.point[1]).toBeCloseTo(0, 6);
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

  it('reports whether an edge is straight (P6-07 slice 2)', () => {
    const { scene, camera, bodies } = setup();
    const mid = projectPoint(camera, [5, 0, 0]);
    if (!mid) throw new Error('behind the camera');
    expect(modelSnapAt(scene, camera, FRAME, mid, [5, 0], bodies)?.straight).toBe(true);
    // A bent polyline (a cylinder's rim) is not straight.
    const bent = body();
    bent.edgePoints = new Float32Array([0, 0, 0, 5, 5, 0, 10, 0, 0]);
    bent.edgeRanges = new Uint32Array([0, 3]);
    const bentBodies: Record<BodyId, BodyMesh> = { ['Body1' as BodyId]: bent };
    const bentScene: PickScene = {
      bodies: [{ id: 'Body1' as BodyId, mesh: bent }],
      sketches: [],
      occluding: true,
    };
    const at = projectPoint(camera, [5, 5, 0]);
    if (!at) throw new Error('behind the camera');
    expect(modelSnapAt(bentScene, camera, FRAME, at, [5, 5], bentBodies)?.straight).toBe(false);
  });

  it('a hidden vertex loses to a visible edge; a visible vertex beats an equally near edge', () => {
    const { viewport } = setup();
    viewport.getState().setProjection('orthographic');
    const view = viewport.getState().view;
    const camera = { view, projection: 'orthographic' as const, width: 1000, height: 1000 };
    const b = basis(view);
    const forward = b.back.clone().negate();
    const { right, up } = b;
    const face = (centre: Vector3): number[] =>
      [
        centre.clone().addScaledVector(right, 30).addScaledVector(up, 30),
        centre.clone().addScaledVector(right, -30).addScaledVector(up, 30),
        centre.clone().addScaledVector(right, -30).addScaledVector(up, -30),
      ].flatMap((p) => [p.x, p.y, p.z]);
    const F = new Vector3(0, 0, 0);
    const vertex = F.clone().addScaledVector(forward, 3); // behind the face
    const edgeMid = F.clone().addScaledVector(forward, -3); // in front of it
    const edge = [
      edgeMid.clone().addScaledVector(right, 2),
      edgeMid.clone().addScaledVector(right, -2),
    ].flatMap((p) => [p.x, p.y, p.z]);
    const mesh = (positions: number[]): BodyMesh => ({
      positions: new Float32Array(positions),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array(positions.length > 0 ? [0, 1, 2] : []),
      faceRanges: new Uint32Array(positions.length > 0 ? [0, 1] : [0, 0]),
      edgePoints: new Float32Array(edge),
      edgeRanges: new Uint32Array([0, 2]),
      edgeFlags: new Uint8Array([0]),
      vertices: new Float32Array([vertex.x, vertex.y, vertex.z]),
      faceIds: ['face0'],
      edgeIds: ['e[face0|face1]'],
      vertexIds: ['v[face0|face1]'],
    });
    const at = projectPoint(camera, [F.x, F.y, F.z]);
    if (!at) throw new Error('behind the camera');
    const hiddenMesh = mesh(face(F));
    const hiddenScene: PickScene = {
      bodies: [{ id: 'Body1' as BodyId, mesh: hiddenMesh }],
      sketches: [],
      occluding: true,
    };
    const hiddenBodies: Record<BodyId, BodyMesh> = { ['Body1' as BodyId]: hiddenMesh };
    // The vertex is behind the face: the visible edge wins.
    expect(modelSnapAt(hiddenScene, camera, FRAME, at, [F.x, F.y], hiddenBodies)?.kind).toBe(
      'edge',
    );
    // With no face the vertex is visible and beats the edge at the same spot.
    const openMesh = mesh([]);
    const openScene: PickScene = {
      bodies: [{ id: 'Body1' as BodyId, mesh: openMesh }],
      sketches: [],
      occluding: true,
    };
    const openBodies: Record<BodyId, BodyMesh> = { ['Body1' as BodyId]: openMesh };
    expect(modelSnapAt(openScene, camera, FRAME, at, [F.x, F.y], openBodies)?.kind).toBe('vertex');
  });
});
