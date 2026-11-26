// A body without a solid has no volume where the kernel reports one for a person: `properties`
// gives 0 for a shape without a solid, where `measure` integrates whatever faces it is given (a
// curved face off the origin has a signed "volume" of its own). Two callers read it that way: a
// sheet's parts list (`RecomputeEngine.sheetParts`, the sizes Print Info reports) and the joint
// check's overlap (the common of a solid and a body without one is a face). No public feature makes
// such a body, so the parts list takes one from the test feature `test-face` and the joint check
// one built here. Real OCCT, strict leaks.
import type { BodyId, Sheet } from '@extrudo/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kernelFeatures } from './features';
import { checkJoint } from './joints/check';
import { HINGE, hingeDocument } from './joints/testing';
import { Kernel, type ShapeHandle } from './kernel';
import { loadOcct } from './occt/load';
import { RecomputeEngine } from './recompute/engine';
import { testDocument, testFeature, testFeatures } from './recompute/testing';
import type { RecomputeResult } from './recompute/types';

let kernel: Kernel;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

afterAll(() => {
  expect(kernel.stats().liveShapes).toBe(0);
});

type Done = Extract<RecomputeResult, { status: 'done' }>;

describe('a body without a solid', () => {
  it('has volume 0 in a sheet parts list, as Print Info reports it', async () => {
    const engine = new RecomputeEngine(kernel, testFeatures().registry, { strictLeaks: true });
    try {
      const result = (await engine.recompute({
        doc: testDocument([testFeature('F', 'test-face')]),
      })) as Done;
      const face = 'F:0' as BodyId;
      expect(result.bodies.map((b) => b.id)).toEqual([face]);
      // What `measure` would have given: not 0.
      expect(
        Math.abs(kernel.measure(engine.latestBody(face) as ShapeHandle).volume),
      ).toBeGreaterThan(1);
      const sheet = {
        views: [{ id: 'v', bodies: [face], from: { kind: 'standard' } }],
        items: [{ kind: 'partsList', id: 'list', view: 'v', at: [0, 0] }],
      } as unknown as Sheet;
      const parts = engine.sheetParts(sheet);
      expect(Object.values(parts.lists)).toEqual([[face]]);
      expect(parts.bodies[face]?.volume).toBe(0);
    } finally {
      engine.clear();
    }
  });

  it('makes no overlap in a joint check with a solid it crosses', { timeout: 60_000 }, async () => {
    const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
    using scope = kernel.scope();
    try {
      const result = (await engine.recompute({ doc: hingeDocument() })) as Done;
      const report = result.joints?.[HINGE.id];
      if (!report) throw new Error('no joint report');
      const leafId = 'LeafPlate:0' as BodyId;
      const leaf = engine.latestBody(leafId) as ShapeHandle;
      // A cylinder's curved face through the leaf plate across its thinnest extent.
      const { min, max } = kernel.measureBox(leaf);
      const size = [0, 1, 2].map((k) => (max[k] as number) - (min[k] as number));
      const thin = size.indexOf(Math.min(...size));
      const depth = size[thin] as number;
      const axis: [number, number, number] = [0, 0, 0];
      axis[thin] = 1;
      const centre = [0, 1, 2].map((k) => ((min[k] as number) + (max[k] as number)) / 2);
      const radius = 0.25 * Math.min(...size.filter((_, k) => k !== thin));
      const base = centre.map((v, k) => (k === thin ? (min[k] as number) - depth : v)) as [
        number,
        number,
        number,
      ];
      const cylinder = scope.track(kernel.cylinder(radius, 3 * depth, base, axis));
      const side = kernel.describe(cylinder).faces.findIndex((f) => f.type === 'cylinder');
      const face = scope.track(kernel.subShape(cylinder, 'face', side));
      // What `measure` would have given for their common: an overlap.
      const common = scope.track(kernel.common(leaf, face).shape);
      expect(Math.abs(kernel.measure(common).volume)).toBeGreaterThan(1e-6);
      const faceId = 'Face:0' as BodyId;
      const bodies = new Map([
        [leafId, leaf],
        [faceId, face],
      ]);
      const check = await checkJoint(
        kernel,
        bodies,
        report,
        {
          joint: HINGE,
          moving: [leafId],
          others: [faceId],
          range: { min: 0, max: 0 },
          minGap: 0.2,
        },
        async () => true,
      );
      expect(check.collisions).toEqual([]);
    } finally {
      engine.clear();
    }
  });
});
