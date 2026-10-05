/**
 * The emboss feature in the kernel (P4-04, ADR-0060, FR-FT-16): puts sketch
 * profiles or text **onto** a face of a body — the same thing as sketching on
 * the face and extruding out or in, done in one step from a sketch that lies
 * anywhere in a parallel plane.
 *
 * For a **flat** face (ADR-0060 §2):
 *
 * - the profiles come from `partsOf` (sketch profiles and whole texts,
 *   ADR-0058 §5) and are united into one source;
 * - every part's plane must be **parallel** to the face's, any offset and
 *   either side, else the error that says so;
 * - the united source is moved onto the face's plane — a translation along
 *   the face's outward normal by the signed distance between the planes
 *   (`transform`, `features/matrix.ts`) — and swept `depth` along that normal
 *   (`emboss`) or against it (`deboss`) with `namedPrism`;
 * - the tool is joined to (`emboss`) or cut from (`deboss`) **only the body
 *   that owns the face** (`operate`), and `splitSolids` keeps one body per
 *   solid.
 *
 * For a **cylindrical** face (ADR-0060 §3) the profiles are **wrapped** round
 * it instead of moved onto it, so letters keep their width measured along the
 * surface: each part's face goes through `Kernel.wrapOnCylinder` in the
 * unrolled frame of the cylinder and the sketches' plane, the wraps are fused
 * into one tool (`mergeTools`), and that joins or cuts as above. The sketch
 * plane has to run **along** the axis; which way round the wall the letters
 * grow is the face itself: they stand out of it for an emboss and go into it
 * for a deboss, which for a hole's wall means into the material and into the
 * hole's free space the other way round.
 *
 * **The face's outward normal** comes from `Kernel.surfaceGeometry` for a plane
 * (the facade returns it reversed for a face whose orientation is `REVERSED`,
 * so it points out of the body, the same thing `describe` reports as a plane
 * face's `direction`) and from `Kernel.threadFace` for a cylinder, which also
 * says whether the wall is a boss's (its normal points away from the axis) or
 * a hole's.
 *
 * Names: the prism's or the wrap's own, under `emboss:<id>` — `…:cap:start`
 * (on the face) and `…:cap:end`, and `…:side:<sketch curve>` for each edge of
 * the profiles, taken through the move's history so they follow the rebuild.
 */
import {
  type BodyId,
  EMBOSS_DEFAULT_DEPTH,
  type EmbossInputs,
  type EmbossMode,
  embossFeature,
  embossSettings,
} from '@extrudo/core';
import {
  KernelError,
  type OperationResult,
  type ShapeHandle,
  type ShapeScope,
  type ThreadFace,
  type Vec3,
  type WrapFrame,
} from '../kernel';
import { type NamedShape, namedPrism, namedWrap, type SweepSource } from '../naming/ops';
import type { ResolvedRef } from '../naming/resolve';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';
import { splitSolids } from './bodies';
import { translation } from './matrix';
import { type OperationWords, operate, TOUCH } from './operation';
import { mergeTools } from './pattern';
import { type Base, centroidOf, type Plane, partsOf, uniteParts } from './sources';
import { add, cross, dot, scale, sub, unit } from './vec';

/** Lengths (mm) at or below which an emboss has none. */
const EPS = 1e-6;

/** Cosines within this of ±1 are parallel plane normals (as in `sources.ts`). */
const PARALLEL_TOLERANCE = 1e-6;

/**
 * Cosines at or above this of 0 mean the sketch plane runs across the
 * cylinder's axis instead of along it (ADR-0060 §3; the facade refuses it too).
 */
const AXIS_TOLERANCE = 1e-6;

/** How an emboss speaks of itself (the shared operation code, `operation.ts`). */
const WORDS: OperationWords = {
  noun: 'emboss',
  check: 'Check the profiles, the face and the depth.',
};

/**
 * The `data` of an emboss's output: where the letters stand, for the dialog's
 * distance manipulator along the face's normal and for later features.
 */
export interface EmbossOutputData {
  /** Area centroid of the embossed profiles, in world mm. */
  origin: Vec3;
  /** Unit direction the letters grow in: the face's outward normal, or against it for a deboss. */
  direction: Vec3;
  /** The depth in mm. */
  depth: number;
  /** The body the face belongs to: the only one the feature touches. */
  body: BodyId;
}

export const kernelEmboss: KernelFeatureDefinition<EmbossInputs> = {
  ...embossFeature,
  bodyAccess: () => 'write',
  evaluate: evaluateEmboss,
};

