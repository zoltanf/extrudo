import {
  BOX_ROTATION,
  type BoxInputs,
  boxFeature,
  type CylinderInputs,
  cylinderFeature,
  type FeatureDefinition,
  faceSketchFrame,
  type GeomRef,
  originPlane,
  type PrimitiveInputs,
  type PrimitiveSettings,
  type PrimitiveType,
  primitiveNumbers,
  primitiveSettings,
  type SketchFrame,
  type SphereInputs,
  sphereFeature,
  type TorusInputs,
  torusFeature,
} from '@extrudo/core';
import { PROFILE_TOLERANCE } from '@extrudo/sketch/profiles';
import { KernelError, MeshBodyError, meshBodyMessage, type ShapeScope, type Vec3 } from '../kernel';
import { type NamedShape, namedPrism, namedRevolve } from '../naming/ops';
import { LostReferenceError } from '../naming/resolve';
import type { PlanarCurve, PlanarFrame } from '../planar';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';
import { splitSolids } from './bodies';
import { explicitBodies, type OperationWords, operate } from './operation';
import { planeOf } from './references';
import { add, cross, scale, unit } from './vec';

/**
 * The `data` of a primitive's output: where it sits and how big it is, for
 * later features and the tests (the dialog places its arrows on the UI
 * thread from the plane, as extrude's are).
 */
export interface PrimitiveOutputData {
  /**
   * The primitive's own frame: `origin` is the centre of its base (a
   * sphere's or torus's centre) on the plane, lifted by the offset; `x` is
   * the plane frame's X (turned by a box's rotation), `y` = `normal` × `x`,
   * `normal` the plane's (a face's outward normal).
   */
  frame: SketchFrame;
  /** Every number input's value (mm, degrees), defaults filled in, by input name. */
  numbers: Record<string, number>;
}

/** Lengths (mm) at or below which a size is none. */
const LENGTH_EPS = 1e-6;

type Numbers = Record<string, number>;

/** How each primitive makes its solid, named (ADR-0005), in its frame. */
type Build = (ctx: EvalContext, scope: ShapeScope, frame: SketchFrame, n: Numbers) => NamedShape;

/**
 * A primitive's kernel definition (P2-10, ADR-0032): the placement frame,
 * the numbers checked, the solid built from a planar face swept by the
 * existing named operations (a box and a cylinder are prisms of a
 * rectangle and a disc, a sphere and a torus revolutions of a half disc
 * and a circle), then the body operations shared with extrude and revolve.
 */
function primitive<I extends PrimitiveInputs>(
  feature: FeatureDefinition<I>,
  build: Build,
): KernelFeatureDefinition<I> {
  const type = feature.type as PrimitiveType;
  const words: OperationWords = {
    noun: feature.label.toLowerCase(),
    check: 'Check its size and where it sits.',
  };
  return {
    ...feature,
    bodyAccess: () => 'write',
    evaluate(ctx): FeatureOutput {
      const settings = primitiveSettings(ctx.inputs);
      const numbers = numbersOf(ctx, type, settings);
      const frame = placement(ctx, settings, numbers, words.noun);
      using scope = ctx.kernel.scope();
      const tool = build(ctx, scope, frame, numbers);
      const participants = explicitBodies(ctx, settings, words);
      const warnings: string[] = [];
      const result = splitSolids(
        ctx,
        scope,
        operate(ctx, scope, settings, tool, participants, warnings, words),
      );
      const data: PrimitiveOutputData = { frame, numbers };
      return { ...result, data, ...(warnings.length ? { warnings } : {}) };
    },
  };
}

/** Every number of the primitive: its input's value, or the default; sizes checked. */
function numbersOf(ctx: EvalContext, type: PrimitiveType, settings: PrimitiveSettings): Numbers {
  const out: Numbers = {};
  for (const number of primitiveNumbers(type)) {
    const value = settings.exprs.has(number.name) ? ctx.value(number.name) : number.value;
    const label = number.label.toLowerCase();
    if (number.positive && !(value > LENGTH_EPS)) {
      throw new KernelError(`The ${label} must be greater than 0.`);
    }
    if (number.name === 'height' && Math.abs(value) <= LENGTH_EPS) {
      throw new KernelError('The height is 0. Enter a height other than 0.');
    }
    out[number.name] = value;
  }
  return out;
}

