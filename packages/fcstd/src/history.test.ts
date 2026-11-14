/**
 * PartDesign bodies with their history (P6-25 S5, ADR-0144): authored files
 * through `importFcstd` with a kernel in Node and the real sketch solver.
 * Each feature's stored shape is a box or a cylinder the kernel's test
 * support writes, so "equal" is the kernel's own measure of both sides.
 */
import { type Feature, readSketch } from '@extrudo/core';
import { boxBrep, cylinderBrep } from '@extrudo/kernel/brep-test-support';
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import { link, prop } from './fixtures';
import {
  type BodySpec,
  bool,
  choice,
  type FeatureSpec,
  facingX,
  historyFile,
  linkSub,
  measureText,
  num,
  onXZ,
  rectangle,
} from './history-fixtures';
import { type FcstdImportOptions, importFcstd } from './import';
import type { ImportKernel, ShapeMeasure } from './import-kernel';
import { nodeImportKernel } from './node-kernel-test-support';
import { arc, circle, line } from './sketch-fixtures';

let planegcs: PlanegcsModule;
let base: ReturnType<typeof nodeImportKernel>;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
  base = nodeImportKernel();
});

/** The node kernel, but a stored "shape" written by `measureText` answers with its measure. */
function measuring(kernel: ImportKernel = base): ImportKernel {
  return {
    ...kernel,
    storedShapeToStep: (t, c) => kernel.storedShapeToStep(t, c),
    rebuild: (d, f, s) => kernel.rebuild(d, f, s),
    restart: () => kernel.restart(),
    measureStoredShape: async (text, chain) => {
      const at = text.indexOf('MEASURE ');
      if (at >= 0) return JSON.parse(text.slice(at + 8)) as ShapeMeasure;
      return kernel.measureStoredShape(text, chain);
    },
  };
}

async function run(
  bodies: BodySpec[],
  options: Partial<FcstdImportOptions> & Parameters<typeof historyFile>[1] = {},
) {
  const { extra, entries, version, hidden, ...rest } = options;
  const bytes = historyFile(bodies, {
    ...(extra ? { extra } : {}),
    ...(entries ? { entries } : {}),
    ...(version ? { version } : {}),
    ...(hidden ? { hidden } : {}),
  });
  const result = await importFcstd(bytes, 'History', {
    kernel: measuring(),
    solver: new SketchSolver(planegcs),
    ...rest,
  });
  const features = result.design.doc.features.map((f) => `${f.type} ${f.name}`);
  return { ...result, features };
}

const BOX = boxBrep([0, 0, 0], [10, 20, 30]);
/** A body of one pad: a 10 × 20 rectangle on XY, padded 30 mm. */
const padBody = (
  extra: Partial<FeatureSpec> = {},
  stored = BOX,
  sketch: Partial<BodySpec['sketches'][number]> = {},
): BodySpec => ({
  name: 'Body',
  label: 'Bracket',
  sketches: [{ name: 'Sketch', geometry: rectangle(0, 0, 10, 20), ...sketch }],
  features: [{ name: 'Pad', type: 'Pad', length: 30, stored, ...extra }],
});

describe('a body of pads and pockets', () => {
  it('comes in as its sketches and features, checked, with no import', async () => {
    const { features, report, files, design } = await run([
      {
        name: 'Body',
        label: 'Bracket',
        sketches: [
          { name: 'Sketch', geometry: rectangle(0, 0, 10, 20) },
          { name: 'Sketch001', geometry: rectangle(-1, -1, 11, 21), placement: [0, 0, 30] },
        ],
        features: [
          { name: 'Pad', type: 'Pad', length: 30, stored: BOX },
          {
            name: 'Pocket',
            type: 'Pocket',
            sketch: 'Sketch001',
            length: 10,
            stored: boxBrep([0, 0, 0], [10, 20, 20]),
          },
        ],
      },
    ]);
    expect(features).toEqual([
      'sketch Sketch',
      'extrude Pad',
      'offsetPlane Sketch001 plane',
      'sketch Sketch001',
      'extrude Pocket',
    ]);
    expect(files.size).toBe(0);
    expect(report.shapes).toEqual([]);
    const [body] = report.bodies;
    expect(body?.outcome).toBe('history');
    expect(body?.mapped.map((m) => [m.object, m.kind])).toEqual([
      ['Pad', 'pad'],
      ['Pocket', 'pocket'],
    ]);
    expect(body?.stop).toBeUndefined();
    expect(body?.bodies).toHaveLength(1);
    expect(design.doc.bodies[body?.bodies[0] as never]?.name).toBe('Bracket');
    expect(report.restarts).toBe(0);
  });
});

