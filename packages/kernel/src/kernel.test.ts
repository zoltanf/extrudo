import { beforeAll, describe, expect, it } from 'vitest';
import type { HistoryRecord } from './history';
import { Kernel, KernelError } from './kernel';
import { EDGE_SEAM } from './mesh';
import { loadOcct } from './occt/load';
import { OcctScope } from './occt/scope';
import type { OcctModule } from './occt/types';
import { buildTestPart, makeTestPart, TEST_PART } from './test-part';

let oc: OcctModule;
let kernel: Kernel;

beforeAll(async () => {
  oc = await loadOcct();
  kernel = new Kernel(oc);
});

const find = (history: HistoryRecord[], input: number, kind: string, index: number) =>
  history.filter((r) => r.input === input && r.from.kind === kind && r.from.index === index);

describe('the test part (box → fillet → hole)', () => {
  it('is a valid solid with the analytic volume and 11 faces', () => {
    const part = makeTestPart(kernel);
    expect(part.valid).toBe(true);
    expect(part.measurements.volume).toBeCloseTo(TEST_PART.volume, 3);
    expect(part.faces).toBe(TEST_PART.faces);
    expect(part.measurements.bbox.min).toEqual([0, 0, 0].map((v) => expect.closeTo(v, 5)));
    expect(part.measurements.bbox.max).toEqual(TEST_PART.size.map((v) => expect.closeTo(v, 5)));
    expect(kernel.stats().liveShapes).toBe(0);
  });

  it('meshes into consistent per-face and per-edge buffers', () => {
    const { mesh, faces, edges } = makeTestPart(kernel);
    const nodes = mesh.positions.length / 3;
    expect(mesh.normals.length).toBe(mesh.positions.length);
    expect(mesh.indices.length % 3).toBe(0);
    expect(Math.max(...mesh.indices)).toBeLessThan(nodes);

    // Face ranges tile the triangle list in order, one range per face.
    expect(mesh.faceRanges.length).toBe(2 * faces);
    let next = 0;
    for (let f = 0; f < faces; f++) {
      expect(mesh.faceRanges[2 * f]).toBe(next);
      expect(mesh.faceRanges[2 * f + 1]).toBeGreaterThan(0);
      next += mesh.faceRanges[2 * f + 1] ?? 0;
    }
    expect(next).toBe(mesh.indices.length / 3);

    expect(mesh.edgeRanges.length).toBe(2 * edges);
    expect(mesh.edgeFlags.length).toBe(edges);
    expect(mesh.vertices.length % 3).toBe(0);
    for (let i = 0; i < nodes; i++) {
      const [x, y, z] = [mesh.normals[3 * i], mesh.normals[3 * i + 1], mesh.normals[3 * i + 2]];
      expect(Math.hypot(x ?? 0, y ?? 0, z ?? 0)).toBeCloseTo(1, 4);
    }
  });

  it("flags the hole's seam, and only that edge", () => {
    const { mesh } = makeTestPart(kernel);
    const seams = [...mesh.edgeFlags.keys()].filter((e) => (mesh.edgeFlags[e] ?? 0) & EDGE_SEAM);
    expect(seams).toHaveLength(1);
    // The seam of the vertical hole is a straight line along Z.
    const e = seams[0] ?? 0;
    const [first = 0, count = 0] = [mesh.edgeRanges[2 * e], mesh.edgeRanges[2 * e + 1]];
    expect(count).toBeGreaterThanOrEqual(2);
    const x0 = mesh.edgePoints[3 * first];
    const y0 = mesh.edgePoints[3 * first + 1];
    for (let p = first; p < first + count; p++) {
      expect(mesh.edgePoints[3 * p]).toBeCloseTo(x0 ?? Number.NaN, 4);
      expect(mesh.edgePoints[3 * p + 1]).toBeCloseTo(y0 ?? Number.NaN, 4);
    }
  });

  it('winds triangles outward: the signed mesh volume matches the solid', () => {
    const { mesh } = makeTestPart(kernel);
    const { positions: xyz, indices } = mesh;
    const at = (triangle: number, corner: number, axis: number) =>
      xyz[3 * (indices[triangle + corner] ?? 0) + axis] ?? 0;
    // Sum of signed tetrahedron volumes against the origin (divergence theorem).
    let volume = 0;
    for (let t = 0; t < indices.length; t += 3) {
      const [ax, ay, az] = [at(t, 0, 0), at(t, 0, 1), at(t, 0, 2)];
      const [bx, by, bz] = [at(t, 1, 0), at(t, 1, 1), at(t, 1, 2)];
      const [cx, cy, cz] = [at(t, 2, 0), at(t, 2, 1), at(t, 2, 2)];
      volume +=
        (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    }
    expect(volume / TEST_PART.volume).toBeCloseTo(1, 2);
  });
});

describe('history', () => {
  it('records fillet history: faces trimmed, edges deleted and generating fillet faces', () => {
    using scope = kernel.scope();
    const box = scope.track(kernel.box([40, 30, 20]));
    expect(kernel.count(box, 'edge')).toBe(12);
    // Any box edge will do: all are longer than the fillet needs.
    const fillet = scope.track(kernel.fillet(box, [0], 2));
    const { history } = fillet;

    // Every box face survives, trimmed or unchanged.
    for (let face = 0; face < 6; face++) {
      const records = find(history, 0, 'face', face).filter((r) => r.relation !== 'generated');
      expect(records).toHaveLength(1);
      expect(['modified', 'kept']).toContain(records[0]?.relation);
    }
    // The filleted edge is deleted and generates exactly one new face.
    const edge = find(history, 0, 'edge', 0);
    expect(edge.map((r) => r.relation).sort()).toEqual(['deleted', 'generated']);
    const generated = edge.find((r) => r.relation === 'generated');
    expect(generated?.to.filter((t) => t.kind === 'face')).toHaveLength(1);
    expect(kernel.count(fillet.shape, 'face')).toBe(7);
  });

  it('records boolean history for both inputs', () => {
    using scope = kernel.scope();
    const box = scope.track(kernel.box([40, 30, 20]));
    const tool = scope.track(kernel.cylinder(4, 22, [20, 15, -1]));
    const { history } = scope.track(kernel.cut(box, tool));
    const fromTool = history.filter((r) => r.input === 1 && r.from.kind === 'face');
    // The cylinder's side becomes the hole wall; its end caps are deleted.
    expect(fromTool.filter((r) => r.relation === 'modified')).toHaveLength(1);
    expect(fromTool.filter((r) => r.relation === 'deleted')).toHaveLength(2);
    // Every box face has a successor.
    for (let face = 0; face < 6; face++) {
      expect(find(history, 0, 'face', face).some((r) => r.to.length > 0)).toBe(true);
    }
  });
});

describe('errors and ownership', () => {
  it('reports an impossible fillet as a KernelError and keeps working', () => {
    using scope = kernel.scope();
    const box = scope.track(kernel.box([10, 10, 10]));
    expect(() => kernel.fillet(box, [0], 50)).toThrow(KernelError);
    expect(() => kernel.fillet(box, [99], 1)).toThrow(/edge index out of range/);
    expect(kernel.isValid(box)).toBe(true);
  });

  it('releases scoped shapes', () => {
    const before = kernel.stats().liveShapes;
    {
      using scope = kernel.scope();
      scope.track(buildTestPart(kernel));
      expect(kernel.stats().liveShapes).toBe(before + 1);
    }
    expect(kernel.stats().liveShapes).toBe(before);
  });

  it('disposes raw bindings through OcctScope', () => {
    // biome-ignore lint/suspicious/noExplicitAny: raw bindings are untyped in this narrow view
    const raw = oc as any;
    let deleted = 0;
    {
      using scope = new OcctScope();
      const p = scope.track(new raw.gp_Pnt(1, 2, 3));
      const original = p.delete.bind(p);
      p.delete = () => {
        deleted++;
        original();
      };
      expect(p.X()).toBe(1);
    }
    expect(deleted).toBe(1);
  });
});
