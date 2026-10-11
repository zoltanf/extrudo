/**
 * Sketches as code (ADR-0073 §2): a stored sketch becomes
 * `design.sketch(plane, (k) => { … })`, every entity with its solved
 * coordinates and every constraint and dimension as a builder call. Nothing is
 * solved: the positions are the stored ones (ADR-0070 §1).
 *
 * A point owned by a curve is not its own call — the builder makes a line's
 * points — so constraints and dimensions reference it as `l1.start` and the
 * like. References from other features use `sketch.points()[i]` and friends
 * (added for this), which need no builder variable.
 */
import type {
  Feature,
  SketchConstraint,
  SketchData,
  SketchDimension,
  SketchEntity,
  SketchEntityId,
  Vec2,
} from '@extrudo/core';
import { ATTACHMENT_FONT_PREFIX, attachmentFontId } from '@extrudo/core';
import type { EmitContext } from './context';
import {
  arr,
  bool,
  call,
  comment,
  constant,
  type Expr,
  num,
  obj,
  raw,
  type Stmt,
  str,
} from './print';
import { refExpr } from './refs';

/**
 * The font a text falls back to when its own is a user font (`@extrudo/fonts`'
 * `DEFAULT_FONT`, which this package may not import — ADR-0073). The ID never
 * changes its file (ADR-0058 §3), so it is safe to name here.
 */
const DEFAULT_FONT_ID = 'inter-regular@1';

/** The `design.sketch(…)` call for a selected sketch feature. */
export function sketchExpr(
  feature: Feature,
  name: string | undefined,
  componentVar: string | undefined,
  ctx: EmitContext,
): Expr {
  const view = ctx.sketchOf.get(feature.id);
  if (!view) throw new Error(`No stored sketch for ${feature.id}.`);
  const { plane, data } = view;
  const result = sketchBody(data, ctx);
  const planeExpr = refExpr(plane, ctx);
  const args: Expr[] = [planeExpr, { t: 'arrow', params: '(k)', body: result.body }];
  const options = sketchOptions(name, result.construction, componentVar);
  if (options) args.push(options);
  return call('design.sketch', args);
}

interface Body {
  body: Stmt[];
  /** Whether every curve is construction, so the sketch's option says so. */
  construction: boolean;
}

