/**
 * The S7 review's points (P6-25, ADR-0144's S7 amendment): the element asked
 * for, directions that aren't one, holes in the instance cap, construction
 * points out of range, extents, a hole's cut against its hole, and the check
 * that a pattern or a hole leaves the other FreeCAD bodies exactly as they
 * were.
 */
import { boxBrep } from '@extrudo/kernel/brep-test-support';
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import { NONSENSE_REPLY } from './budget';
import { type Drift, UNTOUCHED_TOLERANCE } from './check';
import { documentXml, fcstd, label, prop } from './fixtures';
import { bodyParts, rectangle } from './history-fixtures';
import { type FcstdImportOptions, importFcstd } from './import';
import type { ImportKernel, ShapeElements } from './import-kernel';
import { nodeImportKernel } from './node-kernel-test-support';
import {
  P,
  PATTERN_PARTS,
  type PartChange,
  type PartOptions,
  partFile,
  partObjects,
} from './pattern-parts';

let planegcs: PlanegcsModule;
let base: ReturnType<typeof nodeImportKernel>;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
  base = nodeImportKernel();
});

async function runBytes(bytes: Uint8Array, options: Partial<FcstdImportOptions> = {}) {
  const r = await importFcstd(bytes, 'Review', {
    kernel: base,
    solver: new SketchSolver(planegcs),
    ...options,
  });
  return { ...r, body: r.report.bodies.at(-1) };
}
const run = (
  name: string,
  change: PartChange = {},
  options: Partial<FcstdImportOptions> = {},
  part: PartOptions = {},
) => runBytes(partFile(name, change, part), options);

const integer = (v: number) => P.raw(`<Integer value="${v}"/>`);
const float = (v: number) => P.raw(`<Float value="${v}"/>`);

type Lie = (k: ImportKernel) => Partial<ImportKernel>;
const lying = (lie: Lie): ImportKernel => {
  const honest: ImportKernel = {
    storedShapeToStep: (...a) => base.storedShapeToStep(...a),
    measureStoredShape: (...a) => base.measureStoredShape(...a),
    rebuild: (...a) => base.rebuild(...a),
    describeStoredShape: (...a) => base.describeStoredShape(...a),
    describeBodies: (b, n) => base.describeBodies(b, n),
    references: (i) => base.references(i),
    restart: () => base.restart(),
  };
  return { ...honest, ...lie(honest) };
};
/** The stored description changed before the importer reads it. */
const stored =
  (
    change: (
      d: ShapeElements,
      ask: { edges: readonly number[]; faces: readonly number[] },
    ) => unknown,
  ): Lie =>
  (k) => ({
    describeStoredShape: async (text, chain, ask) =>
      change(await k.describeStoredShape(text, chain, ask), ask) as ShapeElements,
  });

describe('1. the element asked for, not the first', () => {
  it('a reply with another edge before the one asked still finds the one asked', async () => {
    // linear_edge asks for one edge; the lie puts another described edge in front of it.
    const lie = stored((d, ask) => {
      const asked = ask.edges[0] as number;
      const other = d.edges.find((e) => e.index !== asked);
      const decoy = other ?? { ...(d.edges[0] as object), index: asked === 0 ? 1 : 0 };
      return { ...d, edges: [decoy, ...d.edges.filter((e) => e !== other)] };
    });
    const { body } = await run('linear_edge', {}, { kernel: lying(lie) });
    expect(body?.stop).toBeUndefined();
    expect(body?.mapped.at(-1)?.references).toMatchObject({ found: 1 });
  });

  it('a reply without the element asked is nonsense: a kernel failure', async () => {
    const before = base.restarts;
    const lie = stored((d, ask) => ({
      ...d,
      edges: d.edges.filter((e) => !ask.edges.includes(e.index)),
      faces: d.faces.filter((f) => !ask.faces.includes(f.index)),
    }));
    for (const name of ['linear_edge', 'mirrored_face']) {
      const { body } = await run(name, {}, { kernel: lying(lie) });
      expect(body?.stop).toMatchObject({ reason: 'kernel', detail: NONSENSE_REPLY });
    }
    expect(base.restarts).toBe(before + 2);
  });
});