/** The one body's history of a run. */
const only = (r: Awaited<ReturnType<typeof run>>) => {
  const body = r.report.bodies[0];
  if (!body) throw new Error('no body');
  return body;
};

describe('each mapped input of a pad and a pocket', () => {
  const cases: [string, Partial<FeatureSpec>, string, Parameters<typeof historyFile>[1]?][] = [
    ['a length', {}, boxBrep([0, 0, 0], [10, 20, 30])],
    ['Reversed', { reversed: true }, boxBrep([0, 0, -30], [10, 20, 0])],
    ['Midplane', { midplane: true }, boxBrep([0, 0, -15], [10, 20, 15])],
    [
      'the symmetric side type (1.1)',
      { props: [choice('SideType', 2)] },
      boxBrep([0, 0, -15], [10, 20, 15]),
    ],
    ['two lengths (TwoLengths)', { kind: 4, length2: 5 }, boxBrep([0, 0, -5], [10, 20, 30])],
    [
      'two lengths, reversed',
      { kind: 4, length2: 5, reversed: true },
      boxBrep([0, 0, -30], [10, 20, 5]),
    ],
    [
      'two sides (1.1)',
      { length2: 5, props: [choice('SideType', 1), choice('Type2', 0)] },
      boxBrep([0, 0, -5], [10, 20, 30]),
    ],
  ];
  for (const [what, extra, stored] of cases)
    it(`maps ${what}`, async () => {
      const r = await run([padBody(extra, stored)]);
      const body = only(r);
      expect(body.stop).toBeUndefined();
      expect(body.outcome).toBe('history');
      expect(r.features).toEqual(['sketch Sketch', 'extrude Pad']);
      expect(body.mapped[0]?.sources.distance).toBe('Length');
    });

  it('pads a sketch on an offset plane and a mirrored one', async () => {
    const offset = await run([
      padBody({}, boxBrep([0, 0, 5], [10, 20, 35]), { placement: [0, 0, 5] }),
    ]);
    expect(only(offset).outcome).toBe('history');
    expect(only(offset).sketches[0]?.plane).toBe('offset');
    // Turned over about x: the sketch's normal is −z and its y is −y.
    const mirrored = await run([
      padBody({}, boxBrep([0, -20, -30], [10, 0, 0]), { placement: [0, 0, 0, Math.PI, [1, 0, 0]] }),
    ]);
    expect(only(mirrored).outcome).toBe('history');
    expect(only(mirrored).sketches[0]?.mirrored).toBe(true);
  });

  it('pockets through all', async () => {
    const r = await run([
      {
        name: 'Body',
        sketches: [
          { name: 'Sketch', geometry: rectangle(0, 0, 10, 20) },
          { name: 'Sketch001', geometry: rectangle(5, -1, 11, 21), placement: [0, 0, 30] },
        ],
        features: [
          { name: 'Pad', type: 'Pad', length: 30, stored: BOX },
          {
            name: 'Pocket',
            type: 'Pocket',
            sketch: 'Sketch001',
            kind: 1,
            stored: boxBrep([0, 0, 0], [5, 20, 30]),
          },
        ],
      },
    ]);
    expect(only(r).outcome).toBe('history');
    expect(only(r).mapped[1]?.sources.distance).toBeUndefined();
  });

  it('pads a body in a moved container, in world coordinates', async () => {
    const r = await run([
      {
        ...padBody(),
        placement: [100, 0, 0],
        final: boxBrep([100, 0, 0], [110, 20, 30]),
      },
    ]);
    expect(only(r).outcome).toBe('history');
    expect(only(r).sketches[0]?.movedContainer).toBe(true);
  });

  it("keeps the file's colour, name and hidden state on the rebuilt body", async () => {
    const r = await run([padBody()], { hidden: ['Body'] });
    const id = only(r).bodies[0] as never;
    expect(r.design.doc.bodies[id]).toMatchObject({
      name: 'Bracket',
      color: '#3366cc',
      visible: false,
    });
  });
});

