// A body the engine keeps in its cache is never changed by a later step (ADR-0035's amendment of
// 2026-11-25). A plate whose corner sits on a curved body is cut from it (or intersected), then
// edited to join it, with a New Body "through all" after: the engine that kept its cache gives
// what a cleared engine gives, bit for bit: every mesh, every body's `measure` box (tolerances
// included) and the statuses. The plate's sketch is in the cache too: its profile face is the
// plate's bottom cap. Real OCCT, strict leaks, no clock.
import {
  constructionRef,
  createDocument,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  type GeomRef,
  loftInputs,
  originPlaneRef,
  primitiveInputs,
  profileRefId,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kernelFeatures } from '../features/index';
import { Kernel } from '../kernel';
import { type BodyMesh, sameMesh } from '../mesh';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from './engine';
import type { RecomputeResult } from './types';

type Done = Extract<RecomputeResult, { status: 'done' }>;

let kernel: Kernel;
beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});
afterAll(() => {
  expect(kernel.stats().liveShapes).toBe(0);
});

const length = (expr: string) => ({ kind: 'expr' as const, expr, unit: 'length' as const });

function sketch(
  id: string,
  draw: (b: SketchBuilder) => void,
  plane: GeomRef = originPlaneRef('origin:xy'),
) {
  const b = new SketchBuilder();
  draw(b);
  const feature: Feature = {
    id: id as FeatureId,
    type: 'sketch',
    name: id,
    suppressed: false,
    inputs: sketchInputs(plane, b.sketch),
  };
  const [region] = detectProfiles(b.sketch).sort((x, y) => y.area - x.area);
  return {
    feature,
    profile: { kind: 'profile', id: profileRefId(id as FeatureId, region?.id ?? '') } as GeomRef,
  };
}

const rect = (x: number, y: number, w: number, h: number) => (b: SketchBuilder) => {
  b.line(x, y, x + w, y);
  b.line(x + w, y, x + w, y + h);
  b.line(x + w, y + h, x, y + h);
  b.line(x, y + h, x, y);
};

function extrude(
  id: string,
  profile: GeomRef,
  options: Parameters<typeof extrudeInputs>[1],
): Feature {
  return {
    id: id as FeatureId,
    type: 'extrude',
    name: id,
    suppressed: false,
    inputs: extrudeInputs([profile], options),
  };
}

/** A torus Ø40 (tube Ø10) on XY: its inner equator passes through (15, 0, 0). */
const torus = (): Feature[] => [
  {
    id: 'body' as FeatureId,
    type: 'torus',
    name: 'Torus',
    suppressed: false,
    inputs: primitiveInputs('torus', {
      numbers: { diameter: '40 mm', tube: '10 mm' },
      plane: originPlaneRef('origin:xy'),
    }),
  },
];

/** A smooth loft from a 20 mm square on XY (x 70…90, y 0…20) through a circle 10 mm up to a 10 mm square 20 mm up. */
function loft(): Feature[] {
  const plane = (id: string, distance: string): Feature => ({
    id: id as FeatureId,
    type: 'offsetPlane',
    name: id,
    suppressed: false,
    inputs: {
      plane: { kind: 'ref', refs: [originPlaneRef('origin:xy')] },
      distance: length(distance),
    },
  });
  const p1 = plane('p1', '10 mm');
  const p2 = plane('p2', '20 mm');
  const s1 = sketch('l1', rect(70, 0, 20, 20));
  const s2 = sketch('l2', (b) => b.circle(80, 10, 6), constructionRef(p1) as GeomRef);
  const s3 = sketch('l3', rect(75, 5, 10, 10), constructionRef(p2) as GeomRef);
  return [
    s1.feature,
    p1,
    s2.feature,
    p2,
    s3.feature,
    {
      id: 'body' as FeatureId,
      type: 'loft',
      name: 'Loft',
      suppressed: false,
      inputs: loftInputs([s1.profile, s2.profile, s3.profile]),
    },
  ];
}

/** The body, then a 60 × 40 × 3 mm plate from (15, 0) doing `operation`, then a disc "through all". */
function design(body: () => Feature[], operation: 'cut' | 'intersect' | 'join'): ExtrudoDocument {
  const plate = sketch('ps', rect(15, 0, 60, 40));
  const disc = sketch('ds', (b) => b.circle(200, 0, 10));
  const features = [
    ...body(),
    plate.feature,
    extrude('plate', plate.profile, { distance: '3 mm', operation }),
    disc.feature,
    extrude('disc', disc.profile, { extent: 'through-all', direction: 'symmetric' }),
  ];
  return {
    ...createDocument({ name: 'cached body' }),
    features,
    timelineMarker: features.length,
  } as ExtrudoDocument;
}

async function run(engine: RecomputeEngine, doc: ExtrudoDocument): Promise<Done> {
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error('cancelled');
  return result;
}

describe('a cached body is never changed by a later step (ADR-0035, 2026-11-25)', () => {
  it.each([
    ['a torus', 'cut', torus],
    ['a torus', 'intersect', torus],
    ['a loft', 'cut', loft],
    ['a loft', 'intersect', loft],
  ] as const)(
    "%s, the plate as a %s, then a join: the cached engine gives a cleared one's result",
    {
      timeout: 120_000,
    },
    async (_name, first, body) => {
      const cached = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
      const cleared = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
      try {
        await run(cached, design(body, first));
        const mine = await run(cached, design(body, 'join'));
        const fresh = await run(cleared, design(body, 'join'));
        expect(mine.features).toEqual(fresh.features);
        for (const status of Object.values(fresh.features)) expect(status.status).toBe('ok');
        expect(mine.stats.evaluated).toEqual(['plate', 'disc']);
        expect(mine.bodies.map((b) => b.id)).toEqual(fresh.bodies.map((b) => b.id));
        for (const b of fresh.bodies) {
          const x = cached.latestBody(b.id);
          const y = cleared.latestBody(b.id);
          expect(x && y && kernel.measure(x).bbox, b.id).toEqual(y && kernel.measure(y).bbox);
          const m = mine.bodies.find((c) => c.id === b.id)?.mesh as BodyMesh;
          expect(sameMesh(m, b.mesh as BodyMesh), b.id).toBe(true);
        }
      } finally {
        cached.clear();
        cleared.clear();
      }
    },
  );
});
