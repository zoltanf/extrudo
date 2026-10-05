/**
 * A parametric box: a storage box whose size and wall thickness are parameters
 * with customizer ranges (ADR-0059), saved as two configurations to switch
 * between, hollowed, rounded at the rim and drilled for screws. Built through
 * the public API (ADR-0068 §6); `packages/api/src/examples.test.ts` runs this
 * file.
 *
 * ```ts
 * import { parametricBox } from './parametric-box.ts';
 *
 * const d = parametricBox();
 * d.applyConfiguration('Large');
 * d.getParameter('width').parameter?.customizer;   // the slider's range
 * ```
 *
 * The box is made the way a person makes it with the Box tool — its three sizes
 * are expressions, so the parameters drive it — and every later feature names
 * what it works on through the box's own face roles (`box:<id>:side:top`,
 * ADR-0068 §4).
 */
import { Design } from '@extrudo/api';

/** One of the four walls of a box (`box:<id>:side:…`, ADR-0032). */
type BoxSide = 'side:front' | 'side:right' | 'side:back' | 'side:left';

export function parametricBox(): Design {
  const d = Design.create({ name: 'Storage box', units: 'mm' });

  // A parameter with a customizer shows in the Customizer panel as a slider;
  // the range is the slider's range, not a limit on the value (ADR-0059).
  const width = d.parameter('width', '120 mm', {
    comment: 'Along X',
    customizer: { min: 60, max: 300, step: 10, group: 'Size' },
  });
  const depth = d.parameter('depth', '80 mm', {
    comment: 'Along Y',
    customizer: { min: 40, max: 200, step: 10, group: 'Size' },
  });
  const height = d.parameter('height', '40 mm', {
    comment: 'Along Z',
    customizer: { min: 20, max: 150, step: 5, group: 'Size' },
  });
  const wall = d.parameter('wall', '2.4 mm', {
    comment: 'The walls',
    customizer: { min: 0.8, max: 6, step: 0.2, group: 'Walls' },
  });
  const spacing = d.parameter('spacing', '70 mm', { comment: 'Between the screw holes' });

  // The box. A handle stands for its parameter's name, so `length: width` stores
  // the expression `width` (ADR-0068 §2).
  const box = d.box({ length: width, width: depth, height });

  // Take the top off and hollow the rest to the wall's thickness. A shell keeps
  // the names of the faces it is made of and names its own: the rim round the
  // opening is `shell:<id>:rim:(<the face that was removed>)`.
  const shell = d.shell({ faces: box.face('cap:end'), thickness: wall });

  // Round the rim. An edge is named after the two faces it runs between, which
  // is what `edge([faceName, faceName])` builds — here one face is the box's and
  // the other is the shell's.
  const rim = shell.faceName(`rim:(${box.faceName('cap:end')})`);
  const round = (side: BoxSide) =>
    d.fillet({ edges: shell.edge([rim, box.faceName(side)]), radius: '1.5 mm' });
  for (const side of ['side:front', 'side:right', 'side:back', 'side:left'] as const) round(side);

  // Two screw holes through the floor, placed at sketch points: a point on the
  // sketch's plane, dimensioned from one to the other (ADR-0049, ADR-0068 §5).
  const plan = d.sketch(d.origin.xy, (k) => {
    // A Box primitive is centred on its plane's origin, so the holes go at
    // ±`spacing / 2`.
    const left = k.point([-35, 0]);
    const right = k.point([35, 0]);
    if (left && right) k.dimension([left, right], spacing, { orientation: 'horizontal' });
  });
  const [left, right] = plan.points();
  if (left && right) {
    // The holes are drilled from the box's own floor, at the sketch's points
    // (ADR-0049), straight through.
    d.hole({
      plane: box.face('cap:start'),
      points: [left.ref(), right.ref()],
      diameter: '4 mm',
      extent: 'through',
    });
  }

  // Two configurations of the same design: each holds the values it lists, and
  // `applyConfiguration` puts them on the parameters in one step (ADR-0059).
  d.configuration('Small', { width: '80 mm', depth: '60 mm', height: '30 mm' });
  d.configuration('Large', { width: '200 mm', depth: '140 mm', height: '80 mm' });
  return d;
}