describe('a vent plate of 60 slots', () => {
  it('comes in with its history: 244 drawn curves are within the profile cap', async () => {
    // A 130 × 50 plate with 6 rows of 10 slots, each 8 mm long and 2 mm wide (two lines, two arcs).
    const [a, r, h] = [3, 1, 5];
    const slots: string[] = [];
    for (let i = 0; i < 10; i++)
      for (let j = 0; j < 6; j++) {
        const [x, y] = [10 + 12 * i, 5 + 8 * j];
        slots.push(
          line(x - a, y + r, x + a, y + r),
          arc(x + a, y, r, -Math.PI / 2, Math.PI / 2),
          line(x + a, y - r, x - a, y - r),
          arc(x - a, y, r, Math.PI / 2, (3 * Math.PI) / 2),
        );
      }
    const slot = 2 * r * 2 * a + Math.PI * r * r;
    const rim = 4 * a + 2 * Math.PI * r;
    const face = 130 * 50 - 60 * slot;
    const stored = measureText({
      solids: 1,
      volume: face * h,
      area: 2 * face + (2 * (130 + 50) + 60 * rim) * h,
      box: { min: [0, 0, 0], max: [130, 50, h] },
      // The slots' centres average x = 64, y = 25; the plate's are 65, 25.
      centre: [(130 * 50 * 65 - 60 * slot * 64) / face, 25, h / 2],
    });
    const r0 = await run([
      {
        name: 'Body',
        label: 'Vent',
        sketches: [{ name: 'Sketch', geometry: [...rectangle(0, 0, 130, 50), ...slots] }],
        features: [{ name: 'Pad', type: 'Pad', length: h, stored }],
      },
    ]);
    expect(only(r0).stop).toBeUndefined();
    expect(only(r0).outcome).toBe('history');
    expect(r0.features).toEqual(['sketch Sketch', 'extrude Pad']);
  });
});