/** The builder's statements for a sketch's content. */
function sketchBody(data: SketchData, ctx: EmitContext): Body {
  const entities = Object.entries(data.entities) as [SketchEntityId, SketchEntity][];
  const owned = ownedPoints(entities);
  const refs = new Map<string, Expr>();
  const counters = new Map<string, number>();
  const body: Stmt[] = [];

  const nameOf = (kind: string): string => {
    const next = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, next);
    return `${kind}${next}`;
  };
  const at = (id: SketchEntityId): Vec2 => {
    const point = data.entities[id];
    if (point?.type !== 'point') throw new Error(`No point ${id}.`);
    return [point.x, point.y];
  };
  const curveConstruction: boolean[] = [];

  for (const [id, entity] of entities) {
    switch (entity.type) {
      case 'point': {
        if (owned.has(id)) break;
        const variable = nameOf('p');
        refs.set(id, raw(variable));
        body.push(constant(variable, call('k.point', [vec(at(id))])));
        break;
      }
      case 'line': {
        const variable = nameOf('l');
        refs.set(id, raw(variable));
        refs.set(entity.start, raw(`${variable}.start`));
        refs.set(entity.end, raw(`${variable}.end`));
        curveConstruction.push(entity.construction);
        body.push(constant(variable, call('k.line', [vec(at(entity.start)), vec(at(entity.end))])));
        break;
      }
      case 'circle': {
        const variable = nameOf('c');
        refs.set(id, raw(variable));
        refs.set(entity.center, raw(`${variable}.center`));
        curveConstruction.push(entity.construction);
        body.push(
          constant(variable, call('k.circle', [vec(at(entity.center)), num(entity.radius)])),
        );
        break;
      }
      case 'arc': {
        const variable = nameOf('a');
        refs.set(id, raw(variable));
        refs.set(entity.center, raw(`${variable}.center`));
        refs.set(entity.start, raw(`${variable}.start`));
        refs.set(entity.end, raw(`${variable}.end`));
        curveConstruction.push(entity.construction);
        body.push(
          constant(
            variable,
            call('k.arcCentered', [
              vec(at(entity.center)),
              vec(at(entity.start)),
              vec(at(entity.end)),
            ]),
          ),
        );
        break;
      }
      case 'ellipse': {
        const variable = nameOf('e');
        refs.set(id, raw(variable));
        refs.set(entity.center, raw(`${variable}.center`));
        refs.set(entity.major, raw(`${variable}.major`));
        refs.set(entity.minor, raw(`${variable}.minor`));
        curveConstruction.push(entity.construction);
        body.push(
          constant(
            variable,
            call('k.ellipse', [
              vec(at(entity.center)),
              vec(at(entity.major)),
              vec(at(entity.minor)),
            ]),
          ),
        );
        break;
      }
      case 'spline': {
        const variable = nameOf('s');
        refs.set(id, raw(variable));
        entity.points.forEach((point, index) => {
          refs.set(point, raw(`${variable}.points[${index}]`));
        });
        curveConstruction.push(entity.construction);
        const points = arr(entity.points.map((point) => vec(at(point))));
        if (entity.mode === 'conic' && entity.points.length === 3) {
          // A valid conic always carries its rho (the schema requires it);
          // naming the missing one beats silently writing the 0.5 default.
          if (entity.rho === undefined) throw new Error(`The conic ${id} has no rho.`);
          body.push(
            constant(
              variable,
              call('k.conic', [
                vec(at(entity.points[0] as SketchEntityId)),
                vec(at(entity.points[1] as SketchEntityId)),
                vec(at(entity.points[2] as SketchEntityId)),
                num(entity.rho),
              ]),
            ),
          );
        } else {
          const method = entity.mode === 'control' ? 'k.splineControl' : 'k.spline';
          // A closed loop and a control spline's own knots (ADR-0063's P4-12 amendment).
          const shape: [string, ReturnType<typeof num>][] = [];
          if (entity.closed) shape.push(['closed', bool(true)]);
          if (entity.knots && entity.mode === 'control') {
            shape.push(['knots', arr(entity.knots.map((k) => num(k)))]);
          }
          body.push(
            constant(variable, call(method, shape.length > 0 ? [points, obj(shape)] : [points])),
          );
        }
        break;
      }
      case 'text': {
        const variable = nameOf('t');
        refs.set(id, raw(variable));
        refs.set(entity.anchor, raw(`${variable}.anchor`));
        refs.set(entity.top, raw(`${variable}.top`));
        curveConstruction.push(entity.construction);
        // A user font's bytes travel with the design, which a script can't
        // carry (ADR-0073): the text keeps its string and the bundled default
        // font, with a comment naming the font it had.
        const userFont =
          entity.font.startsWith(ATTACHMENT_FONT_PREFIX) &&
          attachmentFontId(entity.font) !== undefined;
        if (userFont) {
          const attachment = attachmentFontId(entity.font);
          const named = (attachment && ctx.doc.attachments?.[attachment]?.name) || entity.font;
          body.push(
            comment(
              `This text used the user font "${named}", which a script can't carry; Inter is used instead.`,
            ),
          );
        }
        const content: [string, Expr][] = [
          ['text', str(entity.text)],
          ['font', str(userFont ? DEFAULT_FONT_ID : entity.font)],
        ];
        if (entity.align !== 'left') content.push(['align', str(entity.align)]);
        body.push(
          constant(
            variable,
            call('k.text', [
              vec(at(entity.anchor)),
              vec(at(entity.top)),
              obj(content),
              obj([
                ['upright', bool(false)],
                ['height', bool(false)],
              ]),
            ]),
          ),
        );
        break;
      }
    }
  }

  for (const constraint of Object.values(data.constraints)) {
    body.push({ s: 'expr', value: constraintExpr(constraint, refs) });
  }
  for (const dimension of Object.values(data.dimensions)) {
    body.push({ s: 'expr', value: dimensionExpr(dimension, refs) });
  }
  // Projected geometry is stored as the curves it became; the solver held it
  // fixed (ADR-0031), which a script cannot ask for (ADR-0073 §2).
  if (data.projections && Object.keys(data.projections).length > 0) {
    body.unshift(comment('Projected geometry (a script cannot project it).'));
  }
  const construction =
    curveConstruction.length > 0 && curveConstruction.every((value) => value === true);
  if (curveConstruction.some((value) => value === true) && !construction) {
    body.unshift(comment('Construction flags are not preserved by the builder.'));
  }
  return { body, construction };
}

/** The points a curve owns, which the builder makes with the curve. */
function ownedPoints(entities: readonly [SketchEntityId, SketchEntity][]): Set<string> {
  const owned = new Set<string>();
  for (const [, entity] of entities) {
    switch (entity.type) {
      case 'line':
        owned.add(entity.start).add(entity.end);
        break;
      case 'circle':
        owned.add(entity.center);
        break;
      case 'arc':
        owned.add(entity.center).add(entity.start).add(entity.end);
        break;
      case 'ellipse':
        owned.add(entity.center).add(entity.major).add(entity.minor);
        break;
      case 'spline':
        for (const point of entity.points) owned.add(point);
        break;
      case 'text':
        owned.add(entity.anchor).add(entity.top);
        break;
      case 'point':
        break;
    }
  }
  return owned;
}