describe('2. a direction that is not one', () => {
  it('a straight edge whose ends coincide is refused, never an origin axis', async () => {
    const lie = stored((d) => ({
      ...d,
      edges: d.edges.map((e) => (e.ends ? { ...e, ends: [e.ends[0], e.ends[0]] } : e)),
    }));
    const { body } = await run('linear_edge', {}, { kernel: lying(lie) });
    expect(body?.stop).toMatchObject({ reason: 'transform-reference' });
    expect(body?.stop?.detail).toMatch(/has no length/);
  });

  it('a flat face with no direction is refused, never an origin plane', async () => {
    const lie = stored((d) => ({
      ...d,
      faces: d.faces.map((f) => ({ ...f, direction: [0, 0, 0] })),
    }));
    const { body } = await run('mirrored_face', {}, { kernel: lying(lie) });
    expect(body?.stop).toMatchObject({ reason: 'transform-reference' });
    expect(body?.stop?.detail).toMatch(/not a flat face/);
  });
});

/** A LinearPattern after the last feature of a part, repeating `original` along the origin X axis. */
const patternAfter = (base: string, original: string, count: number): PartOptions => ({
  extra: [
    {
      name: 'Row',
      type: 'PartDesign::LinearPattern',
      props: [
        label('Row'),
        prop('BaseFeature', 'App::PropertyLink', `<Link value="${base}"/>`),
        prop(
          'Originals',
          'App::PropertyLinkList',
          `<LinkList count="1"><Link value="${original}"/></LinkList>`,
        ),
        prop('Direction', 'App::PropertyLinkSub', '<LinkSub value="X_Axis" count="0"></LinkSub>'),
        prop('Occurrences', 'App::PropertyIntegerConstraint', `<Integer value="${count}"/>`),
        prop('Length', 'App::PropertyLength', '<Float value="0.5"/>'),
        prop('Shape', 'Part::PropertyPartShape', `<Part file="${base}.Shape.brp"/>`),
      ],
    },
  ],
  members: ['Row'],
  tip: 'Row',
});

describe('3. a hole among the originals counts by its centres', () => {
  it('a hole of two centres repeated 126 times counts 504 (each centre twice): a clean stop before the kernel', async () => {
    const before = base.restarts;
    let rebuilds = 0;
    const counting: Lie = (k) => ({
      rebuild: (...a) => {
        rebuilds++;
        return k.rebuild(...a);
      },
    });
    const { body } = await run(
      'hole_blind_flat',
      {},
      { kernel: lying(counting) },
      patternAfter('Hole', 'Hole', 126),
    );
    expect(body?.mapped.map((m) => m.kind)).toEqual(['pad', 'hole']);
    expect(body?.stop).toMatchObject({ object: 'Row', reason: 'limit' });
    expect(body?.stop?.detail).toMatch(/504 instances/);
    // Two rebuilds (the pad, the hole), none for the pattern.
    expect(rebuilds).toBe(2);
    expect(base.restarts).toBe(before);
  });

  it('125 of them count 500, within the cap: the pattern reaches the kernel', async () => {
    let rebuilds = 0;
    // The third rebuild (the pattern's) fails at once: only that it was asked matters here.
    const third: Lie = (k) => ({
      rebuild: (...a) =>
        ++rebuilds >= 3 ? Promise.reject(new Error('stop here')) : k.rebuild(...a),
    });
    const { body } = await run(
      'hole_blind_flat',
      {},
      { kernel: lying(third) },
      patternAfter('Hole', 'Hole', 125),
    );
    expect(body?.stop).toMatchObject({ object: 'Row', reason: 'kernel', detail: 'stop here' });
    expect(rebuilds).toBe(3);
  });
});

