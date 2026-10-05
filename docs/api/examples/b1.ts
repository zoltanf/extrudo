/**
 * Benchmark B1 (requirements §7): a parametric plate with four corner holes.
 * The design the e2e spec `e2e/benchmark-b1.spec.ts` draws through the UI and
 * exports as `fixtures/benchmarks/b1-plate.extrudo`, built here through the
 * public API (ADR-0068 §6). `packages/api/src/examples.test.ts` compares the
 * sketch with the fixture's, up to the IDs, and recomputes the result with the
 * kernel.
 *
 * ```
 * import { b1 } from './b1.ts';
 *
 * const d = b1();
 * d.setParameter('width', '200 mm');   // the plate follows
 * ```
 *
 * The plate is a rectangle with its first corner fixed at the origin and its
 * size dimensioned; the four holes are circles whose centres line up with each
 * other and whose size is one diameter dimension with three `equal` constraints,
 * which is how the Circle tool leaves them. B1 is a sketch (its benchmark is the
 * constrained drawing), so this example extrudes the plate as well — 10 mm, which
 * gives the recompute something to measure.
 */
import { Design } from '@extrudo/api';

export function b1(thickness = '10 mm'): Design {
  const d = Design.create({ name: 'B1 Plate', units: 'mm' });

  // `margin` keeps the four holes centred whatever the width and the spacing
  // are; `spacing` is the distance between two hole centres.
  d.parameter('width', '120 mm');
  d.parameter('depth', '80 mm');
  d.parameter('spacing', '70 mm');
  d.parameter('hole', '6 mm');
  d.parameter('margin', '(width - spacing) / 2');

  const plate = d.sketch(d.origin.xy, (k) => {
    // The plate, 120 × 80 from the origin: four lines, joined and on the axes,
    // with its corner fixed and its two sides dimensioned.
    const outline = k.rectangle([0, 0], [120, 80]);
    if (outline.corners[0]) k.fix(outline.corners[0]);
    k.dimension(outline.bottom, 'width');
    k.dimension(outline.left, 'depth');

    // The holes: Ø6 at 25 mm in from each corner, the first one's diameter
    // dimensioned and the other three made equal to it.
    const holes = [
      k.circle([25, 25], '3 mm'),
      k.circle([95, 25], '3 mm'),
      k.circle([25, 55], '3 mm'),
      k.circle([95, 55], '3 mm'),
    ];
    const [first, right, far, farRight] = holes;
    if (!first || !right || !far || !farRight) return { outline, holes };
    // Level with and upright to the first one, as the pointer inferred.
    k.horizontal(right.center, first.center);
    k.vertical(far.center, first.center);
    k.horizontal(farRight.center, far.center);
    k.vertical(farRight.center, right.center);
    k.equal(first.id, right.id);
    k.equal(first.id, far.id);
    k.equal(first.id, farRight.id);
    // Where the pattern sits: from the plate's corner to the first hole, and
    // between the holes themselves.
    k.dimension([first.center, right.center], 'spacing');
    k.dimension([first.center, far.center], 'depth - 2 * margin');
    const corner = outline.corners[0];
    if (corner) {
      k.dimension([corner, first.center], 'margin', { orientation: 'horizontal' });
      k.dimension([corner, first.center], 'margin', { orientation: 'vertical' });
    }
    k.diameter(first, 'hole');
    return { outline, holes };
  });

  // B1 is a sketch; this is the plate as a solid, 10 mm thick.
  d.extrude({ profiles: plate.profileAt([60, 40]), distance: thickness });
  return d;
}
