/**
 * The references slice's limits and hostile input (P6-25 S9, ADR-0144): every
 * value or reply the importer can't use is a refusal with its reason before
 * the work it would cause, and a limit of ours a clean stop, never a throw
 * out of the import.
 */
import type { GeomRef } from '@extrudo/core';
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import { label } from './fixtures';
import { type FcstdImportOptions, importFcstd } from './import';
import type { ImportKernel } from './import-kernel';
import { nodeImportKernel } from './node-kernel-test-support';
import { P, type PartChange } from './pattern-parts';
import { refFile } from './reference-parts';
import { MAX_UP_TO_TRIES } from './upto';

let planegcs: PlanegcsModule;
let base: ReturnType<typeof nodeImportKernel>;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
  base = nodeImportKernel();
});

async function run(
  name: string,
  change: PartChange = {},
  options: Partial<FcstdImportOptions> = {},
) {
  const r = await importFcstd(refFile(name, change), 'Parts', {
    kernel: base,
    solver: new SketchSolver(planegcs),
    ...options,
  });
  return { ...r, body: r.report.bodies[0] };
}

/** A kernel that counts its calls by name. */
function counting(k: ImportKernel) {
  const calls: Record<string, number> = {};
  const wrap = <K extends keyof ImportKernel>(name: K) =>
    ((...a: unknown[]) => {
      calls[name] = (calls[name] ?? 0) + 1;
      return (k[name] as (...x: unknown[]) => unknown)(...a);
    }) as ImportKernel[K];
  const kernel: ImportKernel = {
    storedShapeToStep: wrap('storedShapeToStep'),
    measureStoredShape: wrap('measureStoredShape'),
    rebuild: wrap('rebuild'),
    describeStoredShape: wrap('describeStoredShape'),
    describeBodies: wrap('describeBodies'),
    references: wrap('references'),
    restart: wrap('restart'),
  };
  return { kernel, calls };
}

describe('limits', () => {
  it(`an up-to feature is tried at most ${MAX_UP_TO_TRIES} times`, () => {
    expect(MAX_UP_TO_TRIES).toBe(4);
  });

  it('past the datums an import may bring in, the feature that needs one more stops with limit', async () => {
    const r = await run('mirror_about_datum_plane', {}, { maxDatums: 0 });
    expect(r.body?.stop).toMatchObject({ object: 'Mirrored', reason: 'limit' });
    expect(r.body?.stop?.detail).toMatch(/more than 0 datums/);
  });

  it('past the external links an import projects, the rest stay out as before S9', async () => {
    const r = await run('external_corner', {}, { maxExternal: 1 });
    expect(r.body?.stop).toBeUndefined();
    const s = r.body?.sketches.find((x) => x.sketch === 'NotchSketch');
    expect(s?.external).toMatchObject({ named: 2, projected: 1 });
    expect(s?.constraints.leftOut).toMatchObject({ external: 1 });
  });
});

describe('numbers a file may hold', () => {
  it.each([
    ['an offset past 10 km', { Bridge: { props: { Offset: 1e8 } } }, 'value'],
    [
      'an offset that is not finite',
      { Bridge: { props: { Offset: P.raw('<Float value="1e999"/>') } } },
      'value',
    ],
  ])('%s is refused before any kernel work on it (%s)', async (_, change, reason) => {
    const { kernel, calls } = counting(base);
    const r = await run('pad_up_to_face_offset', change as PartChange, { kernel });
    expect(r.body?.stop).toMatchObject({ object: 'Bridge', reason });
    // Only what the pad and the walls cost, and the final shape: nothing was looked up for the bridge.
    expect(calls.describeStoredShape ?? 0).toBe(0);
    expect(calls.references ?? 0).toBe(0);
  });

  it('a datum plane at a position past 10 km is refused, no construction made', async () => {
    const r = await run('mirror_about_datum_plane', {
      DatumPlane: { at: [1e8, 0, 0, 0.5, 0.5, 0.5, 0.5] },
    });
    expect(r.body?.stop).toMatchObject({ object: 'Mirrored', reason: 'transform-reference' });
    expect(r.design.doc.features.some((f) => f.name === 'DatumPlane')).toBe(false);
  });

  it.each<[string, string, PartChange]>([
    ['a datum plane', 'Mirrored', { DatumPlane: { at: [3, 0, 0, 0, 0, 0, 0] } }],
    ['a datum line', 'Groove', { DatumLine: { at: [0, -10, 10, 0, 0, 0, 0] } }],
  ])(
    '%s with a rotation of all zeros reads as no rotation, as FreeCAD reads it: a clean stop',
    async (_, feature, change) => {
      const r = await run(
        feature === 'Groove' ? 'groove_about_datum_line' : 'mirror_about_datum_plane',
        change,
      );
      expect(r.body?.stop?.object).toBe(feature);
      expect(['failed', 'differs']).toContain(r.body?.stop?.reason);
      expect(r.body?.outcome).toBe('shape');
    },
  );
});