describe('4. the sketch axes asked for up front', () => {
  it('a direction naming 100,000 sub-elements is refused, and the look ahead skips it', async () => {
    const subs = Array.from({ length: 100_000 }, () => 'H_Axis');
    const t = performance.now();
    const { body } = await run('linear_h_axis', {
      LinearPattern: { props: { Direction: P.sub('PocketSketch', subs) } },
    });
    expect(body?.stop).toMatchObject({ reason: 'transform-reference' });
    expect(body?.stop?.detail).toMatch(/several elements/);
    expect(performance.now() - t).toBeLessThan(5_000);
  });
});

describe('5. construction points out of range', () => {
  it('an axis whose points would lie past 10 km is refused with transform-reference', async () => {
    // The pocket sketch's normal, its sketch moved 2e7 mm away along x: no origin axis, no drawn line.
    const { body } = await run('polar_full', {}, { originFirst: false }, { bodyAt: [2e7, 0, 0] });
    expect(body?.mapped.map((m) => m.kind)).toEqual(['pad', 'pocket']);
    expect(body?.stop).toMatchObject({ object: 'PolarPattern', reason: 'transform-reference' });
    expect(body?.stop?.detail).toMatch(/past 10000000 mm/);
  });
});

describe('6. extents', () => {
  it('a row reaching past 10 km is refused with value', async () => {
    const { body } = await run('linear_spacing', {
      LinearPattern: { props: { Occurrences: integer(3), Offset: float(6e6) } },
    });
    expect(body?.stop).toMatchObject({ object: 'LinearPattern', reason: 'value' });
    expect(body?.stop?.detail).toMatch(/past 10000000 mm/);
  });

  it('steps past a whole turn map as FreeCAD turns them (on, round again): rebuilt, then checked', async () => {
    // polar_spacing's step, 2 more instances than it has: 5 steps go past 360°.
    const { body } = await run('polar_spacing', {
      PolarPattern: { props: { Occurrences: integer(8), Offset: float(60) } },
    });
    expect(body?.stop?.object).toBe('PolarPattern');
    // Mapped and rebuilt; the stored shape is the file's own count's, so the check refuses it.
    expect(body?.stop?.reason).toBe('differs');
  });

  it('gaps count only in Spacing mode, as FreeCAD reads them', async () => {
    const extent = await run('linear_h_axis', {
      LinearPattern: { props: { Spacings: P.floats([5, 0]) } },
    });
    expect(extent.body?.stop).toBeUndefined();
    const spacing = await run('linear_spacing', {
      LinearPattern: { props: { Spacings: P.floats([0, -1]) } },
    });
    expect(spacing.body?.stop).toMatchObject({ reason: 'option' });
  });
});

describe("7. a hole's cut against its hole", () => {
  it.each([
    ['hole_counterbore', { HoleCutDiameter: 4 }, /not larger than its Diameter/],
    ['hole_counterbore_blind', { HoleCutDepth: 7 }, /as deep as the hole/],
    ['hole_countersink', { HoleCutDiameter: 3 }, /not larger than its Diameter/],
  ])('%s with %j stops with value before Extrudo sees it', async (name, props, detail) => {
    const { body } = await run(name, { Hole: { props } });
    expect(body?.stop).toMatchObject({ object: 'Hole', reason: 'value' });
    expect(body?.stop?.detail).toMatch(detail);
  });

  it('a cut the file does not name tries only what can be built', async () => {
    // Countersink sizes with no depth: a counterbore is out, so the countersink is the one attempt.
    const { body } = await run('hole_countersink', {
      Hole: { props: { HoleCutType: P.raw('<Integer value="5"/>'), HoleCutDepth: 0 } },
    });
    expect(body?.stop).toBeUndefined();
    expect(body?.secondAttempts).toBe(0);
  });
});