/**
 * The primitive's frame: its plane's (an origin plane's, or a flat face's
 * as a sketch on it gets it, `faceSketchFrame`, resolved through
 * topological naming so it follows the face), moved to (x, y) in it and
 * off it by the offset, and for a box turned about the normal.
 */
function placement(ctx: EvalContext, settings: PrimitiveSettings, n: Numbers, noun: string) {
  const plane = planeFrame(ctx, settings.plane, noun);
  const turn = ((n[BOX_ROTATION.name] ?? 0) * Math.PI) / 180;
  const x = unit(add(scale(plane.x, Math.cos(turn)), scale(plane.y, Math.sin(turn))));
  const origin = add(
    add(plane.origin, scale(plane.x, n.x ?? 0)),
    add(scale(plane.y, n.y ?? 0), scale(plane.normal, n.offset ?? 0)),
  );
  return { origin, x, y: cross(plane.normal, x), normal: plane.normal } satisfies SketchFrame;
}

/** A feature's noun as a message starts it ("the hole", "the box"). */
const capital = (noun: string) => noun.charAt(0).toUpperCase() + noun.slice(1);

/** The frame of the plane or flat face a feature sits on (the hole shares it). */
export function planeFrame(ctx: EvalContext, ref: GeomRef, noun: string): SketchFrame {
  if (ref.kind === 'face') {
    const hit = ctx.resolve(ref, { label: `the face the ${noun} sits on` });
    // A mesh body's one face is its whole surface of triangles, not a flat face
    // to sit something on (ADR-0066 §3).
    if (ctx.kernel.isMesh(hit.shape)) throw new MeshBodyError(meshBodyMessage(capital(noun)));
    const face = ctx.describe(hit.shape).faces[hit.index];
    if (face?.type !== 'plane' || !face.direction) {
      throw new KernelError(
        `The face the ${noun} sits on isn't flat. Edit the ${noun} and pick a flat face or a plane.`,
      );
    }
    return faceSketchFrame(face.centroid, face.direction);
  }
  const origin = ref.kind === 'plane' ? originPlane(ref.id)?.frame : undefined;
  if (origin) return origin;
  // A construction plane (P3-05).
  const lost = `Can't find the plane the ${noun} sits on. Edit the ${noun} and pick another.`;
  if (ref.kind === 'plane') return planeOf(ctx, ref, `the plane the ${noun} sits on`, lost).frame;
  throw new LostReferenceError(lost, ref);
}

// ------------------------------------------------------------------ the solids

/**
 * The one face between `curves` in `frame`, with each edge's source from
 * `sources` (by curve), tracked in the scope.
 */
export function planarFace(
  ctx: EvalContext,
  scope: ShapeScope,
  curves: readonly PlanarCurve[],
  frame: PlanarFrame,
  sources: readonly string[],
) {
  const { faces } = ctx.kernel.planarFaces(curves, frame, PROFILE_TOLERANCE);
  for (const face of faces) scope.track(face.shape);
  const face = faces[0];
  if (faces.length !== 1 || !face) throw new KernelError(`Couldn't make the ${ctx.feature.type}.`);
  return { shape: face.shape, edgeSources: face.edges.map((c) => sources[c] ?? null) };
}

/** The frame's plane as `planarFaces` takes it. */
const flat = (frame: SketchFrame): PlanarFrame => ({
  origin: frame.origin,
  x: frame.x,
  normal: frame.normal,
});

/**
 * The half-plane through the frame's normal, on its +X side, as a planar
 * frame whose 2D (u, v) is `origin + u·x + v·normal`: what a sphere and a
 * torus revolve about the normal.
 */
export const upright = (frame: SketchFrame): PlanarFrame => ({
  origin: frame.origin,
  x: frame.x,
  normal: scale(frame.y, -1),
});

/**
 * A box: a rectangle centred on the frame's origin, swept along the normal
 * by the height. Faces `box:<id>:cap:start` (on the plane), `cap:end`, and
 * `side:front|right|back|left` (the frame's −Y, +X, +Y and −X sides).
 */