describe('references a file may hold', () => {
  it.each<[string, PartChange, string, RegExp]>([
    [
      'the feature itself',
      { Bridge: { props: { UpToFace: P.sub('Bridge', ['Face1']) } } },
      'up-to',
      /of itself/,
    ],
    [
      'two faces',
      { Bridge: { props: { UpToFace: P.sub('Walls', ['Face4', 'Face10']) } } },
      'up-to',
      /2 elements/,
    ],
    [
      'an edge',
      { Bridge: { props: { UpToFace: P.sub('Walls', ['Edge4']) } } },
      'up-to',
      /not a face/,
    ],
    [
      'an object not in the file',
      { Bridge: { props: { UpToFace: P.sub('Nowhere', ['Face1']) } } },
      'up-to',
      /isn't in the file/,
    ],
    [
      'a face past the count',
      { Bridge: { props: { UpToFace: P.sub('Walls', ['Face999']) } } },
      'element',
      /has \d+ faces/,
    ],
    [
      'a feature after it',
      { Bridge: { props: { UpToFace: P.sub('BridgeSketch', ['Face1']) } } },
      'up-to',
      /not a feature of this body before it/,
    ],
  ])('an UpToFace naming %s stops with %s', async (_, change, reason, detail) => {
    const r = await run('pad_up_to_face', change);
    expect(r.body?.stop).toMatchObject({ object: 'Bridge', reason });
    expect(r.body?.stop?.detail).toMatch(detail);
    expect(r.body?.outcome).toBe('shape');
  });

  it('an UpToShape of two faces stays up-to', async () => {
    const r = await run('pad_up_to_shape', {
      Bridge: {
        props: {
          UpToShape: {
            subList: [
              ['Walls', 'Face10'],
              ['Walls', 'Face4'],
            ],
          },
        },
      },
    });
    expect(r.body?.stop).toMatchObject({ object: 'Bridge', reason: 'up-to' });
  });

  it.each<[string, PartChange, string]>([
    [
      'the groove itself',
      { Groove: { props: { ReferenceAxis: P.sub('Groove', ['Edge1']) } } },
      'axis',
    ],
    ['a face', { Groove: { props: { ReferenceAxis: P.sub('Pad', ['Face1']) } } }, 'axis'],
    [
      'two edges',
      { Groove: { props: { ReferenceAxis: P.sub('Pad', ['Edge1', 'Edge2']) } } },
      'axis',
    ],
  ])('a revolve axis naming %s stops with %s', async (_, change, reason) => {
    const r = await run('groove_about_edge', change);
    expect(r.body?.stop).toMatchObject({ object: 'Groove', reason });
  });

  it('a datum outside the body is refused', async () => {
    const loose = { name: 'Loose', type: 'PartDesign::Plane', props: [label('Loose')] };
    const r = await importFcstd(
      refFile(
        'mirror_about_datum_plane',
        { Mirrored: { props: { MirrorPlane: P.sub('Loose', []) } } },
        { extra: [loose] },
      ),
      'Parts',
      { kernel: base, solver: new SketchSolver(planegcs) },
    );
    expect(r.report.bodies[0]?.stop).toMatchObject({
      object: 'Mirrored',
      reason: 'transform-reference',
    });
    expect(r.report.bodies[0]?.stop?.detail).toMatch(/outside its body/);
  });
});

