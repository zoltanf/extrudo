/**
 * A crossing box and triangles of no area on screen (ADR-0026's amendment of 2026-11-24). A
 * crossing box took such a triangle (a face seen edge-on, or three nodes on one point) whenever
 * its centre lay on the triangle's line, however far from it. Now it takes it only where it meets
 * it. `oracle` below is the face test as it was (`old`) and as it is, written out over
 * `projectPoint`: the box selects what it did except for those triangles.
 */
import type { BodyId } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { describe, expect, it } from 'vitest';
import type { Projection, Vec3 } from '../viewport/camera';
import { DEFAULT_FILTER, type SelectionFilter } from './filter';
import { type PickCamera, type PickScene, pickBox, projectPoint, segmentMeetsRect } from './pick';
import { boxMesh, cameraFrom } from './testing';

type Px = [number, number];
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const only = (...kinds: (keyof SelectionFilter)[]): SelectionFilter =>
  Object.fromEntries(
    Object.keys(DEFAULT_FILTER).map((k) => [k, kinds.includes(k as never)]),
  ) as never;

/** A seeded generator (mulberry32): the same scenes and boxes on every run. */
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A mesh of the given faces, each a list of triangles of nodes. */
function meshOf(faces: Vec3[][][]): BodyMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const faceRanges: number[] = [];
  let triangles = 0;
  for (const face of faces) {
    faceRanges.push(triangles, face.length);
    for (const tri of face) {
      for (const p of tri) {
        indices.push(positions.length / 3);
        positions.push(...p);
      }
      triangles++;
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(positions.length),
    indices: new Uint32Array(indices),
    faceRanges: new Uint32Array(faceRanges),
    edgePoints: new Float32Array(),
    edgeRanges: new Uint32Array(),
    edgeFlags: new Uint8Array(),
    vertices: new Float32Array(),
  };
}

/** A hole's wall: an n-sided upright prism's sides, one face, two triangles per side. */
function wall(cx: number, cy: number, radius: number, z0: number, z1: number, n: number) {
  const at = (i: number, z: number): Vec3 => [
    cx + radius * Math.cos((2 * Math.PI * i) / n),
    cy + radius * Math.sin((2 * Math.PI * i) / n),
    z,
  ];
  const tris: Vec3[][] = [];
  for (let i = 0; i < n; i++) {
    tris.push([at(i, z0), at(i + 1, z0), at(i + 1, z1)], [at(i, z0), at(i + 1, z1), at(i, z1)]);
  }
  return tris;
}

