/**
 * Patterns, Mirrored, MultiTransform and Hole (P6-25 S7, ADR-0144): the
 * parts FreeCAD made (`pattern-fixtures.ts`) through `importFcstd` with a
 * kernel in Node and the real solver. Each part's stored shapes are
 * FreeCAD's own, so "equal" is our rebuild against FreeCAD's result; and
 * each sense or depth rule read the wrong way on purpose is refused by the
 * check.
 */

import { MAX_HOLES } from '@extrudo/kernel';
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import { DRESSUP_CASES, dressUpSpec } from './dressup-fixtures';
import { documentXml, fcstd, label, links, prop } from './fixtures';
import { historyFile } from './history-fixtures';
import { MAX_HOLE_CENTRES } from './holes';
import { type FcstdImportOptions, importFcstd } from './import';
import { nodeImportKernel } from './node-kernel-test-support';
import { BREP, PATTERN_CASES } from './pattern-fixtures';
import {
  P,
  PATTERN_PARTS,
  type PartChange,
  type PartOptions,
  partFile,
  partObjects,
} from './pattern-parts';

let planegcs: PlanegcsModule;
let kernel: ReturnType<typeof nodeImportKernel>;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
  kernel = nodeImportKernel();
});

export async function runPart(
  name: string,
  change: PartChange = {},
  options: Partial<FcstdImportOptions> = {},
  part: PartOptions = {},
) {
  return runBytes(partFile(name, change, part), options);
}

async function runBytes(bytes: Uint8Array, options: Partial<FcstdImportOptions> = {}) {
  const result = await importFcstd(bytes, 'Parts', {
    kernel,
    solver: new SketchSolver(planegcs),
    ...options,
  });
  const [body] = result.report.bodies;
  return {
    ...result,
    body,
    features: result.design.doc.features.map((f) => `${f.type} ${f.name}`),
  };
}

/** The parts that stop where this slice stops, and why. */
const STOPS: Record<string, [string, RegExp]> = {
  multi_linear_mirror: ['multi-transform', /linear then mirrored/],
  multi_mirror_polar: ['multi-transform', /mirrored then polar/],
  hole_tapered: ['option', /tapered/],
};

const KIND: Record<string, string> = {
  'PartDesign::Pad': 'pad',
  'PartDesign::Pocket': 'pocket',
  'PartDesign::LinearPattern': 'linear',
  'PartDesign::PolarPattern': 'polar',
  'PartDesign::Mirrored': 'mirrored',
  'PartDesign::MultiTransform': 'multi',
  'PartDesign::Hole': 'hole',
};

/** The solid features in a part's chain (MultiTransform's steps are not in it). */
const chainKinds = (name: string) => {
  const c = PATTERN_CASES[name];
  const multi = c?.objects.find((o) => o.type === 'PartDesign::MultiTransform');
  const steps = new Set(
    multi ? c?.group.slice(c.group.indexOf('Pocket') + 1, c.group.indexOf('MultiTransform')) : [],
  );
  return (c?.objects ?? [])
    .filter((o) => o.type && !o.type.startsWith('Sketcher') && !steps.has(o.object))
    .map((o) => KIND[o.type as string]);
};

describe('the fixtures come in with their whole history', () => {
  it.each(PATTERN_PARTS.filter((n) => !STOPS[n]))('%s', async (name) => {
    const { body, features, files } = await runPart(name);
    expect(body?.stop).toBeUndefined();
    expect(body?.outcome).toBe('history');
    expect(body?.mapped.map((m) => m.kind)).toEqual(chainKinds(name));
    expect(features.some((f) => f.startsWith('import'))).toBe(false);
    expect(files.size).toBe(0);
    expect(body?.secondAttempts).toBe(0);
  });

  it.each(Object.entries(STOPS))(
    '%s stops with %s and takes the file shape',
    async (name, [reason, detail]) => {
      const { body, features } = await runPart(name);
      expect(body?.stop?.reason).toBe(reason);
      expect(body?.stop?.detail).toMatch(detail);
      expect(body?.outcome).toBe('shape');
      expect(features.some((f) => f.startsWith('import'))).toBe(true);
    },
  );
});

