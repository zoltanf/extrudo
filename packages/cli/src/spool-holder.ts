/**
 * The spool holder (P6-24 S6, ADR-0143): a bracket (a plate, a boss, the bore through both
 * and two screw holes) and an axle that fits the bore, with a flange on top. The drawings
 * example (`example-sheet.test.ts`, `fixtures/benchmarks/spool-holder.extrudo`) and the Drawing
 * tab's tooltip clips (`demo-designs.test.ts`, `fixtures/demos/sheet*.extrudo`) are built on it.
 * Z is up, the plate's underside at 0, the bore on the Z axis.
 */
import type { Design, FeatureHandle } from '@extrudo/api';

export interface SpoolHolder {
  plate: FeatureHandle;
  boss: FeatureHandle;
  bore: FeatureHandle;
  screws: readonly [FeatureHandle, FeatureHandle];
  shaft: FeatureHandle;
  flange: FeatureHandle;
}

/** Adds the two parts and their parameters (`axle`, `clearance`) to `d`. */
export function spoolHolderModel(d: Design): SpoolHolder {
  d.parameter('axle', '12 mm', { description: 'The axle’s diameter' });
  d.parameter('clearance', '0.4 mm', { description: 'How much wider the bore is than the axle' });
  const plate = d.box({ length: '80 mm', width: '40 mm', height: '6 mm' }, { name: 'Plate' });
  const boss = d.cylinder(
    { diameter: '26 mm', height: '16 mm', operation: 'join' },
    { name: 'Boss' },
  );
  const bore = d.cylinder(
    { diameter: 'axle + clearance', height: '16 mm', operation: 'cut' },
    { name: 'Bore' },
  );
  const screws = [-30, 30].map((x, i) =>
    d.cylinder(
      { x: `${x} mm`, diameter: '4.5 mm', height: '6 mm', operation: 'cut' },
      { name: `Screw hole ${i + 1}` },
    ),
  ) as [FeatureHandle, FeatureHandle];
  // The axle stands in the bore; the flange on top keeps the spool on.
  const shaft = d.cylinder({ diameter: 'axle', height: '50 mm' }, { name: 'Axle' });
  const flange = d.cylinder(
    { diameter: '22 mm', height: '3 mm', offset: '50 mm', operation: 'join' },
    { name: 'Flange' },
  );
  d.setBody(plate.body(), { name: 'Bracket' });
  d.setBody(shaft.body(), { name: 'Axle' });
  return { plate, boss, bore, screws, shaft, flange };
}

/**
 * Where the standard views go on the spool holder's A4 landscape sheet at 1:1, first angle:
 * the top view under the front, the left side to its right, the isometric top right.
 */
export const SPOOL_HOLDER_VIEWS = {
  front: [75, 82],
  top: [75, 140],
  side: [165, 82],
  iso: [240, 70],
} as const satisfies Record<string, readonly [number, number]>;
