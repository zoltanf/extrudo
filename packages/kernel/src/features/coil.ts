import {
  COIL_NUMBERS,
  COIL_TYPE_NUMBERS,
  type CoilInputs,
  type CoilSection,
  type CoilSettings,
  coilFeature,
  coilSectionExtent,
  coilSectionShift,
  coilSettings,
  coilTurns,
  MAX_COIL_TURNS,
  type SketchFrame,
} from '@extrudo/core';
import { KernelError, type ShapeScope } from '../kernel';
import type { NamedShape } from '../naming/ops';
import type { PlanarCurve } from '../planar';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';
import { splitSolids } from './bodies';
import { explicitBodies, type OperationWords, operate } from './operation';
import { circle, planarFace, planeFrame, upright } from './primitives';
import { sweepTool } from './sweep';
import { add, cross, scale, unit } from './vec';

/**
 * The `data` of a coil's output: where its helix runs, for later features
 * and the tests (the dialog places its handles on the UI thread).
 */
export interface CoilOutputData {
  /** The coil's frame: `origin` on the axis where the helix starts, `x` towards its start, `normal` the axis. */
  frame: SketchFrame;
  /** The helix's radius at the start, mm. */
  radius: number;
  turns: number;
  /** Rise per turn, mm. */
  pitch: number;
  /** Start to end along the axis, mm. */
  height: number;
}

/** Lengths (mm) at or below which a size is none. */
const LENGTH_EPS = 1e-6;

const WORDS: OperationWords = { noun: 'coil', check: 'Check its size and where it sits.' };

/**
 * A helix's shape and the section swept along it: what a coil builds and
 * what P4-02's modeled threads reuse with a thread profile as the section.
 */
export interface HelixSweep {
  /** `origin` on the axis where the helix starts, `x` towards the start point, `normal` the axis. */
  frame: SketchFrame;
  radius: number;
  pitch: number;
  turns: number;
  /** Radians; positive widens with height. */
  taper: number;
  /** Clockwise seen from the axis's tip. */
  left: boolean;
  /**
   * The section's curves in the plane through the axis and the start point:
   * (u, v) is `origin + u·x + v·normal`, so u is the distance from the axis
   * and v the height. One closed outline.
   */
  section: readonly PlanarCurve[];
  /** Each curve's role in the side faces' names (`coil:<id>:side:<role>`). */
  roles: readonly string[];
  /** Operation name in the faces' names; default the feature's type. */
  op?: string;
}

/**
 * A section swept along a helix, named (`<op>:<feature>:cap:start`,
 * `cap:end`, `side:<role>`): one sweep that keeps the section at its angle
 * to the axis. It doesn't check that the turns stay apart: callers do,
 * from their sizes, before OCCT runs (the self-intersection check is too
 * slow on long helices).
 */
export function helixSweep(ctx: EvalContext, scope: ShapeScope, spec: HelixSweep): NamedShape {
  const { frame } = spec;
  const face = planarFace(ctx, scope, spec.section, upright(frame), spec.roles);
  const helix = scope.track(
    ctx.kernel.helix({
      origin: frame.origin,
      axis: frame.normal,
      start: frame.x,
      radius: spec.radius,
      pitch: spec.pitch,
      turns: spec.turns,
      taper: spec.taper,
      left: spec.left,
    }),
  );
  return sweepTool(ctx, scope, face, helix, {
    orientation: { binormal: frame.normal },
    verify: false,
    op: spec.op ?? ctx.feature.type,
  });
}

/**
 * The coil feature in the kernel (P4-01, ADR-0055): a circle, square or
 * triangle swept along a helix placed like a primitive, then new bodies or
 * a join, cut or intersection like extrude. Faces are named (ADR-0005)
 * `coil:<id>:cap:start`, `cap:end` and `side:<role>` (`surface` for a
 * circle; `inner`, `outer`, `top`, `bottom` for a square; a triangle's
 * three sides by where they face).
 */