describe('references', () => {
  it.each([
    ['linear_edge', 'edge'],
    ['linear_edge_y', 'edge'],
    ['polar_edge', 'edge'],
    ['mirrored_face', 'face'],
  ])('%s finds its %s on the rebuilt body, once', async (name, kind) => {
    const { body, design } = await runPart(name);
    const last = body?.mapped.at(-1);
    expect(last?.references).toMatchObject({ found: 1, none: 0, several: 0 });
    const f = design.doc.features.find((x) => x.id === last?.feature);
    expect(JSON.stringify(f?.inputs)).toContain(`"kind":"${kind}"`);
  });

  it.each([
    ['linear_origin_axis', '"origin:x"'],
    ['polar_origin_axis', '"origin:z"'],
    ['mirrored_origin_plane', '"origin:yz"'],
    // A sketch on the XY plane: its V axis through its origin and its normal is the YZ plane.
    ['mirrored_v_axis', '"origin:yz"'],
  ])('%s names the origin feature it coincides with', async (name, id) => {
    const { body, design } = await runPart(name);
    const f = design.doc.features.find((x) => x.id === body?.mapped.at(-1)?.feature);
    expect(JSON.stringify(f?.inputs)).toContain(id);
  });

  it('linear_h_axis steps along the sketch H axis the importer drew', async () => {
    const { body, design } = await runPart('linear_h_axis');
    const f = design.doc.features.find((x) => x.id === body?.mapped.at(-1)?.feature);
    expect(JSON.stringify(f?.inputs)).toMatch(/"kind":"sketchEntity"/);
  });

  it.each([
    // The sketch's normal at (0, 0, 10): an axis through two construction points.
    ['polar_full', 'axisThroughPoints', 3],
    // The plane through the sketch's V axis square to it: a plane at 90° about the drawn line.
    ['mirrored_v_axis', 'planeAtAngle', 1],
    ['mirrored_h_axis', 'planeAtAngle', 1],
    // Two planes at 90° about the drawn lines, and the line where they meet through two points.
    ['multi_mirror_mirror', 'planeAtAngle', 5],
  ])('without the origin shortcut %s makes a %s and still holds', async (name, type, count) => {
    const { body, features } = await runPart(name, {}, { originFirst: false });
    expect(body?.stop).toBeUndefined();
    expect(features.some((f) => f.startsWith(type))).toBe(true);
    expect(body?.mapped.at(-1)?.constructions).toBe(count);
  });

  it('MultiTransform mirror then mirror is a mirror in each plane and a half turn about where they meet', async () => {
    const { body, features } = await runPart('multi_mirror_mirror');
    expect(body?.mapped.at(-1)?.extra).toHaveLength(2);
    expect(features.slice(-3)).toEqual([
      'mirror MultiTransform (1)',
      'mirror MultiTransform (2)',
      'circularPattern MultiTransform (3)',
    ]);
  });

  it('a mirror of every feature so far, the first included, mirrors the body itself', async () => {
    // The plate is symmetric in the plane, so its mirror and the boss's are the stored shape.
    const { body, design } = await runPart('mirrored_pad', {
      Mirrored: { props: { Originals: P.list(['Pad', 'Boss']) } },
    });
    expect(body?.stop).toBeUndefined();
    const f = design.doc.features.find((x) => x.id === body?.mapped.at(-1)?.feature);
    expect(JSON.stringify(f?.inputs)).toMatch(/"kind":"body"/);
  });

  it('the first feature among some but not all of the features is refused', async () => {
    const { body } = await runPart('linear_pad_and_pocket', {
      LinearPattern: { props: { Originals: P.list(['Pad', 'Pocket']) } },
    });
    expect(body?.stop).toMatchObject({ object: 'LinearPattern', reason: 'original' });
    expect(body?.stop?.detail).toMatch(/starts from/);
  });

  it('a face that a later feature changed has no counterpart: the history stops there', async () => {
    // The pad's top face, which the boss across it split.
    const { body } = await runPart('mirrored_face', {
      Mirrored: { props: { MirrorPlane: P.sub('Pad', ['Face6']) } },
    });
    expect(body?.stop).toMatchObject({ object: 'Mirrored', reason: 'reference' });
    expect(body?.stop?.detail).toMatch(/no counterpart/);
    expect(body?.stop?.references).toMatchObject({ none: 1 });
  });

  it('an edge that a later feature split has no counterpart: the history stops there', async () => {
    // The mirror of mirrored_face made a linear pattern along each edge of the pad in turn: the
    // boss across the pad's top splits two of its edges, which then match nothing.
    const reasons: string[] = [];
    for (let k = 1; k <= 12; k++) {
      const { body } = await runPart('mirrored_face', {
        Mirrored: {
          type: 'PartDesign::LinearPattern',
          props: {
            MirrorPlane: undefined,
            Direction: P.sub('Pad', [`Edge${k}`]),
            Occurrences: P.raw('<Integer value="2"/>'),
            Length: P.raw('<Float value="1"/>'),
          },
        },
      });
      reasons.push(`${body?.stop?.reason}: ${body?.stop?.detail}`);
    }
    const none = reasons.filter((r) => /^reference: .*no counterpart/.test(r));
    expect(none.length).toBeGreaterThan(0);
    // The others are found and rebuilt (and differ from the mirror's stored shape), or are no straight edge.
    expect(reasons.every((r) => /^(reference|differs|failed|transform-reference)/.test(r))).toBe(
      true,
    );
  });

  it.each([
    [P.sub('Pad', ['Edge99']), 'element', /Edge99, but Pad has 12 edges/],
    [P.sub('Pad', ['Vertex1']), 'transform-reference', /Vertex1/],
    [P.sub('Pad', ['Face1']), 'transform-reference', /a plane or a face/],
    [P.sub('PocketSketch', ['Edge1']), 'transform-reference', /not a line of the sketch/],
    [P.sub('PocketSketch', ['Axis0']), 'transform-reference', /Axis0 is not in the sketch/],
    [P.sub('Nothing', ['Edge1']), 'transform-reference', /isn't in the file/],
    [P.sub('', []), 'transform-reference', /has no direction/],
    [P.sub('Pocket', ['Edge13']), 'transform-reference', /not a straight edge/],
  ])('a direction %j stops with %s', async (direction, reason, detail) => {
    const { body } = await runPart('linear_edge', {
      LinearPattern: { props: { Direction: direction } },
    });
    expect(body?.stop?.reason).toBe(reason);
    expect(body?.stop?.detail).toMatch(detail);
    expect(body?.outcome).toBe('shape');
  });

  it('a datum line is refused for S9', async () => {
    const extra = [{ name: 'DatumLine', type: 'PartDesign::Line', props: [label('DatumLine')] }];
    const { body } = await runPart(
      'linear_h_axis',
      { LinearPattern: { props: { Direction: P.sub('DatumLine', []) } } },
      {},
      { extra, members: ['DatumLine'] },
    );
    expect(body?.stop).toMatchObject({ reason: 'transform-reference' });
    expect(body?.stop?.detail).toMatch(/datum line/);
  });
});

describe('senses: the right reading holds, the wrong one is refused by the check', () => {
  it.each([
    ['linear_reversed', 'LinearPattern', { Reversed: false }],
    ['linear_h_axis', 'LinearPattern', { Reversed: true }],
    // FreeCAD steps along the edge's line (+x), not its orientation (reversed): taken the other way, refused.
    ['linear_edge', 'LinearPattern', { Reversed: true }],
    ['linear_edge_y', 'LinearPattern', { Reversed: true }],
    ['polar_partial', 'PolarPattern', { Reversed: true }],
    ['polar_partial_reversed', 'PolarPattern', { Reversed: false }],
    ['polar_edge', 'PolarPattern', { Reversed: true }],
    ['linear_two_directions', 'LinearPattern', { Reversed2: true }],
  ])('%s read with %s %j is refused', async (name, object, props) => {
    const { body } = await runPart(name, { [object]: { props } });
    expect(body?.stop?.object).toBe(object);
    // The check refuses it; where the wrong sense puts the copies off the part, Extrudo already does.
    expect(['differs', 'failed']).toContain(body?.stop?.reason);
    expect(body?.secondAttempts).toBe(0);
  });
});

describe('holes', () => {
  it.each([
    // FreeCAD's depth counts the point in with DrillForDepth; read without it, deeper by the point: refused.
    ['hole_blind_angled_in_depth', { DrillForDepth: false }],
    ['hole_blind_angled', { DrillForDepth: true }],
    // A blind counterbore's depth is from the sketch plane, as Extrudo's; from the counterbore's floor it differs.
    ['hole_counterbore_blind', { Depth: 6 + 2 }],
    // Threaded, not modelled: the tap drill as stored; the thread's own diameter differs.
    ['hole_threaded_m6', { Diameter: 6 }],
    ['hole_countersink', { HoleCutCountersinkAngle: 82 }],
    ['hole_blind_flat', { DrillPoint: 1 }],
  ])('%s read wrongly (%j) is refused by the check', async (name, props) => {
    const { body } = await runPart(name, { Hole: { props } });
    expect(body?.stop?.object).toBe('Hole');
    expect(body?.stop?.reason).toBe('differs');
  });

  it('a hole drilled the wrong way cuts nothing: refused', async () => {
    const { body } = await runPart('hole_reversed', { Hole: { props: { Reversed: false } } });
    expect(body?.stop?.object).toBe('Hole');
    expect(['differs', 'failed']).toContain(body?.stop?.reason);
  });

  it('a threaded hole comes in plain, the thread counted as lost', async () => {
    const { body } = await runPart('hole_threaded_m6');
    expect(body?.mapped.at(-1)).toMatchObject({ kind: 'hole', threadLost: true, centres: 2 });
  });

  it('a hole with a cut it names by index only: counterbore first, countersink as the one second attempt', async () => {
    // A bare index past FreeCAD's first three says nothing of the kind.
    const cut = P.raw('<Integer value="5"/>');
    const sink = await runPart('hole_countersink', { Hole: { props: { HoleCutType: cut } } });
    expect(sink.body?.stop).toBeUndefined();
    expect(sink.body?.secondAttempts).toBe(1);
    expect(sink.body?.mapped.at(-1)?.secondAttempt).toBe(true);
    const bore = await runPart('hole_counterbore', { Hole: { props: { HoleCutType: cut } } });
    expect(bore.body?.stop).toBeUndefined();
    expect(bore.body?.secondAttempts).toBe(0);
    // Neither holds (a countersink's stored shape, sizes of a counterbore that isn't): the second attempt stops it.
    const neither = await runPart('hole_countersink', {
      Hole: { props: { HoleCutType: cut, HoleCutCountersinkAngle: 60 } },
    });
    expect(neither.body?.stop?.reason).toBe('differs');
    expect(neither.body?.secondAttempts).toBe(1);
  });

  it.each([
    [
      {
        HoleCutType: P.raw(
          '<Integer value="3" CustomEnum="true"/><CustomEnumList count="4"><Enum value="None"/><Enum value="Counterbore"/><Enum value="Countersink"/><Enum value="Counterdrill"/></CustomEnumList>',
        ),
      },
      'option',
      /counterdrilled/,
    ],
    [{ ModelThread: true, Threaded: true }, 'option', /modelled/],
    [{ DepthType: 2 }, 'up-to', /up to the first face/],
    [{ Diameter: 0 }, 'value', /Diameter of 0 mm/],
    [{ Diameter: -1 }, 'value', /Diameter of -1 mm/],
    [{ Diameter: '1e999' }, 'value', /Diameter can't be read/],
    [{ Midplane: true }, 'option', /both ways/],
  ])('a hole with %j stops with %s', async (props, reason, detail) => {
    const { body } = await runPart('hole_counterbore', { Hole: { props } });
    expect(body?.stop).toMatchObject({ object: 'Hole', reason });
    expect(body?.stop?.detail).toMatch(detail);
  });

  it.each([0, 180])('a countersink angle of %d° stops with value', async (angle) => {
    const { body } = await runPart('hole_countersink', {
      Hole: { props: { HoleCutCountersinkAngle: angle } },
    });
    expect(body?.stop).toMatchObject({ object: 'Hole', reason: 'value' });
  });

  it("caps the centres at Extrudo's own most", () => {
    expect(MAX_HOLE_CENTRES).toBe(MAX_HOLES);
  });
});

describe('originals', () => {
  it('an original that is a pattern stops with original', async () => {
    const { body } = await runPart('hole_then_pattern_then_mirror', {
      Mirrored: { props: { Originals: P.list(['Hole', 'LinearPattern']) } },
    });
    expect(body?.stop).toMatchObject({ object: 'Mirrored', reason: 'original' });
    expect(body?.stop?.detail).toMatch(/pattern or mirror/);
  });

  it.each([
    [['LinearPattern'], /itself/],
    [['Nothing'], /not a feature of this body/],
    [[], /repeats nothing/],
  ])('originals %j stop with original', async (originals, detail) => {
    const { body } = await runPart('linear_h_axis', {
      LinearPattern: { props: { Originals: P.list(originals) } },
    });
    expect(body?.stop).toMatchObject({ object: 'LinearPattern', reason: 'original' });
    expect(body?.stop?.detail).toMatch(detail);
  });

  it('an original that comes after it stops with original', async () => {
    // The pattern repeats the mirror after it (the chain: hole, pattern, mirror).
    const { body } = await runPart('hole_then_pattern_then_mirror', {
      LinearPattern: { props: { Originals: P.list(['Mirrored']) } },
    });
    expect(body?.stop).toMatchObject({ object: 'LinearPattern', reason: 'original' });
    expect(body?.stop?.detail).toMatch(/comes after it/);
  });

  it('an original that is a fillet stops with original', async () => {
    const [pad, fillet] = DRESSUP_CASES.fillet_one_edge ?? [];
    const pattern = {
      name: 'LinearPattern',
      type: 'PartDesign::LinearPattern',
      omit: ['Profile', 'Type', 'Reversed', 'Midplane', 'Length', 'Length2'],
      props: [
        prop(
          'Originals',
          'App::PropertyLinkList',
          '<LinkList count="1"><Link value="Fillet"/></LinkList>',
        ),
        prop(
          'Direction',
          'App::PropertyLinkSub',
          '<LinkSub value="BodyX_Axis" count="0"></LinkSub>',
        ),
        prop('Occurrences', 'App::PropertyIntegerConstraint', '<Integer value="2"/>'),
        prop('Length', 'App::PropertyLength', '<Float value="5"/>'),
      ],
      stored: fillet?.stored,
    };
    const bytes = historyFile([
      {
        name: 'Body',
        origin: true,
        sketches: [
          {
            name: 'Sketch',
            geometry: (await import('./history-fixtures')).rectangle(0, 0, 10, 20),
          },
        ],
        features: [
          { name: 'Pad', type: 'Pad', length: 30, stored: pad?.stored },
          dressUpSpec(fillet as never),
          pattern,
        ],
      },
    ]);
    const { body } = await runBytes(bytes);
    expect(body?.stop).toMatchObject({ object: 'LinearPattern', reason: 'original' });
    expect(body?.stop?.detail).toMatch(/dress-up/);
  });

  it('an original of another body stops with original', async () => {
    const { objects, entries } = partObjects('linear_h_axis');
    const lp = objects.find((o) => o.name === 'LinearPattern');
    const other = {
      ...(lp as (typeof objects)[number]),
      name: 'OtherPattern',
      props: (lp?.props ?? []).map((p) =>
        p.startsWith('<Property name="BaseFeature"')
          ? prop('BaseFeature', 'App::PropertyLink', '<Link value=""/>')
          : p.startsWith('<Property name="Shape"')
            ? prop('Shape', 'Part::PropertyPartShape', '<Part file="LinearPattern.Shape.brp"/>')
            : p,
      ),
    };
    const body2 = {
      name: 'Body001',
      type: 'PartDesign::Body',
      extensions: ['App::OriginGroupExtension'],
      props: [
        label('Other'),
        links('Group', ['OtherPattern']),
        prop('Tip', 'App::PropertyLink', '<Link value="OtherPattern"/>'),
        prop('Shape', 'Part::PropertyPartShape', '<Part file="LinearPattern.Shape.brp"/>'),
      ],
    };
    const bytes = fcstd({
      'Document.xml': documentXml([...objects, body2, other], { version: '1.1.4R (Git)' }),
      ...entries,
    });
    const { report } = await runBytes(bytes);
    const second = report.bodies.find((b) => b.object === 'Body001');
    expect(second?.stop).toMatchObject({ object: 'OtherPattern', reason: 'original' });
    expect(second?.stop?.detail).toMatch(/another body/);
  });
});

describe('a body in a moved container', () => {
  const moved: PartOptions = { bodyAt: [5, -7, 3, Math.PI / 3, [0, 0, 1]] };
  it.each([
    'linear_h_axis',
    'linear_edge',
    'polar_full',
    'mirrored_h_axis',
    'multi_mirror_mirror',
    'hole_counterbore',
  ])('%s comes in with its history', async (name) => {
    const { body } = await runPart(name, {}, {}, moved);
    expect(body?.stop).toBeUndefined();
    expect(body?.outcome).toBe('history');
  });

  it("an origin axis of a moved body is refused, as S5's revolve", async () => {
    const { body } = await runPart('linear_origin_axis', {}, {}, moved);
    expect(body?.stop).toMatchObject({ object: 'LinearPattern', reason: 'transform-reference' });
    expect(body?.stop?.detail).toMatch(/moved body/);
  });
});

it('keeps the fixtures small', () => {
  const bytes = BREP.reduce((n, b) => n + b.length, 0);
  expect(bytes).toBeLessThan(300_000);
});