describe('a revolution and a groove', () => {
  // A 10 × 100 rectangle in the vertical plane x = -59.16, its left side on the
  // sketch's V axis (world z through (-59.16, 59.16)): a full turn is LOCATED_FACE's cylinder.
  const profile = {
    name: 'Sketch',
    geometry: rectangle(0, 0, 10, 100),
    placement: facingX(-59.16, 59.16, 0),
  };
  const turn = (extra: Partial<FeatureSpec> = {}, stored = cylinderBrep(100)): BodySpec => ({
    name: 'Body',
    sketches: [profile],
    features: [{ name: 'Revolution', type: 'Revolution', stored, ...extra }],
  });

  it('turns about a sketch axis drawn as a fixed construction line', async () => {
    const r = await run([turn()]);
    expect(only(r).outcome).toBe('history');
    const sketch = r.design.doc.features.find((f) => f.type === 'sketch');
    const entities = Object.values(readSketch(sketch as Feature)?.data.entities ?? {});
    const construction = entities.filter(
      (e) => e.type === 'line' && 'construction' in e && e.construction,
    );
    expect(construction).toHaveLength(1);
    expect(only(r).mapped[0]?.sources).toMatchObject({ axis: 'ReferenceAxis', angle: 'Angle' });
  });

  it('turns about a line of the sketch (EdgeN) and the N-th construction line (AxisN)', async () => {
    // Edge4 is the rectangle's left side, on the axis.
    const edge = await run([turn({ axis: { object: 'Sketch', subs: ['Edge4'] } })]);
    expect(only(edge).outcome).toBe('history');
    const withAxis = {
      ...profile,
      geometry: [...rectangle(0, 0, 10, 100), line(0, -5, 0, 105, { construction: true })],
    };
    const nth = await run([
      { ...turn({ axis: { object: 'Sketch', subs: ['Axis0'] } }), sketches: [withAxis] },
    ]);
    expect(only(nth).outcome).toBe('history');
  });

  it('turns about an origin axis of a body that is not moved, and refuses one that is', async () => {
    const onOrigin = (placement?: BodySpec['placement']): BodySpec => ({
      name: 'Body',
      origin: true,
      ...(placement ? { placement } : {}),
      sketches: [{ name: 'Sketch', geometry: rectangle(0, 0, 10, 100), placement: onXZ() }],
      features: [
        {
          name: 'Revolution',
          type: 'Revolution',
          axis: { object: 'BodyZ_Axis' },
          stored: cylinderBrep(100, [59.16, -59.16, 0]),
        },
      ],
    });
    expect(only(await run([onOrigin()])).outcome).toBe('history');
    const moved = only(
      await run([{ ...onOrigin([5, 0, 0]), final: cylinderBrep(100, [64.16, -59.16, 0]) }]),
    );
    expect(moved.stop).toMatchObject({ reason: 'axis' });
    expect(moved.outcome).toBe('shape');
  });

  it('grooves a padded cylinder', async () => {
    const r = await run([
      {
        name: 'Body',
        sketches: [
          { name: 'Sketch', geometry: [circle(-59.16, 59.16, 10)] },
          {
            name: 'Sketch001',
            geometry: rectangle(0, 50, 20, 150),
            placement: facingX(-59.16, 59.16, 0),
          },
        ],
        features: [
          { name: 'Pad', type: 'Pad', length: 100, stored: cylinderBrep(100) },
          { name: 'Groove', type: 'Groove', sketch: 'Sketch001', stored: cylinderBrep(50) },
        ],
      },
    ]);
    expect(only(r).outcome).toBe('history');
    expect(only(r).mapped.map((m) => m.kind)).toEqual(['pad', 'groove']);
  });

  // FreeCAD's sense (ADR-0144's notes): `Angle` right-handed about the axis, Reversed the other way,
  // Midplane centred on the profile. The profile's radial direction is +y; turned about +z, +y goes to −x.
  const r10 = 10;
  const cx = -59.16;
  const cy = 59.16;
  const quarter = (box: { min: number[]; max: number[] }, centre: number[]) =>
    measureText({
      solids: 1,
      volume: (Math.PI * r10 * r10 * 100) / 4,
      area: 2 * r10 * 100 + (Math.PI * r10 * r10) / 2 + (2 * Math.PI * r10 * 100) / 4,
      box,
      centre,
    });
  // A quarter disc's centre is 4r/3π from both its straight sides; a sector of ±45°'s is 2r·sin(π/4)/(3π/4) out.
  const q = (4 * r10) / (3 * Math.PI);
  const s = (2 * r10 * Math.SQRT1_2) / ((3 * Math.PI) / 4);
  const angles: [string, Partial<FeatureSpec>, { min: number[]; max: number[] }, number[]][] = [
    [
      'an angle',
      { angle: 90 },
      { min: [cx - r10, cy, 0], max: [cx, cy + r10, 100] },
      [cx - q, cy + q, 50],
    ],
    [
      'an angle, reversed',
      { angle: 90, reversed: true },
      { min: [cx, cy, 0], max: [cx + r10, cy + r10, 100] },
      [cx + q, cy + q, 50],
    ],
    [
      'an angle, symmetric',
      { angle: 90, midplane: true },
      { min: [cx - r10 * Math.SQRT1_2, cy, 0], max: [cx + r10 * Math.SQRT1_2, cy + r10, 100] },
      [cx, cy + s, 50],
    ],
  ];
  for (const [what, extra, box, centre] of angles)
    it(`turns by ${what}`, async () => {
      const r = await run([turn(extra, quarter(box, centre))]);
      expect(only(r).stop).toBeUndefined();
      expect(only(r).outcome).toBe('history');
    });
});

