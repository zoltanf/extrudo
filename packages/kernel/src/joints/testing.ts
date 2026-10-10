/**
 * The print-in-place hinge of P6-05's joint tests (ADR-0081 §4), built with
 * core's own shapes like the benchmark fixtures: component **Base** (a 40 × 20
 * × 4 plate with two knuckles and a Ø6 pin along X at the plates' mid-height)
 * and component **Leaf** (a 40 × 20 × 4 plate `gap` beside the knuckles, with a
 * middle knuckle round the pin through a Ø(6 + 2 × `clearance`) hole), and the
 * joint **Hinge**: revolute, a = the leaf's hole wall, b = the pin's wall, 0 to
 * 90 deg. `gap` and `clearance` are parameters.
 */
import {
  type BodyId,
  type ComponentId,
  type ExtrudoDocument,
  type Feature,
  type GeomRef,
  type Joint,
  type JointId,
  originPlaneRef,
  type PrimitiveInputOptions,
  primitiveInputs,
} from '@extrudo/core';
import { testDocument, testFeature } from '../recompute/testing';

export const BASE = 'base' as ComponentId;
export const LEAF = 'leaf' as ComponentId;

/** The leaf's hole wall and the pin's wall, as the kernel names them. */
export const HOLE_WALL: GeomRef = { kind: 'face', id: 'cylinder:Hole:side:wall' };
export const PIN_WALL: GeomRef = { kind: 'face', id: 'cylinder:Pin:side:wall' };

const yz = originPlaneRef('origin:yz');

function primitive(
  id: string,
  type: 'box' | 'cylinder',
  component: ComponentId,
  options: PrimitiveInputOptions,
): Feature {
  return { ...testFeature(id, type), inputs: primitiveInputs(type, options), component };
}

export const HINGE: Joint = {
  id: 'hinge' as JointId,
  name: 'Hinge',
  type: 'revolute',
  a: { component: LEAF, ref: HOLE_WALL },
  b: { component: BASE, ref: PIN_WALL },
  min: { kind: 'expr', expr: '0 deg', unit: 'angle' },
  max: { kind: 'expr', expr: '90 deg', unit: 'angle' },
};

export function hingeDocument(): ExtrudoDocument {
  const leafPlate = 'LeafPlate:0';
  const basePlate = 'BasePlate:0';
  const features: Feature[] = [
    primitive('LeafPlate', 'box', LEAF, {
      numbers: { length: '40 mm', width: '20 mm', height: '4 mm', y: '15.5 mm' },
    }),
    primitive('Bridge', 'box', LEAF, {
      numbers: { length: '14 mm - 2 * gap', width: '6 mm', height: '4 mm', y: '3 mm' },
      operation: 'join',
      bodies: [leafPlate],
    }),
    primitive('Knuckle', 'cylinder', LEAF, {
      plane: yz,
      numbers: { diameter: '10 mm', height: '14 mm - 2 * gap', y: '2 mm', offset: 'gap - 7 mm' },
      operation: 'join',
      bodies: [leafPlate],
    }),
    primitive('Hole', 'cylinder', LEAF, {
      plane: yz,
      numbers: {
        diameter: '6 mm + 2 * clearance',
        height: '40 mm',
        y: '2 mm',
        offset: '-20 mm',
      },
      operation: 'cut',
      bodies: [leafPlate],
    }),
    primitive('BasePlate', 'box', BASE, {
      numbers: { length: '40 mm', width: '20 mm', height: '4 mm', y: '-14 mm' },
    }),
    primitive('Knuckle1', 'cylinder', BASE, {
      plane: yz,
      numbers: { diameter: '10 mm', height: '13 mm', y: '2 mm', offset: '-20 mm' },
      operation: 'join',
      bodies: [basePlate],
    }),
    primitive('Knuckle2', 'cylinder', BASE, {
      plane: yz,
      numbers: { diameter: '10 mm', height: '13 mm', y: '2 mm', offset: '7 mm' },
      operation: 'join',
      bodies: [basePlate],
    }),
    primitive('Pin', 'cylinder', BASE, {
      plane: yz,
      numbers: { diameter: '6 mm', height: '40 mm', y: '2 mm', offset: '-20 mm' },
      operation: 'join',
      bodies: [basePlate],
    }),
  ];
  const doc = testDocument(features, { gap: '0.5 mm', clearance: '0.3 mm' });
  return {
    ...doc,
    name: 'Hinge',
    components: [
      { id: BASE, name: 'Base', visible: true },
      { id: LEAF, name: 'Leaf', visible: true },
    ],
    bodies: {
      [leafPlate as BodyId]: { name: 'Leaf', visible: true, component: LEAF },
      [basePlate as BodyId]: { name: 'Base', visible: true, component: BASE },
    },
    joints: [HINGE],
  };
}
