import { beforeAll, describe, expect, it } from 'vitest';
import type { HistoryRecord } from './history';
import {
  ChamferError,
  FilletError,
  Kernel,
  KernelError,
  OffsetFaceError,
  ShellError,
} from './kernel';
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

  it('diagnoses a fillet that is too large: the chain and the largest radius that works', () => {
    using scope = kernel.scope();
    const box = scope.track(kernel.box([10, 10, 10]));
    try {
      kernel.fillet(box, [0], 50);
      expect.unreachable('a 50 mm fillet of a 10 mm box');
    } catch (error) {
      expect(error).toBeInstanceOf(FilletError);
      const [problem] = (error as FilletError).problems;
      expect(problem?.kind).toBe('too-large');
      if (problem?.kind !== 'too-large') return;
      expect(problem.edges).toEqual([0]);
      // Faces are 10 mm wide: a radius just under that works, and the probe says so.
      expect(problem.max).toBeGreaterThan(9);
      expect(problem.max).toBeLessThan(10.01);
      scope.track(kernel.fillet(box, [0], problem.max));
    }
  });

  it('diagnoses fillets that only fail together, with the factor that works', {
    timeout: 60_000,
  }, () => {
    using scope = kernel.scope();
    const box = scope.track(kernel.box([10, 10, 10]));
    const all = Array.from({ length: 12 }, (_, i) => i);
    try {
      kernel.fillet(box, all, 6);
      expect.unreachable('rounding all 12 edges of a 10 mm cube by 6 mm');
    } catch (error) {
      const [problem] = (error as FilletError).problems;
      expect(problem?.kind).toBe('together');
      if (problem?.kind !== 'together') return;
      // Radii meet at 5 mm: a factor a bit under 5 / 6 works.
      expect(problem.factor).toBeGreaterThan(0.7);
      expect(problem.factor).toBeLessThan(0.86);
      scope.track(kernel.fillet(box, all, 6 * problem.factor));
    }
  });

  it('rounds a whole chain of tangent edges and refuses two radii on one chain', () => {
    using scope = kernel.scope();
    const plate = scope.track(kernel.box([40, 40, 2]));
    // Every plate edge is alone in its chain (its neighbours are square to it).
    expect(kernel.tangentChain(plate, 3)).toEqual([3]);
    const rounded = scope.track(kernel.fillet(plate, [0, 2, 4, 6], [5, 5, 5, 5]));
    expect(kernel.count(rounded.shape, 'face')).toBe(10);
    // The rim of the top face is now four lines and four arcs, tangent to each other.
    let rim: number[] | undefined;
    for (let e = 0; e < kernel.count(rounded.shape, 'edge') && !rim; e++) {
      const chain = kernel.tangentChain(rounded.shape, e);
      if (chain.length === 8) rim = chain;
    }
    expect(rim).toBeDefined();
    expect(new Set(rim).size).toBe(8);
    // One edge of it rounds the whole rim, in one go.
    const [first, second] = rim as number[];
    const one = scope.track(kernel.fillet(rounded.shape, [first as number], 0.5));
    expect(kernel.count(one.shape, 'face')).toBe(18);
    // Two radii on one chain: refused, naming the chain.
    try {
      kernel.fillet(rounded.shape, [first as number, second as number], [0.5, 0.7]);
      expect.unreachable('two radii on one chain');
    } catch (error) {
      const [problem] = (error as FilletError).problems;
      expect(problem?.kind).toBe('mixed-radii');
      if (problem?.kind === 'mixed-radii') {
        expect(problem.edges.sort()).toEqual([first, second].sort());
      }
    }
    // Different radii on separate chains are fine.
    scope.track(kernel.fillet(plate, [0, 2], [1, 1.5]));
  });

  it('records chamfer history and sizes the three modes as documented (P3-02)', () => {
    using scope = kernel.scope();
    const box = scope.track(kernel.box([40, 30, 20]));
    const volume = (shape: Parameters<typeof kernel.measure>[0]) => kernel.measure(shape).volume;
    const full = 40 * 30 * 20;
    const equal = scope.track(kernel.chamfer(box, [0], { mode: 'equal', distance: 3 }));
    expect(kernel.count(equal.shape, 'face')).toBe(7);
    // A right triangle with 3 mm legs off the edge's length (20, 30 or 40 mm).
    const length = (2 * (full - volume(equal.shape))) / 9;
    expect([20, 30, 40].map((l) => Math.abs(l - length) < 1e-6)).toContain(true);
    // The chamfered edge is deleted and generates its chamfer face; the faces around survive.
    const edge = find(equal.history, 0, 'edge', 0);
    expect(edge.map((r) => r.relation).sort()).toEqual(['deleted', 'generated']);
    expect(
      edge.find((r) => r.relation === 'generated')?.to.filter((t) => t.kind === 'face'),
    ).toHaveLength(1);
    // Two distances: the area is the same either way, only the faces swap.
    for (const flip of [false, true]) {
      const two = scope.track(
        kernel.chamfer(box, [0], { mode: 'two-distances', distance: 2, distanceB: 5, flip }),
      );
      expect(volume(two.shape)).toBeCloseTo(full - 0.5 * 2 * 5 * length, 2);
    }
    // Distance and angle: a 45° chamfer is the equal one.
    const angled = scope.track(
      kernel.chamfer(box, [0], { mode: 'distance-angle', distance: 3, angle: Math.PI / 4 }),
    );
    expect(volume(angled.shape)).toBeCloseTo(volume(equal.shape), 3);
  });

  it('diagnoses a chamfer that is too large: the chain and the factor that works', () => {
    using scope = kernel.scope();
    const box = scope.track(kernel.box([10, 10, 10]));
    for (const spec of [
      { mode: 'equal', distance: 50 },
      { mode: 'two-distances', distance: 50, distanceB: 4 },
      { mode: 'distance-angle', distance: 50, angle: Math.PI / 6 },
    ] as const) {
      try {
        kernel.chamfer(box, [0], spec);
        expect.unreachable(`a ${spec.mode} chamfer of 50 mm on a 10 mm box`);
      } catch (error) {
        expect(error).toBeInstanceOf(ChamferError);
        const [problem] = (error as ChamferError).problems;
        expect(problem?.kind).toBe('too-large');
        if (problem?.kind !== 'too-large') return;
        expect(problem.edges).toEqual([0]);
        expect(problem.factor).toBeGreaterThan(0);
        expect(problem.factor).toBeLessThan(1);
        const scaled =
          spec.mode === 'two-distances'
            ? { ...spec, distance: 50 * problem.factor, distanceB: 4 * problem.factor }
            : { ...spec, distance: 50 * problem.factor };
        scope.track(kernel.chamfer(box, [0], scaled));
      }
    }
  });

  it('diagnoses chamfers that only fail together, and refuses one chain with two settings', {
    timeout: 60_000,
  }, () => {
    using scope = kernel.scope();
    const box = scope.track(kernel.box([10, 10, 10]));
    const all = Array.from({ length: 12 }, (_, i) => i);
    try {
      kernel.chamfer(box, all, { mode: 'equal', distance: 6 });
      expect.unreachable('chamfering all 12 edges of a 10 mm cube by 6 mm');
    } catch (error) {
      const [problem] = (error as ChamferError).problems;
      expect(problem?.kind).toBe('together');
      if (problem?.kind !== 'together') return;
      // Distances meet at 5 mm: a factor a bit under 5 / 6 works.
      expect(problem.factor).toBeGreaterThan(0.7);
      expect(problem.factor).toBeLessThan(0.86);
      scope.track(kernel.chamfer(box, all, { mode: 'equal', distance: 6 * problem.factor }));
    }
    const plate = scope.track(kernel.box([40, 40, 2]));
    const rounded = scope.track(kernel.fillet(plate, [0, 2, 4, 6], [5, 5, 5, 5]));
    let rim: number[] | undefined;
    for (let e = 0; e < kernel.count(rounded.shape, 'edge') && !rim; e++) {
      const chain = kernel.tangentChain(rounded.shape, e);
      if (chain.length === 8) rim = chain;
    }
    const [first, second] = rim as number[];
    // The chain takes one setting: both edges alone are fine, two distances are not.
    scope.track(
      kernel.chamfer(rounded.shape, [first as number, second as number], {
        mode: 'equal',
        distance: 0.5,
      }),
    );
    try {
      kernel.chamfer(
        rounded.shape,
        [first as number, second as number],
        [
          { mode: 'equal', distance: 0.5 },
          { mode: 'equal', distance: 0.7 },
        ],
      );
      expect.unreachable('two settings on one chain');
    } catch (error) {
      const [problem] = (error as ChamferError).problems;
      expect(problem?.kind).toBe('mixed');
    }
    // Bad arguments are plain kernel errors.
    expect(() => kernel.chamfer(box, [99], { mode: 'equal', distance: 1 })).toThrow(
      /edge index out of range/,
    );
    expect(() =>
      kernel.chamfer(box, [0], { mode: 'distance-angle', distance: 1, angle: 2 }),
    ).toThrow(/angle must be between/);
  });

  it('shells a solid inside and outside, records history, and closes it when no face is given (P3-03)', () => {
    using scope = kernel.scope();
    const box = scope.track(kernel.box([40, 30, 20]));
    const full = 40 * 30 * 20;
    const volume = (shape: Parameters<typeof kernel.measure>[0]) => kernel.measure(shape).volume;
    for (let face = 0; face < 6; face++) {
      const inside = scope.track(kernel.shell(box, [face], 2));
      expect(kernel.isValid(inside.shape)).toBe(true);
      // Five outer faces, five inner ones and the rim around the opening.
      expect(kernel.count(inside.shape, 'face')).toBe(11);
      expect(volume(inside.shape)).toBeLessThan(full);
      // The removed face becomes the rim; every other face is kept and offsets to an inner face.
      const removed = find(inside.history, 0, 'face', face);
      expect(removed.map((r) => r.relation)).toEqual(['modified']);
      for (let other = 0; other < 6; other++) {
        if (other === face) continue;
        const relations = find(inside.history, 0, 'face', other)
          .map((r) => r.relation)
          .sort();
        expect(relations).toEqual(['generated', 'kept']);
      }
    }
    // Inside: the outside stays where it is, the walls are 2 mm all round.
    const top = scope.track(kernel.shell(box, [0], 2, 'inside'));
    const bbox = kernel.measure(top.shape).bbox;
    expect(bbox.max.map((x) => Math.round(x * 100) / 100)).toEqual([40, 30, 20]);
    // Outside: the surface is the cavity and the part grows by 2 mm where there are walls.
    const grown = scope.track(kernel.shell(box, [0], 2, 'outside'));
    expect(kernel.isValid(grown.shape)).toBe(true);
    expect(kernel.measure(grown.shape).bbox.max[0]).toBeGreaterThan(40);
    // No face: a closed solid with a void inside.
    const closed = scope.track(kernel.shell(box, [], 2));
    expect(kernel.isValid(closed.shape)).toBe(true);
    expect(kernel.count(closed.shape, 'face')).toBe(12);
    expect(volume(closed.shape)).toBeCloseTo(full - 36 * 26 * 16, 3);
    const closedOut = scope.track(kernel.shell(box, [], 2, 'outside'));
    expect(kernel.isValid(closedOut.shape)).toBe(true);
    expect(kernel.measure(closedOut.shape).bbox.max.map((x) => Math.round(x * 100) / 100)).toEqual([
      42, 32, 22,
    ]);
    // The original is untouched by all of it.
    expect(volume(box)).toBeCloseTo(full, 6);
    expect(kernel.count(box, 'face')).toBe(6);
  });

  it('diagnoses a shell that fails: too thick with the maximum, all faces, tangent faces, no walls', {
    timeout: 30_000,
  }, () => {
    using scope = kernel.scope();
    const box = scope.track(kernel.box([40, 30, 20]));
    const problemOf = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        expect(error).toBeInstanceOf(ShellError);
        return (error as ShellError).problems[0];
      }
      return expect.unreachable('the shell should have failed');
    };
    for (const closed of [false, true]) {
      const problem = problemOf(() => kernel.shell(box, closed ? [] : [0], 12));
      expect(problem?.kind).toBe('too-thick');
      if (problem?.kind !== 'too-thick') return;
      // Walls meet at half of the smallest dimension the cavity has.
      expect(problem.max).toBeGreaterThan(9);
      expect(problem.max).toBeLessThan(10.01);
      scope.track(kernel.shell(box, closed ? [] : [0], problem.max));
    }
    expect(problemOf(() => kernel.shell(box, [0, 1, 2, 3, 4, 5], 1))?.kind).toBe('all-faces');
    // A curved face that runs smoothly into its neighbours can't be opened; a flat
    // one can since P4-12 (cut out as a plug, ADR-0046's amendment).
    const rounded = scope.track(
      kernel.fillet(
        box,
        Array.from({ length: 12 }, (_, i) => i),
        Array(12).fill(4),
      ),
    );
    const curved = kernel.describe(rounded.shape).faces.findIndex((f) => f.type !== 'plane');
    const tangent = problemOf(() => kernel.shell(rounded.shape, [curved], 2));
    expect(tangent).toEqual({ kind: 'tangent', face: curved });
    const flat = kernel.describe(rounded.shape).faces.findIndex((f) => f.type === 'plane');
    const opened = scope.track(kernel.shell(rounded.shape, [flat], 2));
    expect(kernel.isValid(opened.shape)).toBe(true);
    // The rounded body can still be hollowed closed.
    const closed = scope.track(kernel.shell(rounded.shape, [], 2));
    expect(kernel.isValid(closed.shape)).toBe(true);
    // A cylinder's whole side can't be removed: nothing holds the walls.
    const cylinder = scope.track(kernel.cylinder(10, 30));
    let wall = -1;
    for (let face = 0; face < 3 && wall < 0; face++) {
      try {
        kernel.shell(cylinder, [face], 2);
      } catch (error) {
        if ((error as ShellError).problems[0]?.kind === 'unshellable') wall = face;
      }
    }
    expect(wall).toBeGreaterThanOrEqual(0);
    // A wall thicker than the radius is refused, not built inside out.
    const thick = problemOf(() => kernel.shell(cylinder, [1 + (wall === 1 ? 1 : 0)], 12));
    expect(thick?.kind).toBe('too-thick');
    // Bad arguments are plain kernel errors.
    expect(() => kernel.shell(box, [99], 1)).toThrow(/face index out of range/);
    expect(() => kernel.shell(box, [0], 0)).toThrow(/thickness must be greater than 0/);
  });

  it('offsets faces (P3-08): out and in, smooth chains together, and the diagnosis of a failure', () => {
    using scope = kernel.scope();
    const box = scope.track(kernel.box([40, 30, 20]));
    const volume = kernel.measure(box).volume;
    // Every face grows the body when pulled out and shrinks it when pushed in, by area x distance.
    for (let face = 0; face < 6; face++) {
      const out = scope.track(kernel.offsetFaces(box, [face], 3));
      const back = scope.track(kernel.offsetFaces(box, [face], -3));
      expect(kernel.isValid(out.shape)).toBe(true);
      expect(kernel.count(out.shape, 'face')).toBe(6);
      // The smallest face is 20 x 30 mm.
      expect(kernel.measure(out.shape).volume).toBeGreaterThan(volume + 3 * 20 * 30 - 1e-6);
      expect(kernel.measure(back.shape).volume).toBeLessThan(volume - 3 * 20 * 30 + 1e-6);
      // Every face is generated by its own face; none is deleted.
      const generated = out.history.filter(
        (r) => r.from.kind === 'face' && r.relation === 'generated',
      );
      expect(generated).toHaveLength(6);
    }
    // Too far: the largest distance that works comes back, and works.
    const problemOf = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        expect(error).toBeInstanceOf(OffsetFaceError);
        return (error as OffsetFaceError).problems[0];
      }
      return expect.unreachable('the offset should have failed');
    };
    const far = problemOf(() => kernel.offsetFaces(box, [0], -45));
    expect(far?.kind).toBe('too-far');
    if (far?.kind !== 'too-far') return;
    expect(far.max).toBeGreaterThan(19);
    expect(far.max).toBeLessThan(40);
    scope.track(kernel.offsetFaces(box, [0], -far.max));
    // A cylinder's wall pushed past its axis is junk OCCT calls valid: refused with the radius.
    const cylinder = scope.track(kernel.cylinder(10, 30));
    let wall = -1;
    for (let face = 0; face < 3 && wall < 0; face++) {
      try {
        kernel.offsetFaces(cylinder, [face], -12);
      } catch (error) {
        const p = (error as OffsetFaceError).problems[0];
        if (p?.kind === 'too-far' && p.max > 9 && p.max < 10.01) wall = face;
      }
    }
    expect(wall).toBeGreaterThanOrEqual(0);
    // A solid with a sealed void can't be offset.
    const hollow = scope.track(kernel.shell(box, [], 2));
    expect(problemOf(() => kernel.offsetFaces(hollow.shape, [0], 1))?.kind).toBe('void');
    // Smooth chains: a box with every edge rounded is one chain, a plain box face stands alone.
    const rounded = scope.track(
      kernel.fillet(
        box,
        Array.from({ length: 12 }, (_, i) => i),
        Array(12).fill(4),
      ),
    );
    expect(kernel.tangentFaces(rounded.shape, 0)).toHaveLength(26);
    // Rounded edges that meet at a sharp corner trap OCCT's offset: refused before it runs.
    const topEdges = kernel
      .describe(box)
      .edges.flatMap((e, i) => (Math.abs(e.midpoint[2] - 20) < 1e-6 ? [i] : []));
    expect(topEdges).toHaveLength(4);
    const corner = scope.track(kernel.fillet(box, topEdges.slice(0, 3), [3, 3, 3]));
    expect(problemOf(() => kernel.offsetFaces(corner.shape, [0], 2))?.kind).toBe('sharp-chain');
    expect(problemOf(() => kernel.offsetFaces(corner.shape, [5], -1))?.kind).toBe('sharp-chain');
    expect(kernel.tangentFaces(box, 2)).toEqual([2]);
    // Everything moves together: the rounded body grows all round, from any of its faces.
    const grown = scope.track(kernel.offsetFaces(rounded.shape, [0], 2));
    expect(kernel.isValid(grown.shape)).toBe(true);
    const { min, max } = kernel.measure(grown.shape).bbox;
    expect(max.map((v) => Math.round(v * 100) / 100)).toEqual([42, 32, 22]);
    expect(min.map((v) => Math.round(v * 100) / 100 + 0)).toEqual([-2, -2, -2]);
    // Bad arguments are plain kernel errors.
    expect(() => kernel.offsetFaces(box, [99], 1)).toThrow(/face index out of range/);
    expect(() => kernel.offsetFaces(box, [0], 0)).toThrow(/must not be 0/);
    expect(() => kernel.offsetFaces(box, [], 1)).toThrow(/no face to offset/);
    expect(() => kernel.tangentFaces(box, 99)).toThrow(/out of range/);
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

  it('disposes objects through OcctScope', () => {
    // The build binds no raw OCCT classes (ADR-0037); the scope only needs `delete()`.
    const calls: string[] = [];
    const object = (name: string, clearable: boolean) => ({
      delete: () => calls.push(`${name}.delete`),
      ...(clearable ? { Clear: () => calls.push(`${name}.Clear`) } : {}),
    });
    {
      using scope = new OcctScope();
      scope.track(object('a', false));
      scope.track(object('b', true));
    }
    expect(calls).toEqual(['b.Clear', 'b.delete', 'a.delete']);
  });
});