/** A large box body, walked before the part, with its own sketch and pad (`Big…`). */
function withBig(
  name: string,
  box: { min: [number, number, number]; max: [number, number, number] },
  change: PartChange = {},
): Uint8Array {
  const big = bodyParts({
    name: 'BigBody',
    label: 'Big',
    sketches: [
      {
        name: 'BigSketch',
        geometry: rectangle(box.min[0], box.min[1], box.max[0], box.max[1]),
        placement: [0, 0, box.min[2]],
      },
    ],
    features: [
      {
        name: 'BigPad',
        type: 'Pad',
        sketch: 'BigSketch',
        length: box.max[2] - box.min[2],
        stored: boxBrep(box.min, box.max),
      },
    ],
  });
  const part = partObjects(name, change);
  return fcstd({
    'Document.xml': documentXml([...big.objects, ...part.objects], { version: '1.1.4R (Git)' }),
    ...big.entries,
    ...part.entries,
  });
}

describe('8. other bodies come out exactly as they were', () => {
  // A block of 988 × 1000 × 100 mm under the plate, reaching under one of the two through holes
  // (radius 2.5 mm, centre x = -10) by `overlap` mm.
  const under = (overlap: number) =>
    withBig('hole_through', { min: [-1000, -500, -100], max: [-12.5 + overlap, 500, 0] });

  it('a sliver under 1e-6 of the other body: Extrudo leaves that body as it was, so the part holds', async () => {
    // 0.05 mm under the hole: 3.3 mm³ of 9.9e7, 3e-8 of its volume. Extrudo's cut leaves a body
    // alone when it would take less than 1e-6 of its volume (`operate`), and the check sees it
    // exactly as it was.
    const seen: Drift[] = [];
    const { report } = await runBytes(under(0.05), { onUntouched: (d) => seen.push(d) });
    expect(report.bodies.find((b) => b.object === 'Body')?.stop).toBeUndefined();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ volume: 0, area: 0, corner: 0, centre: 0 });
  });

  it('a cut past Extrudo own threshold into another body stops with differs, by its faces and edges', async () => {
    // 1 mm under the hole: 280 mm³, 2.8e-6 of its volume.
    const { report } = await runBytes(under(1));
    const part = report.bodies.find((b) => b.object === 'Body');
    expect(part?.stop).toMatchObject({ object: 'Hole', reason: 'differs' });
    expect(part?.stop?.detail).toMatch(/another FreeCAD body: its solids, faces or edges changed/);
    expect(part?.secondAttempts).toBe(0);
    expect(report.bodies.find((b) => b.object === 'BigBody')?.outcome).toBe('history');
  });

  it('an untouched body moves by rounding at most between rebuilds (every transform and hole part, measured)', async () => {
    const drifts: Drift[] = [];
    const parts = PATTERN_PARTS.filter(
      (n) => !['multi_linear_mirror', 'multi_mirror_polar', 'hole_tapered'].includes(n),
    );
    for (const name of parts) {
      const bytes = withBig(name, { min: [1000, 0, 0], max: [1010, 10, 10] });
      const { report } = await runBytes(bytes, { onUntouched: (d) => drifts.push(d) });
      expect(report.bodies.find((b) => b.object === 'Body')?.stop).toBeUndefined();
    }
    const worst = (k: 'volume' | 'area') => Math.max(...drifts.map((d) => d[k]));
    const worstOfDiagonal = (k: 'corner' | 'centre') =>
      Math.max(...drifts.map((d) => (d.diagonal > 0 ? d[k] / d.diagonal : d[k])));
    const summary = {
      checks: drifts.length,
      volume: worst('volume'),
      area: worst('area'),
      corner: worstOfDiagonal('corner'),
      centre: worstOfDiagonal('centre'),
    };
    console.log('untouched drift on the fixtures', JSON.stringify(summary));
    expect(drifts.length).toBeGreaterThan(30);
    for (const v of [summary.volume, summary.area, summary.corner, summary.centre])
      expect(v).toBeLessThanOrEqual(UNTOUCHED_TOLERANCE / 1000);
    // About 3 s unloaded (35 imports), which the default 5 s doesn't leave a loaded runner room for.
  }, 60_000);
});