describe('where a history stops', () => {
  const padThen = (second: FeatureSpec, extra: Partial<BodySpec> = {}): BodySpec => ({
    name: 'Body',
    label: 'Bracket',
    sketches: [
      { name: 'Sketch', geometry: rectangle(0, 0, 10, 20) },
      { name: 'Sketch001', geometry: rectangle(-1, -1, 11, 21), placement: [0, 0, 30] },
    ],
    features: [
      { name: 'Pad', type: 'Pad', length: 30, stored: BOX },
      { stored: boxBrep([0, 0, 0], [10, 20, 20]), ...second },
    ],
    ...extra,
  });

  it('keeps what came before, then a Remove and the final shape (a feature it cannot map)', async () => {
    const r = await run([padThen({ name: 'Hole', type: 'PartDesign::Hole' })]);
    const body = only(r);
    expect(body.stop).toMatchObject({ object: 'Hole', reason: 'type' });
    expect(body.outcome).toBe('shape');
    expect(r.features).toEqual([
      'sketch Sketch',
      'extrude Pad',
      'remove Remove Bracket',
      'import Import Bracket',
    ]);
    expect(r.files.size).toBe(1);
    expect(r.report.shapes.map((s) => s.name)).toEqual(['Bracket']);
    const remove = r.design.doc.features.find((f) => f.type === 'remove');
    expect(JSON.stringify(remove?.inputs)).toContain(body.bodies[0]);
  });

  it('falls back when the rebuilt body differs from the stored shape, taking the feature back', async () => {
    const r = await run([
      padThen({
        name: 'Pocket',
        type: 'Pocket',
        sketch: 'Sketch001',
        length: 10,
        stored: boxBrep([0, 0, 0], [10, 20, 21]),
      }),
    ]);
    const body = only(r);
    expect(body.stop).toMatchObject({ object: 'Pocket', reason: 'differs' });
    expect(body.stop?.detail).toMatch(/volume/);
    // Neither the pocket nor its sketch nor its plane stay.
    expect(r.features).toEqual([
      'sketch Sketch',
      'extrude Pad',
      'remove Remove Bracket',
      'import Import Bracket',
    ]);
  });

  it('brings a body whose first feature it cannot map in exactly as the shapes-only import does', async () => {
    const r = await run([padBody({ props: [num('TaperAngle', 5, 'App::PropertyAngle')] })]);
    expect(only(r).stop).toMatchObject({ object: 'Pad', reason: 'taper' });
    expect(only(r).mapped).toEqual([]);
    expect(r.features).toEqual(['import Import Bracket']);
    expect(only(r).outcome).toBe('shape');
  });

  const refusals: [string, Partial<FeatureSpec>, string, Partial<BodySpec>?][] = [
    ['a suppressed feature', { props: [bool('Suppressed', true)] }, 'suppressed'],
    ['a profile that is a face', { profileSubs: ['Face6'], sketch: 'Pad0' }, 'profile'],
    ['a profile that is a part of a sketch', { profileSubs: ['Edge1'] }, 'profile'],
    ['a profile link to an object that is not there', { sketch: 'Nothing' }, 'profile'],
    [
      'a sketch with no closed profile',
      {},
      'sketch',
      { sketches: [{ name: 'Sketch', geometry: [line(0, 0, 10, 0)] }] },
    ],
    [
      'a sketch with no Extrudo plane',
      {},
      'sketch',
      {
        sketches: [
          {
            name: 'Sketch',
            geometry: rectangle(0, 0, 10, 20),
            placement: [0, 0, 0, 0.3, [1, 1, 0]],
          },
        ],
      },
    ],
    ['a taper angle', { props: [num('TaperAngle', 5, 'App::PropertyAngle')] }, 'taper'],
    ['a custom direction', { props: [bool('UseCustomVector', true)] }, 'direction'],
    [
      'a direction from a reference',
      { props: [linkSub('ReferenceAxis', 'Sketch', ['H_Axis'])] },
      'direction',
    ],
    ['up to a face', { kind: 3 }, 'up-to'],
    ['up to the last face', { kind: 1 }, 'up-to'],
    ['up to a shape', { kind: 5 }, 'up-to'],
    ['a Type it does not know', { kind: 9 }, 'value'],
    [
      'a length that is not a number',
      { omit: ['Length'], props: [prop('Length', 'App::PropertyLength', '<String value="ten"/>')] },
      'value',
    ],
    [
      'a Reversed that is not true or false',
      {
        omit: ['Reversed'],
        props: [prop('Reversed', 'App::PropertyBool', '<Integer value="1"/>')],
      },
      'value',
    ],
    ['a NaN length', { length: 'nan' }, 'value'],
    ['a 1e999 length', { length: '1e999' }, 'value'],
    ['a negative length', { length: -5 }, 'value'],
    ['a length of 0', { length: 0 }, 'value'],
    ['a missing length', { omit: ['Length'] }, 'value'],
  ];
  for (const [what, extra, reason, body] of refusals)
    it(`refuses ${what} (${reason})`, async () => {
      const r = await run([{ ...padBody(extra), ...body }]);
      expect(only(r).stop).toMatchObject({ object: 'Pad', reason });
      expect(only(r).outcome).toBe('shape');
      expect(r.features).toEqual(['import Import Bracket']);
    });

  const turnRefusals: [string, Partial<FeatureSpec>, string][] = [
    ["the sketch's normal as the axis", { axis: { object: 'Sketch', subs: ['N_Axis'] } }, 'axis'],
    ['a datum line as the axis', { axis: { object: 'Line' } }, 'axis'],
    ['no axis', { omit: ['ReferenceAxis'] }, 'axis'],
    ['an arc as the axis', { axis: { object: 'Sketch', subs: ['Edge9'] } }, 'axis'],
    ['two angles', { kind: 4 }, 'option'],
    ['up to a face', { kind: 3 }, 'up-to'],
    ['an angle of 400°', { angle: 400 }, 'value'],
    ['a NaN angle', { angle: 'nan' }, 'value'],
  ];
  for (const [what, extra, reason] of turnRefusals)
    it(`refuses a revolution with ${what} (${reason})`, async () => {
      const r = await run(
        [
          {
            name: 'Body',
            label: 'Bracket',
            sketches: [
              {
                name: 'Sketch',
                geometry: rectangle(0, 0, 10, 100),
                placement: facingX(-59.16, 59.16, 0),
              },
            ],
            features: [
              { name: 'Revolution', type: 'Revolution', stored: cylinderBrep(100), ...extra },
            ],
          },
        ],
        { extra: [{ name: 'Line', type: 'PartDesign::Line', props: [] }] },
      );
      expect(only(r).stop).toMatchObject({ reason });
      expect(r.features).toEqual(['import Import Bracket']);
    });

  it('refuses a pocket with nothing to cut', async () => {
    const r = await run([padBody({ type: 'Pocket' })]);
    expect(only(r).stop).toMatchObject({ reason: 'no-base' });
  });

  it('stops at a stored shape it cannot read', async () => {
    const r = await run([
      padThen(
        { name: 'Pocket', type: 'Pocket', sketch: 'Sketch001', length: 10, stored: 'not a shape' },
        { final: BOX },
      ),
    ]);
    expect(only(r).stop).toMatchObject({ object: 'Pocket', reason: 'stored' });
    expect(only(r).outcome).toBe('shape');
  });
});

