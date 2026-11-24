/**
 * Box culling (ADR-0026's amendment "a box culls what it cannot meet"): `pickBox` rejects a body,
 * a face or a body's edges whose world box shows wholly outside the box on screen, and selects
 * exactly what the exact test alone selects. Work is counted through proxies around the meshes;
 * no clock.
 */
import type { BodyId, BodyMeta } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import type { Matrix12 } from '@extrudo/kernel/matrix';
import { describe, expect, it } from 'vitest';
import type { SectionClip } from '../section/clip';
import type { Projection, Vec3 } from '../viewport/camera';
import { pickableBodies } from '../viewport/posedBodies';
import { DEFAULT_FILTER, type SelectionFilter } from './filter';
import { type PickScene, pickBox, pickBoxWith, projectPoint } from './pick';
import { boxMesh, cameraFrom } from './testing';

type Px = [number, number];

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

/** A mesh of the given faces (lists of triangles), with each triangle's sides as edges. */
function meshOf(faces: Vec3[][][]): BodyMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const faceRanges: number[] = [];
  const edgePoints: number[] = [];
  const edgeRanges: number[] = [];
  let triangles = 0;
  for (const face of faces) {
    faceRanges.push(triangles, face.length);
    for (const tri of face) {
      for (const p of tri) {
        indices.push(positions.length / 3);
        positions.push(...p);
      }
      edgeRanges.push(edgePoints.length / 3, 2);
      edgePoints.push(...(tri[0] as Vec3), ...(tri[1] as Vec3));
      triangles++;
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(positions.length),
    indices: new Uint32Array(indices),
    faceRanges: new Uint32Array(faceRanges),
    edgePoints: new Float32Array(edgePoints),
    edgeRanges: new Uint32Array(edgeRanges),
    edgeFlags: new Uint8Array(edgeRanges.length / 2),
    vertices: new Float32Array(positions.slice(0, 9)),
  };
}

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

/** A mesh that counts the exact test's reads: its triangles (`indices`) and nodes (`positions`). */
function counted(mesh: BodyMesh) {
  const reads = { indices: 0, positions: 0 };
  const proxy = new Proxy(mesh, {
    get(target, key) {
      if (key === 'indices' || key === 'positions') reads[key]++;
      return Reflect.get(target, key);
    },
  });
  return { mesh: proxy, reads };
}

const KINDS = Object.keys(DEFAULT_FILTER) as (keyof SelectionFilter)[];
const only = (...kinds: (keyof SelectionFilter)[]): SelectionFilter =>
  Object.fromEntries(KINDS.map((k) => [k, kinds.includes(k)])) as never;

