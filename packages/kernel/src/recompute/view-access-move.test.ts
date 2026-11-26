// `view` body access for Move (ADR-0024's amendment on `view` access): the seeded proof and the
// counters of `view-access-features-test-support.ts` on boxes moved in place (a copy runs as
// `write`). One move turns about the Z axis, one goes from the origin to a corner of another box
// (that box comes into its view by the vertex), and a box outside every move's view overlaps the
// first box. Real OCCT and manifold, strict leaks, no clock.
import { type GeomRef, moveInputs, ORIGIN_POINT_ID } from '@extrudo/core';
import { describe } from 'vitest';
import { GENERIC_KINDS, length } from './add-access-test-support';
import {
  BASE,
  box,
  computed,
  countEdits,
  type Design,
  feature,
  type Kind,
  proveDesigns,
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
    kinds: [...BASE, 'copy', 'copy', 'mode', 'mode', 'mode', 'twice', ...GENERIC_KINDS] as Kind[],
    flips: ['copy: view→write', 'copy: write→view', 'mode: view→view', 'twice: view→view'],
    steady: ['mode'],
    steps: 20,
  },
];

describe('view access: Move (ADR-0024)', () => {
  proveDesigns(DESIGNS);
  countEdits([['move', moves, 'b0', { length: length('12 mm') }, 'mv0', { dx: length('6 mm') }]]);
});