describe('hostile chains', () => {
  it('ends a BaseFeature cycle without mapping anything', async () => {
    const body = padBody();
    const r = await run([
      {
        ...body,
        features: [
          { name: 'Pad', type: 'Pad', length: 30, stored: BOX, base: 'Pad001' },
          { name: 'Pad001', type: 'Pad', length: 30, stored: BOX },
        ],
      },
    ]);
    expect(only(r).stop).toMatchObject({ reason: 'chain' });
    expect(r.features).toEqual(['import Import Bracket']);
  });

  it("ends the chain at the solid the body starts from (the body's own BaseFeature)", async () => {
    const r = await run([{ ...padBody({ base: 'Solid' }), group: ['Sketch', 'Pad'] }], {
      extra: [{ name: 'Solid', type: 'Part::Box', props: [] }],
    });
    // The body names no BaseFeature here, so a pad based on an outside solid breaks the chain.
    expect(only(r).stop).toMatchObject({
      reason: 'chain',
      detail: 'its feature Solid is not in the body',
    });
    const based = await run(
      [
        {
          ...padBody({ base: 'Solid' }),
          group: ['Sketch', 'Pad'],
          props: [link('BaseFeature', 'Solid')],
        },
      ],
      { extra: [{ name: 'Solid', type: 'Part::Box', props: [] }] },
    );
    expect(only(based).stop).toMatchObject({
      object: 'Pad',
      reason: 'chain',
      detail: 'it builds on Solid, a solid outside the body',
    });
  });

  it('walks a feature the body lists twice once', async () => {
    const r = await run([{ ...padBody(), group: ['Sketch', 'Pad', 'Pad'] }]);
    expect(only(r).outcome).toBe('history');
    expect(only(r).mapped).toHaveLength(1);
  });

  it('stops at a feature outside its body, and at a body with no tip', async () => {
    expect(only(await run([{ ...padBody(), group: ['Sketch'] }])).stop).toMatchObject({
      reason: 'chain',
    });
    expect(only(await run([{ ...padBody(), tip: null, final: BOX }])).stop).toMatchObject({
      reason: 'chain',
    });
  });

  it('caps the features walked per body and per file', async () => {
    const two = (name: string): BodySpec => ({
      name,
      label: name,
      sketches: [
        { name: `${name}Sketch`, geometry: rectangle(0, 0, 10, 20) },
        { name: `${name}Sketch001`, geometry: rectangle(-1, -1, 11, 21), placement: [0, 0, 30] },
      ],
      features: [
        { name: `${name}Pad`, type: 'Pad', sketch: `${name}Sketch`, length: 30, stored: BOX },
        {
          name: `${name}Pocket`,
          type: 'Pocket',
          sketch: `${name}Sketch001`,
          length: 10,
          stored: boxBrep([0, 0, 0], [10, 20, 20]),
        },
      ],
    });
    const perBody = await run([two('A')], { maxBodyFeatures: 1 });
    expect(only(perBody).stop).toMatchObject({ object: 'APocket', reason: 'limit' });
    expect(only(perBody).mapped).toHaveLength(1);
    const perFile = await run([two('A'), two('B')], { maxFileFeatures: 3 });
    expect(perFile.report.bodies.map((b) => [b.mapped.length, b.stop?.reason])).toEqual([
      [2, undefined],
      [1, 'limit'],
    ]);
  });
});

