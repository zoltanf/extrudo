// `view` body access for Mirror of bodies without a copy (ADR-0024's amendment on `view` access;
// a copy, a join and a mirror of features run as `write`): the seeded proof and the counters of
// `view-access-features-test-support.ts` on boxes mirrored in an origin plane and in a face of
// another box (that box comes into its view by the face), and twin boxes whose face, named on
// both, is the plane. A box outside every mirror's view overlaps the first box. Real OCCT and
// manifold, strict leaks, no clock.
import { type GeomRef, mirrorInputs, originPlaneRef } from '@extrudo/core';
import { describe } from 'vitest';
import { GENERIC_KINDS, length } from './add-access-test-support';
import {
  BASE,
  box,
  computed,
  countEdits,
  type Design,
  faceRefs,
  faces,
  feature,
  type Kind,
  proveDesigns,
  useKernel,
} from './view-access-features-test-support';
import { document, twin } from './view-access-test-support';

useKernel();

/** The face of a box that faces +X. */
const east = faces((f) => f.type === 'plane' && (f.direction?.[0] ?? 0) > 0.99);

/** Boxes, each mirrored in place: in the YZ plane, and in the next box's +X face. */
async function mirrors() {
  const base = document('boxes mirrored', [
    box('b0', 0),
    box('z0', 0, 4),
    box('b1', 30),
    box('b2', 60),
  ]);
  const [face] = await computed(base, (engine) => faceRefs(engine, 'b2:0', east));
  const features = [
    ...base.features.slice(0, 2),
    feature('mi0', 'mirror', mirrorInputs(['b0:0'], originPlaneRef('origin:yz'), { copy: false })),
    ...base.features.slice(2),
    feature('mi1', 'mirror', mirrorInputs(['b1:0'], face as GeomRef, { copy: false })),
  ];
  return { ...base, features, timelineMarker: features.length };
}

/** Twin boxes (the same names) and a box mirrored in the +X face named on both. */
async function twins() {
  const base = document('twin boxes and a box mirrored in their face', [
    twin('ta', '0 mm'),
    twin('tb', '30 mm'),
    box('b0', 80),
  ]);
  const [face] = await computed(base, (engine) => faceRefs(engine, 'ta:0', east));
  const features = [
    ...base.features,
    feature('mt', 'mirror', mirrorInputs(['b0:0'], face as GeomRef, { copy: false })),
  ];
  return { ...base, features, timelineMarker: features.length };
}

const DESIGNS: Design[] = [
  {
    name: 'boxes mirrored in an origin plane and in another box’s face',
    make: mirrors,
    refsKey: 'bodies',
    named: async (doc) => {
      // The box through the first one, before its mirror, outside its view until it is the plane.
      const [face] = await computed(doc, (engine) => faceRefs(engine, 'z0:0', east));
      if (!face) throw new Error('no +X face on z0:0');
      return { 'mirror face': face };
    },
    kinds: [
      ...BASE,
      'copy',
      'copy',
      'mirror-plane',
      'mirror-plane',
      'twice',
      ...GENERIC_KINDS,
    ] as Kind[],
    flips: ['copy: view→write', 'copy: write→view', 'mirror-plane: view→view', 'twice: view→view'],
    steady: ['mirror-plane'],
    steps: 20,
  },
  {
    name: 'twin boxes and a box mirrored in a face named on both',
    make: twins,
    refsKey: 'bodies',
    target: 'mt',
    // With no bodies the plane, a face, is still named: the view stays.
    rule: ['lose: view→write', 'find: write→view', 'empty: view→view', 'fill: view→view'],
    kinds: [...BASE, 'swap', 'twin-off', 'twin-on', ...GENERIC_KINDS] as Kind[],
    flips: ['swap: view→view', 'twin-off: view→view', 'twin-on: view→view'],
    steps: 20,
  },
];

describe('view access: Mirror (ADR-0024)', () => {
  proveDesigns(DESIGNS);
  countEdits([['mirror', mirrors, 'b0', { length: length('12 mm') }, 'mi0', undefined]]);
});
