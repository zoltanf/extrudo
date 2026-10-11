/**
 * Components through the mapper, on hand-built decoded designs: a box in the
 * root and a lid in a component of its own; a component the file hides; and a
 * body that "Body to Component" moved out of the root; a mirror and a split
 * inside a component. The bodies are recomputed and grouped as the app groups
 * them (ADR-0081's rule).
 */
import { type BodyId, componentMembers } from '@extrudo/core';
import { Kernel } from '@extrudo/kernel';
import { kernelFeatures, loadOcct, RecomputeEngine } from '@extrudo/kernel/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { F3dComponent } from './decode/component';
import { f3dToDesign } from './map';
import { type F3dDesign, type F3dExtrude, type F3dSketchFeature, IDENTITY } from './model';

let kernel: Kernel;
beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});
afterAll(() => {
  kernel.dispose();
});

const ROOT = 1000;
const LID = 2000;

/** A square of side `cm` at x0 on the XY plane (sketch record `sketch`), and its extrude. */
function square(sketch: number, x0: number, cm: number): [F3dSketchFeature, F3dExtrude] {
  const corners: [number, number, number][] = [
    [x0, 0, 0],
    [x0 + cm, 0, 0],
    [x0 + cm, cm, 0],
    [x0, cm, 0],
  ];
  const tag = (i: number) => BigInt(sketch * 10 + i);
  const lines = corners.map((start, i) => {
    const end = corners[(i + 1) % 4] as [number, number, number];
    return {
      id: sketch * 10 + i,
      tag: tag(i),
      start,
      end,
      startPoint: sketch * 100 + i,
      endPoint: sketch * 100 + ((i + 1) % 4),
      construction: false,
    };
  });
  const points = corners.map((at, i) => ({ id: sketch * 100 + i, at, incidence: 0 }));
  const sketchFeature: F3dSketchFeature = {
    type: 'sketch',
    id: sketch,
    kind: 'Sketch',
    name: `Sketch${sketch}`,
    suppressed: false,
    parameters: [],
    sketch: {
      id: sketch + 1,
      frame: IDENTITY,
      points,
      lines,
      circulars: [],
      splines: [],
      texts: [],
    },
  };
  const extrude: F3dExtrude = {
    type: 'extrude',
    id: sketch + 2,
    kind: 'Extrude',
    name: `Extrude${sketch}`,
    suppressed: false,
    parameters: [
      {
        id: 0,
        number: sketch,
        name: `d${sketch}`,
        expression: '',
        kind: 'AlongDistance',
        comment: '',
        user: false,
        unit: 'mm',
        value: 1,
      },
    ],
    operation: 'new-body',
    direction: 'one-side',
    reversed: false,
    solid: true,
    start: 'profile-plane',
    profiles: [
      {
        id: sketch + 3,
        sketch: sketch + 1,
        regions: [
          {
            outer: [[tag(0), tag(1), tag(2), tag(3)]],
            inner: [],
            outerPieces: [
              [0, 1, 2, 3].map((i) => ({ tag: tag(i), secondary: 0n, piece: 1, of: 1 })),
            ],
            innerPieces: [],
          },
        ],
      },
    ],
    faces: [],
    participants: [],
  };
  return [sketchFeature, extrude];
}

const components = (lid: Partial<F3dComponent> = {}): F3dComponent[] => [
  { id: ROOT, name: 'Box v1', root: true, visible: true, occurrences: [] },
  {
    id: LID,
    name: 'Lid',
    root: false,
    visible: true,
    occurrences: [{ id: 1, ordinal: 1 }],
    parent: ROOT,
    ...lid,
  },
];

/** A box (Sketch10/Extrude10) in the root, a lid (Sketch20/Extrude20) in the Lid. */
function boxAndLid(lid: Partial<F3dComponent> = {}): F3dDesign {
  const [s1, e1] = square(10, 0, 2);
  const [s2, e2] = square(20, 5, 1);
  return {
    parameters: [],
    userParameters: [],
    features: [s1, e1, { ...s2, component: LID }, { ...e2, component: LID }],
    bodies: [
      { id: 500, index: 1, visible: true, creator: e1.id, component: ROOT },
      { id: 501, index: 1, visible: true, creator: e2.id, component: LID },
    ],
    components: components(lid),
    bodyMoves: [],
    problems: [],
  };
}

/** The design's components by name, each with the volumes of its bodies (mm³), and the loose ones. */
async function grouped(f3d: F3dDesign) {
  const { design, report } = f3dToDesign(f3d, 'Box');
  expect(design.validate()).toEqual([]);
  const doc = design.toJSON();
  const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
  try {
    const result = await engine.recompute({ doc });
    if (result.status !== 'done') throw new Error(`recompute ${result.status}`);
    const volume = (id: BodyId) => {
      const shape = engine.latestBody(id);
      return shape ? Math.round(kernel.measure(shape).volume) : 0;
    };
    const members = componentMembers(
      doc,
      result.bodies.map((b) => b.id),
      result.origins,
    );
    return {
      doc,
      report,
      components: Object.fromEntries(
        members.components.map((c) => [
          doc.components?.find((x) => x.id === c.id)?.name,
          c.bodies.map(volume),
        ]),
      ),
      loose: members.loose.map(volume),
    };
  } finally {
    engine.clear();
  }
}