const inside = (r: Rect, p: Px) => p[0] >= r.x0 && p[0] <= r.x1 && p[1] >= r.y0 && p[1] <= r.y1;
const doubleArea = (a: Px, b: Px, c: Px) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function insideTriangle(p: Px, a: Px, b: Px, c: Px) {
  const cross = (u: Px, v: Px) => (v[0] - u[0]) * (p[1] - u[1]) - (v[1] - u[1]) * (p[0] - u[0]);
  const d1 = cross(a, b);
  const d2 = cross(b, c);
  const d3 = cross(c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

type Verdict = 'met' | 'centre only' | false;

/** One triangle in a crossing box: met by a node or a side, or only by the centre test. */
function crossing(a: Px, b: Px, c: Px, r: Rect): Verdict {
  if (
    inside(r, a) ||
    segmentMeetsRect(a, b, r) ||
    segmentMeetsRect(b, c, r) ||
    segmentMeetsRect(c, a, r)
  ) {
    return 'met';
  }
  return insideTriangle([(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2], a, b, c) ? 'centre only' : false;
}

/**
 * The faces a box takes, as the face test was (`old`) or is: window, every triangle's nodes
 * inside; crossing, any triangle met, or (old) holding the box's centre, (now) holding it with
 * an area on screen. Also each changed triangle, for the test to look at.
 */
function oracle(mesh: BodyMesh, camera: PickCamera, from: Px, to: Px, old: boolean) {
  const mode = to[0] >= from[0] ? 'window' : 'crossing';
  const r: Rect = {
    x0: Math.min(from[0], to[0]),
    y0: Math.min(from[1], to[1]),
    x1: Math.max(from[0], to[0]),
    y1: Math.max(from[1], to[1]),
  };
  const node = (i: number): Px | undefined => {
    const p = mesh.positions;
    return projectPoint(camera, [p[3 * i] ?? 0, p[3 * i + 1] ?? 0, p[3 * i + 2] ?? 0]);
  };
  const faces: number[] = [];
  const changed: { a: Px; b: Px; c: Px; r: Rect }[] = [];
  for (let f = 0; f < mesh.faceRanges.length >> 1; f++) {
    const first = mesh.faceRanges[2 * f] ?? 0;
    const count = mesh.faceRanges[2 * f + 1] ?? 0;
    if (count === 0) continue;
    let hit = mode === 'window';
    for (let t = first; t < first + count; t++) {
      const [a, b, c] = [0, 1, 2].map((k) => node(mesh.indices[3 * t + k] ?? 0));
      if (mode === 'window') {
        if (!(a && b && c && inside(r, a) && inside(r, b) && inside(r, c))) {
          hit = false;
          break;
        }
        continue;
      }
      if (!a || !b || !c) continue;
      const v = crossing(a, b, c, r);
      if (v === 'met' || (v === 'centre only' && (old || doubleArea(a, b, c) !== 0))) {
        hit = true;
        break;
      }
      if (v === 'centre only') changed.push({ a, b, c, r });
    }
    if (hit) faces.push(f);
  }
  return { faces, changed, mode };
}

const B = 'b' as BodyId;
const sceneOf = (mesh: BodyMesh): PickScene => ({
  bodies: [{ id: B, mesh }],
  sketches: [],
  occluding: true,
});
const faceIds = (scene: PickScene, camera: PickCamera, from: Px, to: Px) =>
  pickBox(scene, camera, from, to, only('faces')).map((i) => Number(i.id.split(':')[1]));

describe('a crossing box and triangles of no area on screen (ADR-0026, 2026-11-24)', () => {
  it('selects what it did, but for such triangles it does not meet', () => {
    const rand = random(20261124);
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
    const directions: Vec3[] = [
      [0, 0, 1],
      [0, -1, 0],
      [1, 0, 0],
      [1, -1, 1],
      [-0.3, 0.8, 0.5],
    ];
    let boxes = 0;
    let differences = 0;
    for (let s = 0; s < 150; s++) {
      // A plate with a hole's wall, and a few odd triangles: a sliver, one on a point, a line.
      const x = int(-20, 20);
      const y = int(-20, 20);
      const faces: Vec3[][][] = [
        [
          [
            [x, y, 0],
            [x + 40, y, 0],
            [x + 40, y + 30, 0],
          ],
          [
            [x, y, 0],
            [x + 40, y + 30, 0],
            [x, y + 30, 0],
          ],
        ],
        [
          [
            [x, y, 0],
            [x, y + 30, 0],
            [x, y + 30, 5],
          ],
          [
            [x, y, 0],
            [x, y + 30, 5],
            [x, y, 5],
          ],
        ],
        wall(x + 20, y + 15, int(2, 6), 0, 5, int(6, 24)),
        [
          [
            [x + 5, y + 5, 2],
            [x + 5, y + 5, 2],
            [x + 5, y + 5, 2],
          ],
        ],
        [
          [
            [x + 8, y, 1],
            [x + 8, y + 10, 1],
            [x + 8 + 10 ** -int(1, 6), y + 20, 1],
          ],
        ],
        [
          [
            [x - 3, y + 2, 0],
            [x - 3, y + 2, 4],
            [x - 3, y + 2, 9],
          ],
        ],
      ];
      const mesh =
        s % 3 === 0
          ? boxMesh([x, y, 0], [x + int(1, 30), y + int(1, 30), int(1, 20)])
          : meshOf(faces);
      const scene = sceneOf(mesh);
      const camera = cameraFrom(directions[s % directions.length] as Vec3, {
        target: [int(-10, 10), int(-10, 10), int(0, 5)],
        size: int(40, 200),
        projection: (s % 4 === 3 ? 'perspective' : 'orthographic') as Projection,
      });
      // Boxes anywhere, and boxes whose centre sits exactly on a projected node's x or y.
      const nodes = Array.from({ length: mesh.positions.length / 3 }, (_, i) =>
        projectPoint(camera, [
          mesh.positions[3 * i] ?? 0,
          mesh.positions[3 * i + 1] ?? 0,
          mesh.positions[3 * i + 2] ?? 0,
        ]),
      ).filter((p): p is Px => p !== undefined);
      for (let k = 0; k < 40; k++) {
        let from: Px = [rand() * 800, rand() * 600];
        let to: Px = [rand() * 800, rand() * 600];
        const node = nodes[int(0, nodes.length - 1)];
        if (k % 2 === 1 && node) {
          const w = int(1, 64) / 8;
          const h = int(1, 64) / 8;
          const off = (int(0, 1) ? 1 : -1) * int(0, 400);
          from = k % 4 === 1 ? [node[0] + w, node[1] + off - h] : [node[0] + off + w, node[1] - h];
          to = k % 4 === 1 ? [node[0] - w, node[1] + off + h] : [node[0] + off - w, node[1] + h];
        }
        if (k % 5 === 4) [from, to] = [to, from];
        const now = oracle(mesh, camera, from, to, false);
        const was = oracle(mesh, camera, from, to, true);
        // The pick is the face test as it is now.
        expect(faceIds(scene, camera, from, to)).toEqual(now.faces);
        const bodies = pickBox(scene, camera, from, to, only('bodies')).length > 0;
        const allFaces = mesh.faceRanges.length >> 1 === now.faces.length;
        expect(bodies).toBe(now.mode === 'window' ? allFaces : now.faces.length > 0);
        // What changed: only faces the box no longer takes, each for a triangle of no area on
        // screen that the box doesn't meet (no node inside, no side through it).
        expect(now.faces.every((f) => was.faces.includes(f))).toBe(true);
        if (now.mode === 'window') expect(now.faces).toEqual(was.faces);
        for (const { a, b, c, r } of now.changed) {
          expect(doubleArea(a, b, c) === 0).toBe(true);
          expect(crossing(a, b, c, r)).toBe('centre only');
        }
        if (was.faces.length !== now.faces.length) differences++;
        boxes++;
      }
    }
    expect(boxes).toBe(6000);
    // The boxes reach the case: some found a face the old test took and this one doesn't.
    expect(differences).toBeGreaterThan(20);
  }, 30_000);

  // Looking straight down at a 10 mm cube: its left face (x = 0) is seen edge-on.
  const cube = sceneOf(boxMesh([0, 0, 0], [10, 10, 10]));
  const top = cameraFrom([0, 0, 1], { target: [0, 0, 5], size: 100 });
  const left = projectPoint(top, [0, 5, 5]) as Px;
  const far = projectPoint(top, [0, 40, 5]) as Px;

  it("a crossing box far along an edge-on face's line takes nothing", () => {
    // Above the cube, its centre's x exactly on the left face's line (the left face is face 4).
    const from: Px = [left[0] + 5, far[1] - 5];
    const to: Px = [left[0] - 5, far[1] + 5];
    expect(pickBox(cube, top, from, to, DEFAULT_FILTER)).toEqual([]);
    expect(faceIds(cube, top, from, to)).toEqual([]);
    // Main took the cube there; the old test says so.
    expect(oracle(cube.bodies[0]?.mesh as BodyMesh, top, from, to, true).faces).toContain(4);
  });

  it('a crossing box that meets an edge-on face still takes it', () => {
    // A narrow box across the left face's line, inside its y range.
    const ids = faceIds(cube, top, [left[0] + 2, left[1] - 2], [left[0] - 2, left[1] + 2]);
    expect(ids).toContain(4);
    expect(
      pickBox(cube, top, [left[0] + 2, left[1] - 2], [left[0] - 2, left[1] + 2], DEFAULT_FILTER),
    ).toEqual([{ kind: 'body', id: 'b' }]);
  });

  it('a thin sliver with an area on screen takes a box inside it, as before', () => {
    // 4 px wide at its base in the top view (100 mm over 600 px): a box well inside it touches
    // no node and no side, only the centre test takes it.
    const sliver = sceneOf(
      meshOf([
        [
          [
            [0, 0, 0],
            [0.8, 0, 0],
            [0.4, 40, 0],
          ],
        ],
      ]),
    );
    const view = cameraFrom([0, 0, 1], { target: [0, 0, 0], size: 100 });
    const mid = projectPoint(view, [0.4, 5, 0]) as Px;
    const from: Px = [mid[0] + 0.5, mid[1] - 0.5];
    const to: Px = [mid[0] - 0.5, mid[1] + 0.5];
    expect(faceIds(sliver, view, from, to)).toEqual([0]);
    expect(oracle(sliver.bodies[0]?.mesh as BodyMesh, view, from, to, true).faces).toEqual([0]);
    // Its line beyond its tip: neither the old test nor this one takes it.
    const beyond = projectPoint(view, [0.4, 45, 0]) as Px;
    const b0: Px = [beyond[0] + 0.5, beyond[1] - 0.5];
    const b1: Px = [beyond[0] - 0.5, beyond[1] + 0.5];
    expect(faceIds(sliver, view, b0, b1)).toEqual([]);
    expect(oracle(sliver.bodies[0]?.mesh as BodyMesh, view, b0, b1, true).faces).toEqual([]);
  });

  it('a triangle on one point is taken by a box around the point, not by any box', () => {
    const dot = sceneOf(
      meshOf([
        [
          [
            [3, 3, 3],
            [3, 3, 3],
            [3, 3, 3],
          ],
        ],
      ]),
    );
    const p = projectPoint(top, [3, 3, 3]) as Px;
    expect(faceIds(dot, top, [p[0] + 1, p[1] - 1], [p[0] - 1, p[1] + 1])).toEqual([0]);
    // Anywhere else: the old test took it for every crossing box.
    expect(faceIds(dot, top, [p[0] + 201, p[1] - 101], [p[0] + 199, p[1] - 99])).toEqual([]);
    expect(
      oracle(
        dot.bodies[0]?.mesh as BodyMesh,
        top,
        [p[0] + 201, p[1] - 101],
        [p[0] + 199, p[1] - 99],
        true,
      ).faces,
    ).toEqual([0]);
  });

  it('a window box is as it was', () => {
    // Left to right around the cube, and over half of it.
    const a = projectPoint(top, [-2, -2, 5]) as Px;
    const b = projectPoint(top, [12, 12, 5]) as Px;
    const half = projectPoint(top, [5, 12, 5]) as Px;
    const min: Px = [a[0], b[1]];
    expect(pickBox(cube, top, min, [b[0], a[1]], DEFAULT_FILTER)).toEqual([
      { kind: 'body', id: 'b' },
    ]);
    expect(faceIds(cube, top, min, [half[0], a[1]])).toEqual([4]);
  });
});