describe('kernels that fail, hang and lie', () => {
  /** A kernel whose `which` call does `what` the `nth` time it is made. */
  function faulty(
    which: 'rebuild' | 'measureStoredShape',
    what: 'throw' | 'hang' | 'lie',
    nth = 1,
  ): ImportKernel & { calls: number } {
    const k = measuring();
    let count = 0;
    const wrapped = {
      ...k,
      calls: 0,
      [which]: async (...args: never[]) => {
        count++;
        if (count === nth) {
          if (what === 'throw') throw new Error('trapped');
          if (what === 'hang') return new Promise(() => {});
          if (which === 'rebuild') return { ids: ['x'], bodies: { y: { solids: 1 } }, failed: [] };
          return {
            solids: 1,
            volume: Number.NaN,
            area: 1,
            box: { min: [0, 0, 0], max: [1, 1, 1] },
          };
        }
        return (k[which] as (...a: never[]) => Promise<unknown>)(...args);
      },
    };
    return wrapped as never;
  }
  const cases: ['rebuild' | 'measureStoredShape', 'throw' | 'hang' | 'lie', string][] = [
    ['rebuild', 'throw', 'kernel'],
    ['rebuild', 'hang', 'time'],
    ['rebuild', 'lie', 'kernel'],
    ['measureStoredShape', 'throw', 'kernel'],
    ['measureStoredShape', 'hang', 'time'],
    ['measureStoredShape', 'lie', 'kernel'],
  ];
  for (const [which, what, reason] of cases)
    it(`stops the history when ${which} ${what === 'lie' ? 'lies' : `${what}s`}, restarts and falls back`, async () => {
      // Only a hang needs a short budget; the shapes import after the fallback has the same one,
      // so it must leave room for a loaded machine's conversion of a box.
      const r = await run([padBody()], {
        kernel: faulty(which, what),
        ...(what === 'hang' ? { shapeTimeoutMs: 5_000 } : {}),
      });
      expect(only(r).stop).toMatchObject({ reason });
      expect(r.report.restarts).toBe(1);
      expect(only(r).outcome).toBe('shape');
      expect(r.features).toEqual(['import Import Bracket']);
    }, 30_000);

  it('leaves the rest to the shapes import after too many restarts, which leaves it out', async () => {
    const r = await run([padBody()], {
      kernel: faulty('measureStoredShape', 'throw'),
      maxRestarts: 0,
    });
    expect(only(r).stop).toMatchObject({ reason: 'kernel' });
    expect(r.report.leftOut.map((l) => l.reason)).toEqual(['restarts']);
    expect(only(r).outcome).toBe('left-out');
    expect(r.features).toEqual([]);
  });
});