const buildBox: Build = (ctx, scope, frame, n) => {
  const a = (n.length ?? 0) / 2;
  const b = (n.width ?? 0) / 2;
  const face = planarFace(
    ctx,
    scope,
    [
      { kind: 'line', a: [-a, -b], b: [a, -b] },
      { kind: 'line', a: [a, -b], b: [a, b] },
      { kind: 'line', a: [a, b], b: [-a, b] },
      { kind: 'line', a: [-a, b], b: [-a, -b] },
    ],
    flat(frame),
    ['front', 'right', 'back', 'left'],
  );
  return prism(ctx, scope, face, frame.normal, n.height ?? 0);
};

/**
 * A cylinder: a disc centred on the frame's origin, swept along the normal.
 * Faces `cylinder:<id>:cap:start`, `cap:end` and `side:wall`.
 */
const buildCylinder: Build = (ctx, scope, frame, n) => {
  const face = planarFace(ctx, scope, [circle([0, 0], (n.diameter ?? 0) / 2)], flat(frame), [
    'wall',
  ]);
  return prism(ctx, scope, face, frame.normal, n.height ?? 0);
};

/**
 * A sphere: a half disc beside the normal through the centre, turned a
 * whole turn about it. One face, `sphere:<id>:side:surface`; the poles lie
 * on the normal.
 */
const buildSphere: Build = (ctx, scope, frame, n) => {
  const r = (n.diameter ?? 0) / 2;
  const face = planarFace(
    ctx,
    scope,
    [
      { kind: 'arc', center: [0, 0], radius: r, from: -Math.PI / 2, sweep: Math.PI },
      { kind: 'line', a: [0, r], b: [0, -r] },
    ],
    upright(frame),
    ['surface', 'pole'],
  );
  return turn(ctx, scope, face, frame);
};

/**
 * A torus: a circle of the tube's diameter, its centre half the diameter
 * out along X, turned a whole turn about the normal. One face,
 * `torus:<id>:side:surface`.
 */
const buildTorus: Build = (ctx, scope, frame, n) => {
  const big = (n.diameter ?? 0) / 2;
  const small = (n.tube ?? 0) / 2;
  if (small >= big - LENGTH_EPS) {
    throw new KernelError(
      'The tube is as thick as the torus: make the tube diameter smaller than the diameter.',
    );
  }
  const face = planarFace(ctx, scope, [circle([big, 0], small)], upright(frame), ['surface']);
  return turn(ctx, scope, face, frame);
};

export const circle = (center: readonly [number, number], radius: number): PlanarCurve => ({
  kind: 'arc',
  center,
  radius,
  from: 0,
  sweep: 2 * Math.PI,
});

function prism(
  ctx: EvalContext,
  scope: ShapeScope,
  face: { shape: NamedShape['shape']; edgeSources: (string | null)[] },
  normal: Vec3,
  height: number,
): NamedShape {
  const tool = namedPrism(ctx.kernel, {
    feature: ctx.feature.id,
    op: ctx.feature.type,
    ...face,
    vector: scale(normal, height),
  });
  scope.track(tool.shape);
  return tool;
}

function turn(
  ctx: EvalContext,
  scope: ShapeScope,
  face: { shape: NamedShape['shape']; edgeSources: (string | null)[] },
  frame: SketchFrame,
): NamedShape {
  const tool = namedRevolve(ctx.kernel, {
    feature: ctx.feature.id,
    op: ctx.feature.type,
    ...face,
    axis: { origin: frame.origin, direction: frame.normal },
    angle: 2 * Math.PI,
  });
  scope.track(tool.shape);
  return tool;
}

export const kernelBox = primitive<BoxInputs>(boxFeature, buildBox);
export const kernelCylinder = primitive<CylinderInputs>(cylinderFeature, buildCylinder);
export const kernelSphere = primitive<SphereInputs>(sphereFeature, buildSphere);
export const kernelTorus = primitive<TorusInputs>(torusFeature, buildTorus);

/** The four primitives' kernel definitions. */
export const KERNEL_PRIMITIVES = [kernelBox, kernelCylinder, kernelSphere, kernelTorus] as const;