describe('a kernel that lies, throws or hangs where S9 asks it something new', () => {
  const lie = (over: Partial<ImportKernel>): ImportKernel => ({ ...base, ...over });
  const never = () => new Promise<never>(() => {});

  it('a reference to the up-to face naming another feature is nonsense: a restart, the bridge stops', async () => {
    const before = base.restarts;
    const r = await run(
      'pad_up_to_face',
      {},
      {
        kernel: lie({
          references: async (items) =>
            items.map(() => ({ kind: 'face', id: 'extrude:nowhere:side:s1' }) as GeomRef),
        }),
      },
    );
    expect(r.body?.stop).toMatchObject({ object: 'Bridge', reason: 'kernel' });
    expect(base.restarts).toBe(before + 1);
  });

  it('a description of the body that throws while the first face is looked for: the bore stops', async () => {
    const r = await run(
      'pocket_up_to_first',
      {},
      {
        kernel: lie({ describeBodies: async () => Promise.reject(new Error('trap')) }),
      },
    );
    expect(r.body?.stop).toMatchObject({ object: 'Bore', reason: 'kernel' });
    expect(r.body?.outcome).toBe('shape');
  });

  it('a description of the body that hangs: the bore stops with time', async () => {
    const r = await run(
      'pocket_up_to_first',
      {},
      {
        kernel: lie({ describeBodies: never }),
        shapeTimeoutMs: 1_500,
      },
    );
    expect(r.body?.stop).toMatchObject({ object: 'Bore', reason: 'time' });
  }, 30_000);

  it('a rebuild whose sketch report has no projections is nonsense: the pocket stops', async () => {
    const r = await run(
      'external_edge_distance',
      {},
      {
        kernel: lie({
          rebuild: async (...a) => {
            const got = await base.rebuild(...a);
            return got.reports
              ? {
                  ...got,
                  reports: Object.fromEntries(
                    Object.keys(got.reports).map((k) => [k, { frame: {} }]),
                  ),
                }
              : got;
          },
        }),
      },
    );
    expect(r.body?.stop).toMatchObject({ object: 'Pocket', reason: 'kernel' });
  });

  it('a rebuild that reports a feature it was not asked about is nonsense', async () => {
    const r = await run(
      'groove_about_datum_line',
      {},
      {
        kernel: lie({
          rebuild: async (...a) => {
            const got = await base.rebuild(...a);
            return { ...got, reports: { ...(got.reports ?? {}), stranger: {} } };
          },
        }),
      },
    );
    expect(r.body?.stop?.reason).toBe('kernel');
  });

  /** A kernel whose first sketch report with projections has every projected line turned round. */
  const turningOnce = () => {
    const seen = { turned: 0, describes: [] as number[] };
    const kernel = lie({
      describeBodies: async (b, n) => {
        const out = await base.describeBodies(b, n);
        seen.describes.push(Object.values(out).reduce((k, d) => k + d.edgeCount, 0));
        return out;
      },
      rebuild: async (...a) => {
        const got = await base.rebuild(...a);
        if (!got.reports || seen.turned > 0) return got;
        const reports = Object.fromEntries(
          Object.entries(got.reports).map(([k, v]) => {
            type Curves = Record<string, { type: string; a: number[]; b: number[] }>;
            const p = (v as { projections?: Record<string, { curves: Curves }> }).projections;
            if (!p) return [k, v];
            seen.turned++;
            const next = Object.fromEntries(
              Object.entries(p).map(([pid, rec]) => [
                pid,
                {
                  ...rec,
                  curves: Object.fromEntries(
                    Object.entries(rec.curves).map(([key, c]) => [
                      key,
                      c.type === 'line' ? { ...c, a: c.b, b: c.a } : c,
                    ]),
                  ),
                },
              ]),
            );
            return [k, { ...(v as object), projections: next }];
          }),
        );
        return { ...got, reports };
      },
    });
    return { kernel, seen };
  };

  it.each([
    ['external_edge_distance', 'PocketSketch', 1],
    ['external_corner', 'NotchSketch', 2],
  ])(
    '%s: a projection the kernel reports turned round once is drawn its way, then back, and its constraints hold',
    async (name, sketch, projected) => {
      const before = base.restarts;
      const { kernel, seen } = turningOnce();
      const r = await run(name, {}, { kernel });
      expect(seen.turned).toBe(1);
      expect(r.body?.stop).toBeUndefined();
      expect(base.restarts).toBe(before);
      const s = r.body?.sketches.find((x) => x.sketch === sketch);
      expect(s?.external).toMatchObject({ projected, out: {} });
      expect(s?.constraints.mapped).toBe(s?.constraints.total);
      // Every try matched on the body before the feature: the notch's edges were found once.
      expect(new Set(seen.describes).size).toBeLessThanOrEqual(1);
    },
    60_000,
  );
});
