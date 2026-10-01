/**
 * The hole feature in the kernel (P3-04, ADR-0049, FR-FT-07): a solid of
 * revolution per hole, cut out of the bodies it touches. No facade method:
 * each hole is a half section (a polygon beside its axis) turned a whole
 * turn about the axis by `namedRevolve`, as a sphere is (ADR-0032); the
 * holes go into one tool (`mergeTools`) and the body operation is the cut
 * extrude, revolve and the primitives share (`operate`).
 *
 * The section, in the frame (u radial, v along the drilling direction from
 * the plane), by type and extent. Segment sources (the last part of a face
 * name, `hole:<id>:side:<source>`) in brackets:
 *
 * | | outline from the axis at the plane |
 * |---|---|
 * | simple, blind | out to the radius [top], down [wall], in to a point `tip` deep [tip] (a flat [floor] for 0°) |
 * | counterbore | [top] out to the step, [cbwall] down, [cbfloor] in to the hole, then as simple |
 * | countersink | [top] out to the cone's diameter, [cone] down to the hole's radius, then as simple |
 * | through | the same, but the [wall] runs past every body and closes flat [bottom] |
 *
 * With sketch points every hole's sources are prefixed with the point's
 * entity ID (`<point>.wall`), so a face keeps its name when other points
 * come and go; a hole at a clicked point has plain sources.
 */
import {
  type FeatureId,
  type GeomRef,
  HOLE_DEFAULTS,
  type HoleInputs,
  type HoleSettings,
  holeFeature,
  holeSettings,
  parseSketchEntityRefId,
  type SketchFrame,
  sketchToWorld,
  type Vec2,
} from '@extrudo/core';
import { KernelError, type ShapeScope, type Vec3 } from '../kernel';
import { type NamedShape, namedRevolve } from '../naming/ops';
import { LostReferenceError } from '../naming/resolve';
import type { PlanarCurve } from '../planar';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';
import { splitSolids } from './bodies';
import { boxesTouch, type OperationWords, operate, TOUCH } from './operation';
import { mergeTools } from './pattern';
import { planarFace, planeFrame, upright } from './primitives';
import type { SketchOutputData } from './sketch';
import { add, corners, cross, dot, scale, sub } from './vec';

/** Most holes one feature makes. */
export const MAX_HOLES = 200;

/** Lengths (mm) at or below which a size is none. */
const EPS = 1e-6;

/** How a hole speaks of itself in messages and names its boolean faces. */
const WORDS: OperationWords = {
  noun: 'hole',
  check: 'Check where it sits, how deep it goes and its direction (Flip).',
};

/** The `data` of a hole's output: where the holes start and which way they go. */
export interface HoleOutputData {
  /** The frame of the plane the holes start on (`faceSketchFrame` for a face). */
  frame: SketchFrame;
  /** The drilling direction, a unit vector (against the plane's normal, or along it when flipped). */
  direction: Vec3;
  /** Each hole's centre on the plane (world mm), with the sketch point's entity ID it came from. */
  holes: { at: Vec3; point?: string }[];
  /** Every number's value (mm, degrees), defaults filled in, by input name. */
  numbers: Numbers;
}

/** Every number of a hole (mm, degrees), by input name. */
export interface Numbers {
  x: number;
  y: number;
  diameter: number;
  depth: number;
  tipAngle: number;
  cbDiameter: number;
  cbDepth: number;
  csDiameter: number;
  csAngle: number;
}

/** One hole to drill: where it starts and how its faces are named. */
interface Place {
  at: Vec3;
  /** The sketch point's entity ID; none for the clicked point. */
  point?: string;
}