export const kernelCoil: KernelFeatureDefinition<CoilInputs> = {
  ...coilFeature,
  bodyAccess: () => 'write',
  evaluate(ctx): FeatureOutput {
    const settings = coilSettings(ctx.inputs);
    const n = numbersOf(ctx, settings);
    const shape = coilTurns(settings.type, {
      revolutions: n.revolutions as number,
      height: n.height as number,
      pitch: n.pitch as number,
    });
    if (!(shape.turns > LENGTH_EPS)) throw new KernelError('The coil needs more than 0 turns.');
    if (shape.turns > MAX_COIL_TURNS) {
      throw new KernelError(
        `The coil has ${Math.round(shape.turns)} turns; at most ${MAX_COIL_TURNS} are allowed.`,
      );
    }
    const size = n.size as number;
    const radius = (n.diameter as number) / 2;
    const taper = ((n.taper as number) * Math.PI) / 180;
    if (Math.abs(n.taper as number) >= 89) {
      throw new KernelError('The taper angle must be between -89° and 89°.');
    }
    const { along, across } = coilSectionExtent(settings.section, size);
    if (along >= shape.pitch - LENGTH_EPS) {
      throw new KernelError(
        `The section (${round(along)} mm) is as tall as the pitch (${round(shape.pitch)} mm) or taller, so the turns would run into each other. Make the section smaller or the pitch larger.`,
      );
    }
    const shift = coilSectionShift(settings.section, size, settings.position);
    const inner = (r: number) => r + shift - across / 2;
    const endRadius = radius + Math.tan(taper) * shape.height;
    if (inner(radius) <= LENGTH_EPS || inner(endRadius) <= LENGTH_EPS) {
      throw new KernelError(
        inner(radius) <= LENGTH_EPS
          ? 'The section reaches the coil’s axis. Make the diameter larger or the section smaller.'
          : 'The taper narrows the coil until its section reaches the axis. Make the taper smaller.',
      );
    }
    const frame = placement(ctx, settings, n);
    using scope = ctx.kernel.scope();
    const { section, roles } = coilSection(settings.section, radius + shift, size);
    const tool = helixSweep(ctx, scope, {
      frame,
      radius,
      pitch: shape.pitch,
      turns: shape.turns,
      taper,
      left: settings.direction === 'clockwise',
      section,
      roles,
    });
    const participants = explicitBodies(ctx, settings, WORDS);
    const warnings: string[] = [];
    const result = splitSolids(
      ctx,
      scope,
      operate(ctx, scope, settings, tool, participants, warnings, WORDS),
    );
    const data: CoilOutputData = { frame, radius, ...shape };
    return { ...result, data, ...(warnings.length ? { warnings } : {}) };
  },
};

const round = (value: number) => Math.round(value * 100) / 100;

/** Every number of the coil: its input's value, or the default; sizes checked. */
function numbersOf(ctx: EvalContext, settings: CoilSettings): Record<string, number> {
  const out: Record<string, number> = {};
  const used = new Set<string>(COIL_TYPE_NUMBERS[settings.type]);
  for (const number of COIL_NUMBERS) {
    const value = settings.exprs.has(number.name) ? ctx.value(number.name) : number.value;
    const relevant =
      !['revolutions', 'height', 'pitch'].includes(number.name) || used.has(number.name);
    if (relevant && number.positive && !(value > LENGTH_EPS)) {
      throw new KernelError(`The ${number.label.toLowerCase()} must be greater than 0.`);
    }
    out[number.name] = value;
  }
  return out;
}

/** The coil's frame: its plane's, moved to (x, y) in it and off it by the offset. */
function placement(ctx: EvalContext, settings: CoilSettings, n: Record<string, number>) {
  const plane = planeFrame(ctx, settings.plane, WORDS.noun);
  const origin = add(
    add(plane.origin, scale(plane.x, n.x ?? 0)),
    add(scale(plane.y, n.y ?? 0), scale(plane.normal, n.offset ?? 0)),
  );
  const x = unit(plane.x);
  return { origin, x, y: cross(plane.normal, x), normal: plane.normal } satisfies SketchFrame;
}

/**
 * A coil's section centred `centre` mm from the axis at the start height, in
 * the (distance from the axis, height) plane `helixSweep` takes, and the
 * role of each of its curves.
 */
export function coilSection(
  kind: CoilSection,
  centre: number,
  size: number,
): { section: PlanarCurve[]; roles: string[] } {
  const s = size / 2;
  if (kind === 'circle') return { section: [circle([centre, 0], s)], roles: ['surface'] };
  const line = (a: [number, number], b: [number, number]): PlanarCurve => ({ kind: 'line', a, b });
  if (kind === 'square') {
    const [u0, u1] = [centre - s, centre + s];
    return {
      section: [
        line([u0, -s], [u1, -s]),
        line([u1, -s], [u1, s]),
        line([u1, s], [u0, s]),
        line([u0, s], [u0, -s]),
      ],
      roles: ['bottom', 'outer', 'top', 'inner'],
    };
  }
  const h = coilSectionExtent(kind, size).across / 2;
  const [u0, u1] = [centre - h, centre + h];
  if (kind === 'triangle-out') {
    // The base on the inside, the point outwards.
    return {
      section: [line([u0, -s], [u1, 0]), line([u1, 0], [u0, s]), line([u0, s], [u0, -s])],
      roles: ['bottom', 'top', 'inner'],
    };
  }
  // The base on the outside, the point inwards.
  return {
    section: [line([u1, -s], [u1, s]), line([u1, s], [u0, 0]), line([u0, 0], [u1, -s])],
    roles: ['outer', 'top', 'bottom'],
  };
}