function evaluateEmboss(ctx: EvalContext<EmbossInputs>): FeatureOutput {
  const settings = embossSettings(ctx.inputs);
  if (settings.profiles.length === 0) {
    throw new KernelError('Pick at least one profile or text to emboss.');
  }
  if (!settings.face) throw new KernelError('Pick the face to emboss on.');
  const depth = settings.depth ? ctx.value('depth') : EMBOSS_DEFAULT_DEPTH;
  if (!(depth > EPS)) throw new KernelError('The depth must be greater than 0.');

  const hit = ctx.resolve(settings.face, { label: 'the face to emboss on' });
  const { kernel } = ctx;
  const target = ctx.bodies.get(hit.body) as ShapeHandle;

  using scope = kernel.scope();
  const parts = partsOf(ctx, scope, settings.profiles, WORDS.noun);
  if (parts.length === 0) throw new KernelError('Pick at least one profile or text to emboss.');
  // A cylinder wraps (ADR-0060 §3); anything else has to be flat.
  // The third argument names the feature in a mesh refusal (ADR-0066 §4).
  const round = kernel.threadFace(hit.shape, hit.index, 'Emboss');
  // Each branch leaves its tool tracked by `scope` exactly once.
  const { tool, data } = round
    ? wrappedTool(ctx, scope, parts, hit, round, settings.mode, depth)
    : flatTool(ctx, scope, parts, hit, settings.mode, depth);
  // A join of two solids that miss each other would leave a second body, and a
  // cut that removes nothing would only say so in its own words: one message
  // for both, and the exact distance is cheap for one tool and one body.
  if (kernel.distance(target, tool.shape) > TOUCH) {
    throw new KernelError("The profiles don't touch the face.");
  }
  return {
    ...splitSolids(
      ctx,
      scope,
      operate(
        ctx,
        scope,
        { operation: settings.mode === 'emboss' ? 'join' : 'cut', bodies: [] },
        tool,
        [hit.body],
        [],
        WORDS,
      ),
    ),
    data,
  };
}

/** The tool of an emboss on a **flat** face (ADR-0060 §2), and where it stands. */
function flatTool(
  ctx: EvalContext,
  scope: ShapeScope,
  parts: Base[],
  hit: ResolvedRef,
  mode: EmbossMode,
  depth: number,
): { tool: NamedShape; data: EmbossOutputData } {
  const face = flatFaceOf(ctx, hit);
  for (const part of parts) {
    if (!parallel(part.plane, face)) {
      throw new KernelError('Sketch on a plane parallel to the face to emboss on a flat face.');
    }
  }
  const base = uniteParts(ctx, scope, parts);
  const along = mode === 'emboss' ? face.normal : scale(face.normal, -1);

  // The source onto the face's plane, then out along (or against) its normal.
  const moved = moveOnto(ctx, scope, base, face);
  const tool = namedPrism(ctx.kernel, {
    feature: ctx.feature.id,
    op: WORDS.noun,
    shape: moved.shape,
    edgeSources: edgeSourcesOf(ctx, moved, base.source),
    vector: scale(along, depth),
  });
  scope.track(tool.shape);
  return {
    tool,
    data: { origin: centroidOf(ctx, moved.shape), direction: along, depth, body: hit.body },
  };
}

/**
 * The tool of an emboss on a **cylindrical** face (ADR-0060 §3), and where it
 * stands: every part's face wrapped round the cylinder in the unrolled frame
 * of the sketches' plane, fused into one tool.
 */
function wrappedTool(
  ctx: EvalContext,
  scope: ShapeScope,
  parts: Base[],
  hit: ResolvedRef,
  round: ThreadFace,
  mode: EmbossMode,
  depth: number,
): { tool: NamedShape; data: EmbossOutputData } {
  const frame = wrapFrameOf(round, parts);
  // A boss's wall looks away from the axis and a hole's wall towards it: the
  // letters stand out of the face for an emboss and go into it for a deboss,
  // which is the other way round for a hole.
  const convex = !round.inside;
  const outward = mode === 'emboss' ? convex : !convex;
  const wrapped = parts.map((part) => {
    const tool = namedWrap(ctx.kernel, {
      feature: ctx.feature.id,
      op: WORDS.noun,
      shape: part.source.shape,
      edgeSources: part.source.edgeSources,
      frame,
      depth,
      outward,
    });
    scope.track(tool.shape);
    return tool;
  });
  // `mergeTools` hands back one of its parts when there is only one and a
  // shape it made otherwise, tracked in `scope` either way.
  const tool = mergeTools(ctx, scope, wrapped, WORDS.noun);
  const centre = wrappedCentre(ctx, parts, frame);
  return {
    tool,
    data: {
      origin: centre,
      direction: scale(radialAt(frame, centre), outward ? 1 : -1),
      depth,
      body: hit.body,
    },
  };
}