describe('components', () => {
  it("makes one Extrudo component per component but the root, with that component's bodies", async () => {
    const { components, loose, report } = await grouped(boxAndLid());
    expect(components).toEqual({ Lid: [1000] });
    expect(loose).toEqual([4000]);
    expect(report.skipped).toEqual([]);
  });

  it('keeps a component the file hides hidden', async () => {
    const { doc, report } = await grouped(boxAndLid({ visible: false }));
    expect(doc.components).toEqual([expect.objectContaining({ name: 'Lid', visible: false })]);
    expect(report.notes).toContain('Component Lid is hidden, as in the file.');
  });

  it('says what an Extrudo component cannot hold: a placement, copies, nesting', async () => {
    const f3d = boxAndLid({
      occurrences: [
        { id: 1, ordinal: 1, transform: [1, 0, 0, 2, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
        { id: 2, ordinal: 2 },
      ],
    });
    const notes = f3dToDesign(f3d, 'Box').report.notes.filter((n) => n.startsWith('Component'));
    expect(notes).toEqual([
      'Component Lid: the file places it away from its own origin; it is imported where its own features make its bodies.',
      'Component Lid: the file places it 2 times; it is imported once.',
    ]);
  });

  it('says which components the file nests in another, once per parent', () => {
    const f3d = boxAndLid();
    f3d.components?.push(
      { id: 3000, name: 'Knob', root: false, visible: true, occurrences: [], parent: LID },
      { id: 4000, name: 'Hinge', root: false, visible: true, occurrences: [], parent: LID },
    );
    const notes = f3dToDesign(f3d, 'Box').report.notes;
    expect(notes).toContain(
      'Components Knob and Hinge are inside Lid in the file; here they stand alone.',
    );
    expect(
      f3dToDesign(f3d, 'Box')
        .design.toJSON()
        .components?.map((c) => c.name),
    ).toEqual(['Lid', 'Knob', 'Hinge']);
  });

  it('gives components with the same or no name names of their own', () => {
    const f3d = boxAndLid();
    f3d.components?.push(
      { id: 3000, name: 'lid', root: false, visible: true, occurrences: [] },
      { id: 4000, name: '', root: false, visible: true, occurrences: [] },
    );
    const { design } = f3dToDesign(f3d, 'Box');
    expect(design.toJSON().components?.map((c) => c.name)).toEqual([
      'Lid',
      'lid (2)',
      'Component1',
    ]);
  });

  it('gives a long name cut at a space a name of its own', () => {
    const f3d = boxAndLid();
    const long = 'X'.repeat(89);
    f3d.components?.push(
      { id: 3000, name: `${long} Y`, root: false, visible: true, occurrences: [] },
      { id: 4000, name: long, root: false, visible: true, occurrences: [] },
    );
    const names = f3dToDesign(f3d, 'Box')
      .design.toJSON()
      .components?.map((c) => c.name);
    expect(names).toEqual(['Lid', long, `${long} (2)`]);
  });

  it('moves a body Body to Component took into its target, shown as its moved copy is', async () => {
    const f3d = boxAndLid();
    // The box is made in the root, then moved into the Lid: the file hides the
    // original and shows the copy the move made.
    const box = f3d.bodies[0] as F3dDesign['bodies'][number];
    box.visible = false;
    f3d.features.push({
      type: 'other',
      id: 90,
      kind: 'Body to Component',
      name: 'Body to Component',
      suppressed: false,
      parameters: [],
    });
    f3d.bodies.push({ id: 502, index: 1, visible: true, creator: 91, component: LID });
    f3d.bodyMoves = [{ id: 90, sources: [500], made: [502], target: LID }];
    const { components, loose, report } = await grouped(f3d);
    expect(components).toEqual({ Lid: [4000, 1000] });
    expect(loose).toEqual([]);
    expect(report.imported).toContain('Body to Component');
    expect(report.notes.filter((n) => n.includes('hidden'))).toEqual([]);
  });

  it('keeps the bodies a mirror or a split makes inside the component it belongs to', async () => {
    // The Lid's 1 cm cube, copied in the YZ plane by a mirror of the Lid.
    const mirrored = boxAndLid();
    mirrored.features.push({
      type: 'mirror',
      id: 7,
      kind: 'Mirror',
      name: 'Mirror1',
      suppressed: false,
      parameters: [],
      component: LID,
      objects: 'bodies',
      features: [],
      bodies: [501],
      plane: { origin: [0, 0, 0], x: [0, 1, 0], y: [0, 0, 1] },
    });
    mirrored.bodies.push({ id: 503, index: 2, visible: true, creator: 7, component: LID });
    const copy = await grouped(mirrored);
    expect(copy.report.imported).toContain('Mirror1');
    expect(copy.components).toEqual({ Lid: [1000, 1000] });
    expect(copy.loose).toEqual([4000]);

    // The same cube cut in half by a plane 5.5 cm along X, split in the Lid.
    const split = boxAndLid();
    split.features.push({
      type: 'split',
      id: 7,
      kind: 'Split',
      name: 'Split1',
      suppressed: false,
      parameters: [],
      component: LID,
      bodies: [501],
      plane: { origin: [5.5, 0, 0], x: [0, 1, 0], y: [0, 0, 1] },
    });
    const halves = await grouped(split);
    expect(halves.report.imported).toContain('Split1');
    expect(halves.components).toEqual({ Lid: [500, 500] });
    expect(halves.loose).toEqual([4000]);
  });

  it('leaves a Body to Component out when the body it takes was not imported', () => {
    const f3d = boxAndLid();
    f3d.features.push({
      type: 'other',
      id: 90,
      kind: 'Body to Component',
      name: 'Body to Component',
      suppressed: false,
      parameters: [],
    });
    f3d.bodyMoves = [{ id: 90, sources: [777], made: [502], target: LID }];
    expect(f3dToDesign(f3d, 'Box').report.skipped).toEqual([
      {
        name: 'Body to Component',
        kind: 'Body to Component',
        reason: 'a body it moves was not imported',
      },
    ]);
  });
});
