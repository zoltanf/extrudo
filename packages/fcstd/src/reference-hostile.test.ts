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
import { REF_CASES } from './reference-fixtures';
import { refFile } from './reference-parts';
import { arcThrough } from './transforms';
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

describe('projected arcs a file or a kernel may get wrong', () => {
  const lie = (over: Partial<ImportKernel>): ImportKernel => ({ ...base, ...over });
  /** The concentric arc fixture's stored projection, with some of its numbers replaced. */
  const stored = REF_CASES.external_arc_concentric?.objects.find((o) => o.object === 'PocketSketch')
    ?.sketch?.externalGeo?.[0] as (string | number)[];
  const arc = (over: Record<number, number>) => ({
    PocketSketch: { externalGeo: [stored.map((v, i) => (i in over ? over[i] : v)) as never] },
  });
  /** The pocket's sketch as it came in when the arc stays out: its radius only, the concentric constraint out. */
  const asBefore = (r: Awaited<ReturnType<typeof run>>, cause: string) => {
    expect(r.body?.stop).toBeUndefined();
    expect(r.body?.outcome).toBe('history');
    expect(r.body?.mapped.length).toBe(r.body?.features);
    const s = r.body?.sketches.find((x) => x.sketch === 'PocketSketch');
    expect(s?.external).toEqual({ named: 1, projected: 0, constraints: 0, out: { [cause]: 1 } });
    expect(s?.constraints).toMatchObject({ total: 2, mapped: 1, leftOut: { external: 1 } });
  };

  it('the stored arc is the fixture we think it is', () => {
    expect(stored.slice(0, 8)).toEqual([
      'arc',
      14,
      4.000000000000001,
      6,
      -Math.PI / 2,
      Math.PI / 2,
      Math.PI,
      1,
    ]);
  });

  // Numbers the reader refuses leave the record unread (`link`); numbers it reads but that
  // make no arc to draw are `kind`.
  it.each([
    ['a radius of zero', { 3: 0 }, 'link'],
    ['a radius not finite', { 3: Number.NaN }, 'link'],
    ['a centre not finite', { 1: Number.POSITIVE_INFINITY }, 'link'],
    ['a radius past the length limit', { 3: 2e7 }, 'kind'],
    ['a centre past the length limit', { 1: 2e7 }, 'kind'],
    ['a start equal to the end', { 6: Math.PI / 2 }, 'link'],
    ['an angle sweep of nothing', { 6: Math.PI / 2 + 1e-11 }, 'kind'],
    ['a radius too small to tell its ends apart', { 3: 1e-7 }, 'kind'],
  ])(
    'a stored arc with %s stays out, the sketch as before',
    async (_, over, cause) => {
      asBefore(await run('external_arc_concentric', arc(over)), cause);
    },
    60_000,
  );

  it('a stored arc elsewhere (another radius): the kernel reports it elsewhere, it stays out', async () => {
    asBefore(await run('external_arc_concentric', arc({ 3: 6.5 })), 'elsewhere');
  }, 60_000);

  /** A kernel whose sketch reports have each projected arc replaced by `swap` (from the `n`th report on, while `when` says so). */
  const reporting = (
    swap: (c: Record<string, unknown>) => unknown,
    when = (_n: number) => true,
  ) => {
    const seen = { reports: 0 };
    const kernel = lie({
      rebuild: async (...a) => {
        const got = await base.rebuild(...a);
        if (!got.reports) return got;
        const reports = Object.fromEntries(
          Object.entries(got.reports).map(([k, v]) => {
            type Curves = Record<string, Record<string, unknown>>;
            const p = (v as { projections?: Record<string, { curves: Curves }> }).projections;
            if (!p) return [k, v];
            if (!when(seen.reports++)) return [k, v];
            const next = Object.fromEntries(
              Object.entries(p).map(([pid, rec]) => [
                pid,
                {
                  ...rec,
                  curves: Object.fromEntries(
                    Object.entries(rec.curves).map(([key, c]) => [
                      key,
                      c.type === 'arc' ? swap(c) : c,
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
  const turned = (c: Record<string, unknown>) => ({ ...c, start: c.end, end: c.start });

  it.each([
    ['a line', (c: Record<string, unknown>) => ({ type: 'line', a: c.start, b: c.end })],
    ['a circle', (c: Record<string, unknown>) => ({ type: 'circle', center: c.center, radius: 6 })],
    [
      'another radius',
      (c: Record<string, unknown>) => {
        const [x, y] = c.center as number[];
        return { ...c, start: [(x ?? 0) + 7, y], end: [x, (y ?? 0) + 7] };
      },
    ],
    ['nothing', () => undefined],
  ])(
    'a kernel that reports %s for the arc: it stays out, the sketch as before',
    async (_, swap) => {
      asBefore(
        await run('external_arc_concentric', {}, { kernel: reporting(swap).kernel }),
        'elsewhere',
      );
    },
    60_000,
  );

  it('a kernel that reports the arc turned round once: drawn its way, then back; every constraint holds', async () => {
    const before = base.restarts;
    const { kernel, seen } = reporting(turned, (n) => n === 0);
    const r = await run('external_arc_ends', {}, { kernel });
    expect(seen.reports).toBe(3);
    expect(base.restarts).toBe(before);
    expect(r.body?.stop).toBeUndefined();
    const s = r.body?.sketches.find((x) => x.sketch === 'NotchSketch');
    expect(s?.external).toEqual({ named: 1, projected: 1, constraints: 3, out: {} });
    expect(s?.constraints.mapped).toBe(s?.constraints.total);
  }, 60_000);

  it("a kernel that always reports the other arc: drawn its way, the ends' constraints still the file's", async () => {
    const { kernel, seen } = reporting(turned);
    const r = await run('external_arc_ends', {}, { kernel });
    expect(seen.reports).toBe(2);
    expect(r.body?.stop).toBeUndefined();
    const s = r.body?.sketches.find((x) => x.sketch === 'NotchSketch');
    expect(s?.external).toEqual({ named: 1, projected: 1, constraints: 3, out: {} });
    // The notch's corners on FreeCAD's start (20, 4) and end (14, 10) were vetted where they
    // are: had a turned arc renamed its ends, the solver would have moved the corners.
    expect(s?.constraints.mapped).toBe(s?.constraints.total);
    const f = r.design.doc.features.find((x) => x.name === 'NotchSketch');
    const data = (f?.inputs as unknown as { sketch: { sketch: unknown } }).sketch.sketch as {
      entities: Record<string, Record<string, unknown>>;
      projections: Record<string, { curves: Record<string, string> }>;
    };
    const e = data.entities[Object.values(data.projections)[0]?.curves.edge as string] as Record<
      string,
      string
    >;
    const at = (id = '') => [data.entities[id]?.x, data.entities[id]?.y] as number[];
    const near = (p: number[], q: number[]) =>
      expect(Math.hypot((p[0] ?? 0) - (q[0] ?? 0), (p[1] ?? 0) - (q[1] ?? 0))).toBeLessThan(1e-9);
    // Extrudo's arc now runs counter-clockwise from FreeCAD's end to its start.
    near(at(e.start), [14, 10]);
    near(at(e.end), [20, 4]);
  }, 60_000);

  it('a kernel that turns the arc every time it is drawn: turned back once, then left out', async () => {
    // Every other report turned: the first against the drawing, the second against the turn.
    const { kernel, seen } = reporting(turned, (n) => n % 2 === 0);
    const r = await run('external_arc_ends', {}, { kernel });
    expect(seen.reports).toBe(3);
    expect(r.body?.stop).toBeUndefined();
    expect(r.body?.outcome).toBe('history');
    const s = r.body?.sketches.find((x) => x.sketch === 'NotchSketch');
    expect(s?.external).toEqual({ named: 1, projected: 0, constraints: 0, out: { elsewhere: 1 } });
    expect(s?.constraints).toMatchObject({ total: 6, mapped: 3, leftOut: { external: 3 } });
  }, 60_000);

  it('a description whose arc has its middle off the circle: before 1.0 the arc stays out', async () => {
    const kernel = lie({
      describeStoredShape: async (...a) => {
        const got = await base.describeStoredShape(...a);
        return {
          ...got,
          edges: got.edges.map((e) =>
            e.type === 'circle' && e.ends?.length === 2
              ? { ...e, midpoint: [e.midpoint[0] + 0.5, e.midpoint[1], e.midpoint[2]] as const }
              : e,
          ),
        };
      },
    });
    asBefore(
      await run(
        'external_arc_concentric',
        { PocketSketch: { externalGeo: undefined } },
        { kernel },
      ),
      'kind',
    );
  }, 60_000);

  describe('arcThrough: the arc of an edge projected along the normal', () => {
    const c: [number, number] = [14, 4];
    it('takes the arc through the middle, counter-clockwise, whichever end comes first', () => {
      const m: [number, number] = [14 + 6 * Math.SQRT1_2, 4 + 6 * Math.SQRT1_2];
      for (const [a, b] of [
        [
          [20, 4],
          [14, 10],
        ],
        [
          [14, 10],
          [20, 4],
        ],
      ] as [number, number][][]) {
        const g = arcThrough(c, 6, a as [number, number], b as [number, number], m);
        expect(g?.startAngle).toBeCloseTo(0, 12);
        expect(g?.endAngle).toBeCloseTo(Math.PI / 2, 12);
      }
      // The middle on the other side: the other arc, three quarters of the circle.
      const g = arcThrough(c, 6, [20, 4], [14, 10], [14 - 6 * Math.SQRT1_2, 4 - 6 * Math.SQRT1_2]);
      expect(g?.startAngle).toBeCloseTo(Math.PI / 2, 12);
      expect(g?.endAngle).toBeCloseTo(2 * Math.PI, 12);
    });
    it.each([
      ['a radius of zero', 0, [14, 4], [14, 4], [14, 4]],
      ['a radius not finite', Number.NaN, [20, 4], [14, 10], [18, 8]],
      ['a radius past the length limit', 2e7, [20, 4], [14, 10], [18, 8]],
      [
        'an end off the circle',
        6,
        [20.1, 4],
        [14, 10],
        [14 + 6 * Math.SQRT1_2, 4 + 6 * Math.SQRT1_2],
      ],
      ['the middle off the circle', 6, [20, 4], [14, 10], [18, 8]],
      ['a start equal to the end', 6, [20, 4], [20, 4], [8, 4]],
      ['the middle on an end', 6, [20, 4], [14, 10], [20, 4]],
    ])('makes none of %s', (_, r, a, b, m) => {
      expect(
        arcThrough(
          c,
          r as number,
          a as [number, number],
          b as [number, number],
          m as [number, number],
        ),
      ).toBeUndefined();
    });
  });
});