describe('box culling (ADR-0026, "a box culls what it cannot meet")', () => {
  it('selects exactly what the exact test selects', () => {
    const rand = random(1125);
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
    const pick = <T>(xs: readonly T[]) => xs[int(0, xs.length - 1)] as T;
    const directions: Vec3[] = [
      [0, 0, 1],
      [0, -1, 0],
      [1, 0, 0],
      [1, -1, 1],
      [-0.3, 0.8, 0.5],
      [0.2, 0.1, -1],
    ];
    let boxes = 0;
    let found = 0;
    const reads = { cull: 0, exact: 0 };
    for (let s = 0; s < 120; s++) {
      // A few bodies spread over ±150 mm: boxes, plates with a hole's wall, odd triangles.
      const meshes: Record<string, BodyMesh> = {};
      const meta: Record<string, BodyMeta> = {};
      const posed: Record<string, Matrix12> = {};
      const counters: { reads: { indices: number; positions: number } }[] = [];
      for (let b = 0, n = int(1, 10); b < n; b++) {
        const x = int(-150, 150);
        const y = int(-150, 150);
        const z = int(-50, 50);
        const kind = int(0, 3);
        const raw =
          kind === 0
            ? boxMesh([x, y, z], [x + int(1, 40), y + int(1, 40), z + int(1, 30)])
            : kind === 1
              ? meshOf([
                  [
                    [
                      [x, y, z],
                      [x + 40, y, z],
                      [x + 40, y + 30, z],
                    ],
                    [
                      [x, y, z],
                      [x + 40, y + 30, z],
                      [x, y + 30, z],
                    ],
                  ],
                  wall(x + 20, y + 15, int(2, 8), z, z + 5, int(6, 30)),
                ])
              : kind === 2
                ? meshOf([
                    [
                      [
                        [x, y, z],
                        [x, y, z],
                        [x, y, z],
                      ],
                    ],
                    [
                      [
                        [x, y, z],
                        [x, y + 10, z + 3],
                        [x, y + 20, z + 6],
                      ],
                    ],
                    [],
                  ])
                : meshOf([
                    Array.from({ length: int(1, 8) }, () => [
                      [x + rand() * 30, y + rand() * 30, z + rand() * 30],
                      [x + rand() * 30, y + rand() * 30, z + rand() * 30],
                      [x + rand() * 30, y + rand() * 30, z + rand() * 30],
                    ]),
                  ]);
        const c = counted(raw);
        counters.push(c);
        meshes[`b${b}`] = c.mesh;
        meta[`b${b}`] = {
          name: `Body${b}`,
          visible: int(0, 7) !== 0,
          ...(int(0, 5) === 0 && { ghost: true }),
        };
        if (int(0, 7) === 0) posed[`b${b}`] = [1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 0, 0];
      }
      const clip: SectionClip[] | undefined =
        s % 4 === 1 ? [{ origin: [int(-50, 50), 0, 0], normal: [1, 0, 0] }] : undefined;
      const scene: PickScene = {
        bodies: pickableBodies(meshes as never, meta as never, posed as never),
        sketches: [],
        occluding: true,
        ...(clip && { clip }),
        planes: [
          {
            id: 'plane1',
            frame: { origin: [0, 0, 10], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] },
            anchor: [int(-50, 50), int(-50, 50), 10],
            half: int(5, 30),
          },
        ],
        axes: [{ id: 'axis1', origin: [0, 0, 0], direction: [0, 0, 1], half: 40 }],
        points: [{ id: 'point1', at: [int(-50, 50), int(-50, 50), int(-20, 20)] }],
      };
      // Perspective cameras close in leave bodies behind the eye or across its plane.
      const camera = cameraFrom(pick(directions), {
        target: [int(-100, 100), int(-100, 100), int(-30, 30)],
        size: s % 3 === 2 ? int(5, 30) : int(40, 400),
        projection: (s % 2 ? 'perspective' : 'orthographic') as Projection,
      });
      const nodes = scene.bodies.flatMap(({ mesh }) =>
        Array.from({ length: mesh.positions.length / 3 }, (_, i) =>
          projectPoint(camera, [
            mesh.positions[3 * i] ?? 0,
            mesh.positions[3 * i + 1] ?? 0,
            mesh.positions[3 * i + 2] ?? 0,
          ]),
        ).filter((p): p is Px => p !== undefined && Math.abs(p[0]) < 5000),
      );
      for (let k = 0; k < 25; k++) {
        // Boxes anywhere, and small and large ones by a body's node.
        let from: Px = [rand() * 900 - 50, rand() * 700 - 50];
        let to: Px = [rand() * 900 - 50, rand() * 700 - 50];
        const node = nodes.length > 0 ? pick(nodes) : undefined;
        if (k % 2 === 1 && node) {
          const w = k % 4 === 1 ? rand() * 6 : rand() * 200;
          from = [node[0] - w + rand() * 4, node[1] - w];
          to = [node[0] + w, node[1] + w + rand() * 4];
        }
        if (k % 3 === 0) [from, to] = [to, from];
        const filters = [DEFAULT_FILTER, ...KINDS.map((kind) => only(kind))];
        filters.push(only(...KINDS.filter(() => int(0, 1) === 1)));
        for (const filter of filters) {
          const before = counters.reduce((n, c) => n + c.reads.indices + c.reads.positions, 0);
          const exact = pickBoxWith(scene, camera, from, to, filter, false);
          const mid = counters.reduce((n, c) => n + c.reads.indices + c.reads.positions, 0);
          const culled = pickBox(scene, camera, from, to, filter);
          const after = counters.reduce((n, c) => n + c.reads.indices + c.reads.positions, 0);
          reads.exact += mid - before;
          reads.cull += after - mid;
          expect(culled).toEqual(exact);
          if (exact.length > 0) found++;
          boxes++;
        }
      }
    }
    expect(boxes).toBe(120 * 25 * (KINDS.length + 2));
    // The boxes find things, and the culling skips work.
    expect(found).toBeGreaterThan(boxes / 10);
    expect(reads.cull).toBeLessThan(reads.exact / 2);
  }, 60_000);

  it('a small box over one of 20 bodies runs the exact test on that body alone', () => {
    // 20 plates of 10 × 10 mm in a 5 × 4 grid, 20 mm apart, seen from the top.
    const plates = Array.from({ length: 20 }, (_, i) =>
      counted(
        boxMesh(
          [(i % 5) * 20, Math.floor(i / 5) * 20, 0],
          [(i % 5) * 20 + 10, Math.floor(i / 5) * 20 + 10, 2],
        ),
      ),
    );
    const scene: PickScene = {
      bodies: plates.map(({ mesh }, i) => ({ id: `p${i}` as BodyId, mesh })),
      sketches: [],
      occluding: true,
    };
    const top = cameraFrom([0, 0, 1], { target: [45, 35, 0], size: 120 });
    const centre = projectPoint(top, [(7 % 5) * 20 + 5, 20 + 5, 2]) as Px;
    const from: Px = [centre[0] + 3, centre[1] - 3];
    const to: Px = [centre[0] - 3, centre[1] + 3];
    // Once to keep the boxes (that reads every mesh once), then counted.
    expect(pickBox(scene, top, from, to, DEFAULT_FILTER)).toEqual([{ kind: 'body', id: 'p7' }]);
    for (const p of plates) {
      p.reads.indices = 0;
      p.reads.positions = 0;
    }
    expect(pickBox(scene, top, from, to, DEFAULT_FILTER)).toEqual([{ kind: 'body', id: 'p7' }]);
    plates.forEach(({ reads }, i) => {
      if (i === 7) expect(reads.indices).toBeGreaterThan(0);
      else expect(reads).toEqual({ indices: 0, positions: 0 });
    });
    // The exact test alone reads every plate.
    for (const p of plates) p.reads.indices = 0;
    pickBoxWith(scene, top, from, to, DEFAULT_FILTER, false);
    expect(plates.every(({ reads }) => reads.indices > 0)).toBe(true);
  });
});