function vec(point: Vec2): Expr {
  return arr([num(point[0]), num(point[1])]);
}

function refTo(id: SketchEntityId, refs: ReadonlyMap<string, Expr>): Expr {
  const found = refs.get(id);
  if (!found) throw new Error(`No entity ${id} in the sketch.`);
  return found;
}

/** A constraint as the builder call that makes it. */
function constraintExpr(constraint: SketchConstraint, refs: ReadonlyMap<string, Expr>): Expr {
  const a = (id: SketchEntityId) => refTo(id, refs);
  switch (constraint.type) {
    case 'coincident':
      return call('k.coincident', [a(constraint.a), a(constraint.b)]);
    case 'pointOnCurve':
      return call('k.pointOnCurve', [a(constraint.point), a(constraint.curve)]);
    case 'collinear':
      return call('k.collinear', [a(constraint.a), a(constraint.b)]);
    case 'concentric':
      return call('k.concentric', [a(constraint.a), a(constraint.b)]);
    case 'midpoint':
      return call('k.midpoint', [a(constraint.point), a(constraint.of)]);
    case 'fix':
      return call('k.fix', [a(constraint.entity)]);
    case 'parallel':
      return call('k.parallel', [a(constraint.a), a(constraint.b)]);
    case 'perpendicular':
      return call('k.perpendicular', [a(constraint.a), a(constraint.b)]);
    case 'horizontal':
      return call(
        'k.horizontal',
        constraint.b === undefined ? [a(constraint.a)] : [a(constraint.a), a(constraint.b)],
      );
    case 'vertical':
      return call(
        'k.vertical',
        constraint.b === undefined ? [a(constraint.a)] : [a(constraint.a), a(constraint.b)],
      );
    case 'tangent':
      return call('k.tangent', [
        a(constraint.a),
        a(constraint.b),
        ...(constraint.reversed ? [bool(true)] : []),
      ]);
    case 'smooth':
      return call('k.smooth', [
        a(constraint.a),
        a(constraint.b),
        ...(constraint.reversed ? [bool(true)] : []),
      ]);
    case 'equal':
      return call('k.equal', [a(constraint.a), a(constraint.b)]);
    case 'symmetric':
      return call('k.symmetric', [a(constraint.a), a(constraint.b), a(constraint.axis)]);
  }
}

/** A dimension as the builder call that makes it, its value and name included. */
function dimensionExpr(dimension: SketchDimension, refs: ReadonlyMap<string, Expr>): Expr {
  const a = (id: SketchEntityId) => refTo(id, refs);
  const options: [string, Expr][] = [];
  const value = str(dimension.expr);
  switch (dimension.type) {
    case 'distance': {
      if (dimension.orientation !== 'aligned')
        options.push(['orientation', str(dimension.orientation)]);
      addDimensionOptions(options, dimension);
      const target =
        dimension.b === undefined ? a(dimension.a) : arr([a(dimension.a), a(dimension.b)]);
      return call('k.distance', withOptions([target, value], options));
    }
    case 'radius':
    case 'diameter': {
      addDimensionOptions(options, dimension);
      return call(`k.${dimension.type}`, withOptions([a(dimension.curve), value], options));
    }
    case 'angle': {
      if (dimension.supplement) options.push(['supplement', bool(true)]);
      addDimensionOptions(options, dimension);
      return call('k.angle', withOptions([a(dimension.a), a(dimension.b), value], options));
    }
  }
}

function addDimensionOptions(options: [string, Expr][], dimension: SketchDimension): void {
  if (dimension.paramName !== undefined) options.push(['name', str(dimension.paramName)]);
  if (dimension.driven) options.push(['driven', bool(true)]);
}

function withOptions(args: Expr[], options: [string, Expr][]): Expr[] {
  return options.length > 0 ? [...args, obj(options)] : args;
}

/** The `d.sketch` options: its name, its component and whether every curve is construction. */
function sketchOptions(
  name: string | undefined,
  construction: boolean,
  componentVar: string | undefined,
): Expr | undefined {
  const props: [string, Expr][] = [];
  if (componentVar !== undefined) props.push(['component', raw(componentVar)]);
  if (name !== undefined) props.push(['name', str(name)]);
  if (construction) props.push(['construction', bool(true)]);
  return props.length > 0 ? obj(props) : undefined;
}