export const kernelHole: KernelFeatureDefinition<HoleInputs> = {
  ...holeFeature,
  bodyAccess: () => 'write',
  evaluate(ctx): FeatureOutput {
    const settings = holeSettings(ctx.inputs);
    const numbers = numbersOf(ctx, settings);
    const plane = planeFrame(ctx, settings.plane, 'the hole');
    const direction: Vec3 = scale(plane.normal, settings.flip ? 1 : -1);
    const warnings: string[] = [];
    const places = placesOf(ctx, settings, plane, numbers, warnings);
    // The frame the section is drawn in: x across, v along the drilling direction.
    const frame: SketchFrame = {
      origin: plane.origin,
      x: plane.x,
      y: cross(direction, plane.x),
      normal: direction,
    };

    using scope = ctx.kernel.scope();
    const reach = settings.extent === 'through' ? throughLength(ctx, places, direction) : 0;
    const parts = places.map((place) => {
      const at: SketchFrame = { ...frame, origin: place.at };
      return buildHole(ctx, scope, at, settings, numbers, reach, place.point);
    });

    // Holes that start nowhere near a body cut nothing: say so (the cut says
    // it when none does).
    // Boxes first: an exact distance only for a body whose box meets the hole's.
    const bodies = [...ctx.bodies.values()].map((shape) => ({
      shape,
      box: ctx.kernel.measure(shape).bbox,
    }));
    const misses = parts.filter((part) => {
      const box = ctx.kernel.measure(part.shape).bbox;
      return !bodies.some(
        (body) => boxesTouch(body.box, box) && ctx.kernel.distance(body.shape, part.shape) <= TOUCH,
      );
    }).length;
    if (misses > 0 && misses < parts.length) {
      warnings.push(
        `${misses} of ${parts.length} holes don't reach a body, so they cut nothing. Check the points.`,
      );
    }

    const tool = mergeTools(ctx, scope, parts, 'hole');
    const result = splitSolids(
      ctx,
      scope,
      operate(ctx, scope, { operation: 'cut', bodies: [] }, tool, undefined, warnings, WORDS),
    );
    const data: HoleOutputData = {
      frame: plane,
      direction,
      holes: places.map((p) => ({ at: p.at, ...(p.point && { point: p.point }) })),
      numbers,
    };
    return { ...result, data, ...(warnings.length > 0 && { warnings }) };
  },
};

// ------------------------------------------------------------------ numbers

/** Every number of the hole, the sizes checked for the type and extent. */
function numbersOf(ctx: EvalContext, settings: HoleSettings): Numbers {
  const get = (name: keyof Numbers) =>
    settings.exprs.has(name) ? ctx.value(name) : (HOLE_DEFAULTS[name] as number);
  const n: Numbers = {
    x: get('x'),
    y: get('y'),
    diameter: get('diameter'),
    depth: get('depth'),
    tipAngle: get('tipAngle'),
    cbDiameter: get('cbDiameter'),
    cbDepth: get('cbDepth'),
    csDiameter: get('csDiameter'),
    csAngle: get('csAngle'),
  };
  const { diameter, depth, tipAngle, cbDiameter, cbDepth, csDiameter, csAngle } = n;
  if (!(diameter > EPS)) throw new KernelError('The diameter must be greater than 0.');
  const blind = settings.extent === 'blind';
  if (blind && !(depth > EPS)) throw new KernelError('The depth must be greater than 0.');
  if (blind && !(tipAngle >= 0 && tipAngle < 180)) {
    throw new KernelError('The drill point angle must be from 0° (flat) to less than 180°.');
  }
  if (settings.type === 'counterbore') {
    if (!(cbDiameter > diameter + EPS)) {
      throw new KernelError(
        `The counterbore diameter (${round(cbDiameter)} mm) must be larger than the hole's (${round(diameter)} mm).`,
      );
    }
    if (!(cbDepth > EPS)) throw new KernelError('The counterbore depth must be greater than 0.');
    if (blind && !(cbDepth < depth - EPS)) {
      throw new KernelError(
        `The counterbore (${round(cbDepth)} mm) is as deep as the hole (${round(depth)} mm). Make the hole deeper or the counterbore shallower.`,
      );
    }
  }
  if (settings.type === 'countersink') {
    if (!(csDiameter > diameter + EPS)) {
      throw new KernelError(
        `The countersink diameter (${round(csDiameter)} mm) must be larger than the hole's (${round(diameter)} mm).`,
      );
    }
    if (!(csAngle > EPS && csAngle < 180 - EPS)) {
      throw new KernelError('The countersink angle must be more than 0° and less than 180°.');
    }
    const cone = countersinkDepth(diameter, csDiameter, csAngle);
    if (blind && !(cone < depth - EPS)) {
      throw new KernelError(
        `The countersink is ${round(cone)} mm deep, as deep as the hole (${round(depth)} mm). Make the hole deeper or the countersink smaller.`,
      );
    }
  }
  return n;
}

/** How deep a countersink's cone runs from its diameter at the surface to the hole's. */
export function countersinkDepth(diameter: number, csDiameter: number, angle: number): number {
  return (csDiameter - diameter) / 2 / Math.tan((angle * Math.PI) / 360);
}

const round = (value: number) => Math.round(value * 1000) / 1000;

// ---------------------------------------------------------------- placement

/** The holes' places: the sketch points, or the one clicked point. */
function placesOf(
  ctx: EvalContext,
  settings: HoleSettings,
  plane: SketchFrame,
  n: Numbers,
  warnings: string[],
): Place[] {
  if (settings.points.length === 0) {
    const at = add(add(plane.origin, scale(plane.x, n.x)), scale(plane.y, n.y));
    return [{ at }];
  }
  const places: Place[] = [];
  for (const ref of settings.points) {
    const { at, point } = sketchPoint(ctx, ref, plane);
    if (places.some((p) => length2(sub(p.at, at)) < EPS)) {
      warnings.push('Two of the points are in the same place, so they make one hole.');
      continue;
    }
    places.push({ at, point });
  }
  if (places.length > MAX_HOLES) {
    throw new KernelError(
      `A hole feature can make up to ${MAX_HOLES} holes, and this one makes ${places.length}. Pick fewer points.`,
    );
  }
  return places;
}