/**
 * The unrolled frame the wrap maps the sketches' plane through (ADR-0060 §3):
 * `s` along `across` from `corner` (where the axis's own normal through the
 * sketch plane meets it) and `z` along the axis, so a sketch point lands on the
 * cylinder at angle `s / radius` from `reference`, which points from the axis
 * towards the sketch. The sketches' plane has to run **along** the axis.
 */
function wrapFrameOf(round: ThreadFace, parts: Base[]): WrapFrame {
  const axis = unit(round.axis.direction);
  const centre = round.axis.origin;
  const first = parts[0] as Base;
  for (const part of parts) {
    if (Math.abs(dot(part.plane.normal, axis)) >= AXIS_TOLERANCE) {
      throw new KernelError(
        "Sketch on a plane parallel to the cylinder's axis to emboss on a round face.",
      );
    }
  }
  const normal = unit(first.plane.normal);
  const reference = dot(sub(first.plane.point, centre), normal) >= 0 ? normal : scale(normal, -1);
  return {
    origin: centre,
    axis,
    reference,
    radius: round.radius,
    corner: add(centre, scale(reference, dot(sub(first.plane.point, centre), reference))),
    across: cross(axis, reference),
  };
}

/** A point of the sketch plane where the wrap puts it: on the cylinder, same angle and height. */
function onCylinder(frame: WrapFrame, point: Vec3): Vec3 {
  const along = sub(point, frame.corner);
  const angle = dot(along, frame.across) / frame.radius;
  return add(
    frame.origin,
    add(
      add(
        scale(frame.reference, frame.radius * Math.cos(angle)),
        scale(frame.across, frame.radius * Math.sin(angle)),
      ),
      scale(frame.axis, dot(along, frame.axis)),
    ),
  );
}

/** The unit direction from the axis towards a point of the cylinder (its radius there). */
function radialAt(frame: WrapFrame, point: Vec3): Vec3 {
  const from = sub(point, frame.origin);
  return unit(sub(from, scale(frame.axis, dot(from, frame.axis))));
}

/**
 * The profiles' area centroid where the wrap puts it, on the cylinder: the
 * dialog's depth arrow stands there (a cylinder's own centre is the axis, which
 * is nowhere near the letters).
 */
function wrappedCentre(ctx: EvalContext, parts: readonly Base[], frame: WrapFrame): Vec3 {
  let area = 0;
  let sum: Vec3 = [0, 0, 0];
  for (const part of parts) {
    for (const face of ctx.kernel.describe(part.source.shape).faces) {
      area += face.area;
      sum = add(sum, scale(onCylinder(frame, face.centroid), face.area));
    }
  }
  const first = parts[0] as Base;
  return area > 0 ? scale(sum, 1 / area) : onCylinder(frame, centroidOf(ctx, first.source.shape));
}

/**
 * The flat face to emboss on as a plane with its **outward** normal:
 * `surfaceGeometry` gives a plane's normal reversed for a reversed face, so it
 * points out of the body (the same thing `describe` reports as a plane face's
 * `direction`). A cylinder went down the wrap branch; anything else that is
 * neither (a cone, a sphere, a torus) is refused.
 */
function flatFaceOf(ctx: EvalContext, hit: ResolvedRef): Plane {
  const surface = ctx.kernel.surfaceGeometry(hit.shape, hit.index);
  if (surface.type !== 'plane' || !surface.origin || !surface.direction) {
    throw new KernelError('Emboss works on flat and cylindrical faces.');
  }
  return { point: surface.origin, normal: surface.direction };
}

/** Whether two planes are parallel (either way round), however far apart. */
function parallel(a: Plane, b: Plane): boolean {
  return Math.abs(Math.abs(dot(a.normal, b.normal)) - 1) <= PARALLEL_TOLERANCE;
}

/**
 * The united source moved onto the face's plane by a translation along the
 * face's normal (the signed distance between the two parallel planes). The
 * result belongs to `scope`.
 */
function moveOnto(ctx: EvalContext, scope: ShapeScope, base: Base, face: Plane): OperationResult {
  const shift = scale(face.normal, dot(sub(face.point, base.plane.point), face.normal));
  return scope.track(ctx.kernel.transform(base.source.shape, translation(shift)));
}

/** The moved shape's edges' sources, from the move's history (input 0 = the source). */
function edgeSourcesOf(
  ctx: EvalContext,
  result: OperationResult,
  source: SweepSource,
): (string | null)[] {
  const out: (string | null)[] = Array.from(
    { length: ctx.kernel.count(result.shape, 'edge') },
    () => null,
  );
  for (const record of result.history) {
    if (record.input !== 0 || record.from.kind !== 'edge') continue;
    if (record.relation !== 'modified' && record.relation !== 'kept') continue;
    const name = source.edgeSources[record.from.index] ?? null;
    if (name === null) continue;
    for (const to of record.to) if (to.kind === 'edge') out[to.index] = name;
  }
  return out;
}
