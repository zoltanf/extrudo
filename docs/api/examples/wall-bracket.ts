/**
 * The Wall bracket: the design Extrudo opens a new project with
 * (`apps/web/src/project/templates.ts`), built through the public API
 * (ADR-0068 §6). This file is a test — `packages/api/src/examples.test.ts`
 * runs it, and the reference quotes it.
 *
 * ```ts
 * import { wallBracket } from './wall-bracket.ts';
 *
 * const d = wallBracket();
 * const bytes = await d.toFile();   // a .extrudo file
 * d.setParameter('width', '120 mm');
 * ```
 *
 * A small L-bracket with parameters: `width` along the wall, `wall` the sheet
 * thickness, `depth` and `height` its two legs, `tilt` how far the screw holes
 * lean. The side view is a hexagon on the XZ plane, pulled `width` wide
 * symmetrically; two circles on the XY plane cut up through the foot; the bend
 * is rounded inside and outside with radii that stay concentric as `wall`
 * changes.
 */
import { Design, type LineHandle } from '@extrudo/api';

export function wallBracket(): Design {
  const d = Design.create({ name: 'Wall bracket', units: 'mm' });

  // The parameters the sketch and the features read (ADR-0004). A handle is
  // what an expression takes: `${width}` is the parameter's name.
  const width = d.parameter('width', '80 mm', { comment: 'Along the wall' });
  d.parameter('wall', '2.4 mm', { comment: 'Six perimeters of a 0.4 mm nozzle' });
  d.parameter('inner', 'width - 2 * wall', { comment: 'The space behind the bracket' });
  d.parameter('tilt', '15 deg', { comment: 'How far the screw holes lean' });
  const depth = d.parameter('depth', '40 mm');
  const height = d.parameter('height', '60 mm');

  // Sketch1: the side view. Six lines round the L, joined at their corners by
  // `polyline`, held on the axes and dimensioned so the parameters shape it.
  const side = d.sketch(d.origin.xz, (k) => {
    const t = 2.4; // the thickness as far as `wall` is
    const outline = k.polyline([
      [0, 0], // the corner the bracket hangs from
      [40, 0], // along the wall
      [40, t],
      [t, t],
      [t, 60],
      [0, 60],
      [0, 0],
    ]);
    const [bottom, toe, shelf, wall, top, outerWall] = outline.lines;
    const corner = outline.points[0];
    if (!bottom || !toe || !shelf || !wall || !top || !outerWall || !corner) return outline;
    // The corner is where the bracket hangs from: hold it at the origin.
    k.fix(corner);
    k.horizontal(bottom);
    k.vertical(toe);
    k.horizontal(shelf);
    k.vertical(wall);
    k.horizontal(top);
    k.vertical(outerWall);
    // Three dimensions set the shape; the rest follows from them. A dimension
    // with a parameter as its value drives itself with that parameter's name.
    k.dimension(bottom, depth);
    k.dimension(toe, 'wall');
    k.dimension(outerWall, height);
    return outline;
  });

  // Extrude1: the bracket, `width` wide about the plane, symmetric.
  const bracket = d.extrude({
    profiles: side.profileAt([20, 1.2]),
    direction: 'symmetric',
    distance: width,
  });

  // Fillet1: the bend, inside and outside. The two edges are named after the
  // faces the outline swept into (`extrude:<id>:side:<sketch curve>`), which is
  // what `faceName(role)` builds (ADR-0068 §4).
  const bend = (a: LineHandle, b: LineHandle) =>
    bracket.edge([bracket.faceName(`side:${a.id}`), bracket.faceName(`side:${b.id}`)]);
  const [bottom, , shelf, wall, , outerWall] = side.lines();
  if (shelf && wall && outerWall && bottom) {
    d.fillet({
      edges: bend(shelf, wall),
      radius: 'wall / 2',
      edges2: bend(outerWall, bottom),
      radius2: 'wall * 1.5',
    });
  }

  // Sketch2: two screw holes on the foot, and Extrude2 cutting them up through
  // it with a slight taper, so they widen towards the top.
  const holes = d.sketch(d.origin.xy, (k) => {
    k.circle([25, 20], '2.5 mm');
    k.circle([25, -20], '2.5 mm');
  });
  d.extrude({
    profiles: holes.profiles(),
    distance: 'wall * 5',
    taper: 'tilt / 3',
    operation: 'cut',
  });

  return d;
}
