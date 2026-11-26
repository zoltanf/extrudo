// `view` body access for Move (ADR-0024's amendment on `view` access): the seeded proof and the
// counters of `view-access-features-test-support.ts` on boxes moved in place (a copy runs as
// `write`). One move turns about the Z axis, one goes from the origin to a corner of another box
// (that box comes into its view by the vertex), and a box outside every move's view overlaps the
// first box. A second design moves boxes about a construction axis on another box's edge, sketch
// lines (one on XY, one on another box's face) and to a construction point on another box's corner:
// passed over by the view, their features' keys upstream. Real OCCT and manifold, strict leaks, no
// clock.
import {
  type FeatureId,
  type GeomRef,
  moveInputs,
  ORIGIN_POINT_ID,
  originPlaneRef,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { describe, expect, it } from 'vitest';
import { fallbacks, GENERIC_KINDS, length, setInputs } from './add-access-test-support';
import {
  BASE,
  box,
  computed,
  countEdits,
  type Design,
  edgeRefs,
  faceRefs,
  feature,
  type Kind,
  proveDesigns,
  sequence,
  top,
  useKernel,
  vertexRef,
} from './view-access-features-test-support';
import { document } from './view-access-test-support';

useKernel();

const AXIS: GeomRef = { kind: 'axis', id: 'origin:z' };
const ORIGIN: GeomRef = { kind: 'point', id: ORIGIN_POINT_ID };

/** Boxes, each moved: freely, about Z, and from the origin to the last box's corner. */
async function moves() {
  const base = document('boxes moved', [
    box('b0', 0),
    box('z0', 0, 4),
    box('b1', 30),
    box('b2', 60),
    box('b3', 90),
  ]);
  const corner = await computed(base, (engine) => vertexRef(engine, 'b3:0', 0));
  const features = [
    base.features[0],
    base.features[1],
    feature('mv0', 'move', moveInputs(['b0:0'], { dx: '5 mm', dy: '2 mm' })),
    base.features[2],
    feature('mv1', 'move', moveInputs(['b1:0'], { mode: 'rotate', axis: AXIS, angle: '20 deg' })),
    base.features[3],
    base.features[4],
    feature(
      'mv2',
      'move',
      moveInputs(['b2:0'], { mode: 'point-to-point', from: ORIGIN, to: corner }),
    ),
  ].filter((f) => f !== undefined);
  return { ...base, features, timelineMarker: features.length };
}

/** A sketch `id` on `plane` with one line from (`x`, 0) to (`x`, 10): the line's reference. */
function lineSketch(id: string, plane: GeomRef, x: number) {
  const b = new SketchBuilder();
  const line = b.line(x, 0, x, 10);
  const sketch = feature(id, 'sketch', sketchInputs(plane, b.sketch));
  return { sketch, line: { kind: 'sketchEntity', id: `${id}/${line.id}` } as GeomRef };
}

/**
 * Moves about geometry other features make, each on a box of its own: a construction axis along
 * an edge of another box, a sketch line on XY, a sketch line on another box's top face, and a
 * construction point on another box's corner (point to point from the origin). A box before all
 * of them that nothing refers to.
 */
async function aboutGeometry(lineAt = 100) {
  const parts = document('boxes moved about construction and sketch geometry', [
    box('q0', -60),
    box('ea', 0),
    box('fb', 160),
    box('pb', 230),
  ]);
  const { up, corner, faceRef } = await computed(parts, (engine) => ({
    up: edgeRefs(engine, 'ea:0', (d) =>
      d.edges.flatMap((e, i) =>
        e.type === 'line' && Math.abs(e.direction?.[2] ?? 0) > 0.99 ? [i] : [],
      ),
    )[0] as GeomRef,
    corner: vertexRef(engine, 'pb:0', 0),
    faceRef: faceRefs(engine, 'fb:0', top)[0] as GeomRef,
  }));
  const onXY = lineSketch('sl', originPlaneRef('origin:xy'), lineAt);
  const onFace = lineSketch('sf', faceRef, 160);
  const rotate = (id: string, body: string, axis: GeomRef) =>
    feature(id, 'move', moveInputs([body], { mode: 'rotate', axis, angle: '20 deg' }));
  const features = [
    box('q0', -60),
    box('ea', 0),
    feature('ax', 'axisAlongEdge', { edge: { kind: 'ref', refs: [up] } }),
    box('ma', 30),
    rotate('mva', 'ma:0', { kind: 'axis', id: 'ax' }),
    onXY.sketch,
    box('ms', 120),
    rotate('mvs', 'ms:0', onXY.line),
    box('fb', 160),
    onFace.sketch,
    box('mf', 190),
    rotate('mvf', 'mf:0', onFace.line),
    box('pb', 230),
    feature('cpt', 'constructionPoint', { at: { kind: 'ref', refs: [corner] } }),
    box('mp', 260),
    feature(
      'mvp',
      'move',
      moveInputs(['mp:0'], {
        mode: 'point-to-point',
        from: ORIGIN,
        to: { kind: 'point', id: 'cpt' },
      }),
    ),
  ];
  return { ...parts, features, timelineMarker: features.length };
}

const DESIGNS: Design[] = [
  {
    name: 'boxes moved freely, about an axis and to another box’s corner',
    make: moves,
    refsKey: 'bodies',
    named: async (doc) => ({
      axis: AXIS,
      from: ORIGIN,
      // A corner of the box through the first one, before the first move, outside its view.
      to: await computed(doc, (engine) => vertexRef(engine, 'z0:0', 0)),
    }),
    kinds: [
      ...BASE,
      'copy',
      'copy',
      'mode',
      'mode',
      'mode',
      'twice',
      'untwice',
      ...GENERIC_KINDS,
    ] as Kind[],
    flips: ['copy: view→view', 'mode: view→view', 'twice: view→view', 'untwice: view→view'],
    steady: ['mode'],
    steps: 20,
  },
  {
    name: 'boxes moved about a construction axis, sketch lines and a construction point',
    make: () => aboutGeometry(),
    target: 'mva',
    refsKey: 'bodies',
    kinds: [...BASE, 'copy', 'copy', ...GENERIC_KINDS] as Kind[],
    flips: ['copy: view→view'],
    steps: 20,
  },
];

describe('view access: Move (ADR-0024)', () => {
  proveDesigns(DESIGNS);

  it('a move about construction or sketch geometry keeps its view and reruns with its source', {
    timeout: 120_000,
  }, async () => {
    const doc = await aboutGeometry();
    const moved = await aboutGeometry(104);
    const steps = await sequence([
      doc,
      setInputs(doc, 'q0', { length: length('12 mm') }),
      doc,
      setInputs(doc, 'ea', { length: length('12 mm') }),
      doc,
      // The XY sketch's line 4 mm over: its sketch changes.
      moved,
      doc,
      setInputs(doc, 'fb', { height: length('12 mm') }),
      doc,
      setInputs(doc, 'pb', { length: length('12 mm') }),
    ]);
    for (const step of steps) {
      expect(step.problems).toEqual([]);
      expect(fallbacks(step.result, doc)).toEqual([]);
      expect(step.result.stats.viewed).toEqual(['mva', 'mvs', 'mvf', 'mvp']);
    }
    expect(steps[0]?.result.features['mva' as FeatureId]?.status).toBe('ok');
    // A box nothing refers to. The axis, the face's sketch and the point read bodies (`read`: their
    // keys hold every body before them), so they run again, and each move about them with them;
    // the move about the XY sketch's line (that sketch reads none) doesn't.
    expect(steps[1]?.evaluated).toEqual(['q0', 'ax', 'mva', 'sf', 'mvf', 'cpt', 'mvp']);
    // The edge's box: the axis along it and the move about it, and the later `read` features
    // and their moves as above.
    expect(steps[3]?.evaluated).toEqual(['ea', 'ax', 'mva', 'sf', 'mvf', 'cpt', 'mvp']);
    // The XY sketch: the move about its line; that move's new body is in the keys of the later
    // `read` features, which run again with their moves.
    expect(steps[5]?.evaluated).toEqual(['sl', 'mvs', 'sf', 'mvf', 'cpt', 'mvp']);
    // The box whose face the second sketch is on: that sketch and the move about its line (and
    // the point after them).
    expect(steps[7]?.evaluated).toEqual(['fb', 'sf', 'mvf', 'cpt', 'mvp']);
    expect(steps[9]?.evaluated).toEqual(['pb', 'cpt', 'mvp']);
  });

  countEdits([['move', moves, 'b0', { length: length('12 mm') }, 'mv0', { dx: length('6 mm') }]]);
});