/** A sketch point dropped along the plane's normal onto the plane. */
function sketchPoint(ctx: EvalContext, ref: GeomRef, plane: SketchFrame) {
  const lost = new LostReferenceError(
    "Can't find one of the sketch points any more: an earlier change to its sketch removed it. Edit the hole and pick the points again.",
    ref,
  );
  const parsed = parseSketchEntityRefId(ref.id);
  if (!parsed) throw lost;
  let data: Partial<SketchOutputData> | undefined;
  try {
    data = ctx.output(parsed.feature as FeatureId).data as Partial<SketchOutputData> | undefined;
  } catch {
    data = undefined;
  }
  const p: Vec2 | undefined = data?.points?.[parsed.entity];
  if (!data?.frame || !p) throw lost;
  const world = sketchToWorld(data.frame, p);
  const off = dot(sub(world, plane.origin), plane.normal);
  return { at: sub(world, scale(plane.normal, off)), point: parsed.entity as string };
}

const length2 = (v: Vec3) => dot(v, v);

/**
 * How far a through hole runs from the plane along `direction`: past the far
 * corner of every body's box, and 1 mm more. With no body ahead it is 1 mm
 * (and the cut says nothing was there).
 */
function throughLength(ctx: EvalContext, places: readonly Place[], direction: Vec3): number {
  let reach = 0;
  for (const shape of ctx.bodies.values()) {
    const { min, max } = ctx.kernel.measure(shape).bbox;
    for (const corner of corners(min as Vec3, max as Vec3)) {
      for (const place of places) reach = Math.max(reach, dot(sub(corner, place.at), direction));
    }
  }
  return reach + 1;
}

// ------------------------------------------------------------------ the solid

/** A polygon beside the axis: its vertices from the axis at the plane round to the axis, and each segment's source. */
interface Section {
  vertices: Vec2[];
  /** One per segment: `vertices[i]` to `vertices[i + 1]`, the last back to the start along the axis. */
  sources: string[];
}

/** The section of a hole (see the table above). `reach` is a through hole's length. */
export function holeSection(settings: HoleSettings, n: Numbers, reach: number): Section {
  const r = n.diameter / 2;
  const vertices: Vec2[] = [[0, 0]];
  const sources: string[] = [];
  const go = (u: number, v: number, source: string) => {
    vertices.push([u, v]);
    sources.push(source);
  };
  let step = 0;
  if (settings.type === 'counterbore') {
    const rc = n.cbDiameter / 2;
    step = n.cbDepth;
    go(rc, 0, 'top');
    go(rc, step, 'cbwall');
    go(r, step, 'cbfloor');
  } else if (settings.type === 'countersink') {
    step = countersinkDepth(n.diameter, n.csDiameter, n.csAngle);
    go(n.csDiameter / 2, 0, 'top');
    go(r, step, 'cone');
  } else {
    go(r, 0, 'top');
  }
  if (settings.extent === 'through') {
    go(r, reach, 'wall');
    go(0, reach, 'bottom');
  } else {
    const depth = n.depth;
    go(r, depth, 'wall');
    const tip = n.tipAngle;
    if (tip > 0) go(0, depth + r / Math.tan((tip * Math.PI) / 360), 'tip');
    else go(0, depth, 'floor');
  }
  sources.push('axis');
  return { vertices, sources };
}

function buildHole(
  ctx: EvalContext,
  scope: ShapeScope,
  frame: SketchFrame,
  settings: HoleSettings,
  n: Numbers,
  reach: number,
  point: string | undefined,
): NamedShape {
  const { vertices, sources } = holeSection(settings, n, reach);
  const curves: PlanarCurve[] = vertices.map((a, i) => ({
    kind: 'line',
    a,
    b: vertices[(i + 1) % vertices.length] as Vec2,
  }));
  const prefix = point === undefined ? '' : `${point}.`;
  const face = planarFace(
    ctx,
    scope,
    curves,
    upright(frame),
    sources.map((s) => `${prefix}${s}`),
  );
  const tool = namedRevolve(ctx.kernel, {
    feature: ctx.feature.id,
    op: 'hole',
    ...face,
    axis: { origin: frame.origin, direction: frame.normal },
    angle: 2 * Math.PI,
  });
  scope.track(tool.shape);
  return tool;
}
