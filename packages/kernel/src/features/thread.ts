/**
 * The thread feature in the kernel (P4-02, ADR-0056, FR-FT-15): a modeled
 * ISO 68-1 thread cut into each picked cylindrical face.
 *
 * Per face, in the half-plane through the face's axis (u from the axis, v
 * along it), the evaluator builds a cut tool:
 *
 * - the **ring**: the band between the thread's root radius and just past
 *   the face (a shaft), or from just inside the face to the root (a hole),
 *   over the thread's length, turned a whole turn (`namedRevolve`);
 * - the **tooth**: the part's thread tooth (crest flat, two 60° flanks, a
 *   foot reaching past the root so the booleans cut cleanly), swept along
 *   the helix by the facade's `threadSweep` (`namedThreadSweep`) from a
 *   pitch before the thread to a pitch after it;
 * - **lead-ins**: at an open end of the face (`Kernel.threadFace`'s `open`:
 *   a shaft's end, a hole's mouth) the tooth is cut back by a 45° cone, so
 *   the first turn grows out of the end instead of starting as a sliver;
 * - the tool is ring − tooth: cut from the body (`operate`), it leaves the
 *   tooth standing and takes the rest of the band away.
 *
 * Faces: `thread:<id>:side:<source>`, sources `f<k>.root`, `f<k>.flank0`,
 * `f<k>.crest`, `f<k>.flank1` (one per turn, `#n`), `f<k>.end0|end1` (the
 * flat steps where a thread stops inside a face), `f<k>.lead0|lead1` (the
 * lead-in cones), where k is the face's place in the input (`f0`, `f1` …).
 */
import {
  autoThread,
  type BodyId,
  THREAD_DEFAULTS,
  type ThreadInputs,
  type ThreadRadii,
  type ThreadSettings,
  threadFeature,
  threadPresetOf,
  threadRadii,
  threadSettings,
} from '@extrudo/core';
import { type Axis, KernelError, type ShapeScope, type ThreadFace, type Vec3 } from '../kernel';
import { type NamedShape, namedBoolean, namedRevolve, namedThreadSweep } from '../naming/ops';
import type { PlanarCurve, PlanarFrame } from '../planar';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';
import { splitSolids } from './bodies';
import { type OperationWords, operate } from './operation';
import { mergeTools } from './pattern';
import { planarFace } from './primitives';
import { cross, dot, scale } from './vec';

/**
 * Most turns one thread may have. 150 is about 15 s of booleans (ADR-0056's
 * 0.1 s a turn); above ~400 turns OCCT's ring − tooth boolean corrupts the
 * WASM heap instead of failing, found by benchmark B9's fuzzing (ADR-0039's
 * B9 amendment), so a long thread is refused rather than trapped.
 */
export const MAX_TURNS = 150;

const EPS = 1e-6;

const WORDS: OperationWords = {
  noun: 'thread',
  check: 'Check the face, the size and the length.',
};

/** Every number of a thread (mm), by input name. */
export interface ThreadNumbers {
  diameter: number;
  pitch: number;
  length: number;
  offset: number;
  tolerance: number;
}

/** One threaded face, as the output's `data` lists it. */
export interface ThreadOutputFace {
  internal: boolean;
  /** Nominal (major) diameter and pitch, mm. */
  diameter: number;
  pitch: number;
  /** "M8", "1/4-20 UNC", or "Ø8 × 1.25" for a custom size. */
  designation: string;
  /** The face's diameter. */
  face: number;
  /** Where the thread runs along the face's axis (from its origin), mm. */
  from: number;
  to: number;
  turns: number;
  /** Whether each end got a lead-in. */
  lead: [boolean, boolean];
}

/** The `data` of a thread's output. */
export interface ThreadOutputData {
  faces: ThreadOutputFace[];
}

export const kernelThread: KernelFeatureDefinition<ThreadInputs> = {
  ...threadFeature,
  bodyAccess: () => 'write',
  evaluate(ctx): FeatureOutput {
    const settings = threadSettings(ctx.inputs);
    const numbers = numbersOf(ctx, settings);
    const warnings: string[] = [];
    using scope = ctx.kernel.scope();
    const parts: NamedShape[] = [];
    const bodies = new Set<BodyId>();
    const faces: ThreadOutputFace[] = [];
    settings.faces.forEach((ref, k) => {
      const hit = ctx.resolve(ref, { label: 'the face to thread' });
      const face = ctx.kernel.threadFace(hit.shape, hit.index);
      const plan = planThread(face, settings, numbers, warnings);
      parts.push(buildTool(ctx, scope, plan, `f${k}.`));
      bodies.add(hit.body);
      faces.push(plan.report);
    });
    const tool = mergeTools(ctx, scope, parts, 'thread');
    const result = splitSolids(
      ctx,
      scope,
      operate(ctx, scope, { operation: 'cut', bodies: [] }, tool, [...bodies], warnings, WORDS),
    );
    const data: ThreadOutputData = { faces };
    return { ...result, data, ...(warnings.length > 0 && { warnings }) };
  },
};

// ------------------------------------------------------------------ numbers

function numbersOf(ctx: EvalContext, settings: ThreadSettings): ThreadNumbers {
  const get = (name: keyof ThreadNumbers) =>
    settings.exprs.has(name) ? ctx.value(name) : (THREAD_DEFAULTS[name] as number);
  const n: ThreadNumbers = {
    diameter: get('diameter'),
    pitch: get('pitch'),
    length: get('length'),
    offset: get('offset'),
    tolerance: get('tolerance'),
  };
  if (!settings.auto) {
    if (!(n.diameter > EPS)) throw new KernelError('The diameter must be greater than 0.');
    if (!(n.pitch > EPS)) throw new KernelError('The pitch must be greater than 0.');
  }
  if (settings.extent === 'length' && !(n.length > EPS)) {
    throw new KernelError('The length must be greater than 0.');
  }
  if (!(n.offset >= 0)) throw new KernelError("The offset can't be negative.");
  if (!(n.tolerance >= 0)) throw new KernelError("The tolerance can't be negative.");
  return n;
}

const round = (value: number) => Math.round(value * 1000) / 1000;
const mm = (value: number) => `${round(value)} mm`;

export function designation(diameter: number, pitch: number): string {
  return threadPresetOf(diameter, pitch)?.label ?? `Ø${round(diameter)} × ${round(pitch)}`;
}

// --------------------------------------------------------------- planning

/** One thread, worked out: where it runs and its radii. */
export interface ThreadPlan {
  axis: Axis;
  /** A unit vector square to the axis: the half-plane the sections are drawn in. */
  x: Vec3;
  internal: boolean;
  pitch: number;
  radii: ThreadRadii;
  /** The face's radius. */
  radius: number;
  /** The thread's run along the axis, from `axis.origin`. */
  from: number;
  to: number;
  /** A lead-in at `from` / `to`. */
  lead: [boolean, boolean];
  left: boolean;
  report: ThreadOutputFace;
}

/** Checks the face and the numbers and works out one face's thread. */
export function planThread(
  face: ThreadFace | undefined,
  settings: ThreadSettings,
  n: ThreadNumbers,
  warnings: string[],
): ThreadPlan {
  if (!face) {
    throw new KernelError(
      "The face to thread isn't cylindrical. Edit the thread and pick the round face of a shaft or a hole.",
    );
  }
  if (!face.whole) {
    throw new KernelError(
      'The face to thread goes only part of the way round. Pick a face that goes all the way round.',
    );
  }
  const internal = face.inside;
  const what = internal ? 'hole' : 'shaft';
  let { diameter, pitch } = n;
  if (settings.auto) {
    const preset = autoThread(face.radius, internal);
    if (!preset) {
      throw new KernelError(
        `No standard metric thread fits this ${mm(2 * face.radius)} ${what}. Set the diameter and pitch.`,
      );
    }
    diameter = preset.diameter;
    pitch = preset.pitch;
  }
  const radii = threadRadii(diameter, pitch, n.tolerance, internal);
  const name = designation(diameter, pitch);
  const r = face.radius;
  if (internal) {
    if (r >= radii.root - EPS) {
      throw new KernelError(
        `The hole is ${mm(2 * r)} across, as wide as the ${name} thread (${mm(2 * radii.root)} with the tolerance). Pick a larger thread or a smaller hole.`,
      );
    }
    if (r < radii.crest * 0.5) {
      warnings.push(
        `The hole is ${mm(2 * r)} across, much smaller than the ${name} thread: the thread bores it out to ${mm(2 * radii.crest)}.`,
      );
    }
  } else {
    if (r <= radii.root + EPS) {
      throw new KernelError(
        `The shaft is ${mm(2 * r)} across, thinner than the ${name} thread's root (${mm(2 * radii.root)}). Pick a smaller thread or a thicker shaft.`,
      );
    }
    if (r > radii.crest + Math.max(0.5, 0.25 * diameter)) {
      warnings.push(
        `The shaft is ${mm(2 * r)} across, much thicker than the ${name} thread: the thread turns it down to ${mm(2 * radii.crest)}.`,
      );
    }
  }
  const span = face.to - face.from;
  const start = n.offset;
  const length = settings.extent === 'full' ? span - start : n.length;
  if (start >= span - EPS) {
    throw new KernelError(
      `The offset (${mm(start)}) is as long as the face (${mm(span)}). Make it shorter.`,
    );
  }
  if (start + length > span + EPS) {
    throw new KernelError(
      `The thread runs ${mm(start + length)} from the face's end, but the face is only ${mm(span)} long. Make it shorter or reduce the offset.`,
    );
  }
  if (length < pitch - EPS) {
    throw new KernelError(
      `The thread is ${mm(length)} long, shorter than one turn (${mm(pitch)}). Make it longer.`,
    );
  }
  const turns = length / pitch;
  if (turns > MAX_TURNS) {
    throw new KernelError(
      `The thread would have ${Math.ceil(turns)} turns; up to ${MAX_TURNS} can be modeled. Make it shorter or the pitch larger.`,
    );
  }
  // Measured from the face's lower end along its axis, or (flip) its upper end.
  const from = settings.flip ? face.to - start - length : face.from + start;
  const to = from + length;
  const atFrom = Math.abs(from - face.from) < EPS && face.open[0];
  const atTo = Math.abs(to - face.to) < EPS && face.open[1];
  const lead: [boolean, boolean] = [settings.chamfer && atFrom, settings.chamfer && atTo];
  return {
    axis: face.axis,
    x: squareTo(face.axis.direction),
    internal,
    pitch,
    radii,
    radius: r,
    from,
    to,
    lead,
    left: settings.hand === 'left',
    report: {
      internal,
      diameter,
      pitch,
      designation: name,
      face: 2 * r,
      from,
      to,
      turns,
      lead,
    },
  };
}

/** A unit vector square to `d`. */
function squareTo(d: Vec3): Vec3 {
  const helper: Vec3 = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const v = cross(d, helper);
  return scale(v, 1 / Math.sqrt(dot(v, v)));
}

// ------------------------------------------------------------------ sections

/** A closed polygon in the (u, v) half-plane and each side's source (side i runs from vertex i). */
export interface Section {
  vertices: [number, number][];
  sources: string[];
}

/**
 * The tooth of the part (`internal` points inward), one tooth centred at
 * `v0` on the axis: crest flat, flanks at 30° to the radius out to a kink a
 * little past the root, then straight sides to the foot. The foot stays
 * clear of the neighbouring turn (`pitch` along the axis).
 */
export function toothSection(
  plan: Pick<ThreadPlan, 'internal' | 'pitch' | 'radii'>,
  v0: number,
): Section {
  const { internal, pitch, radii } = plan;
  const tan30 = Math.tan(Math.PI / 6);
  const s = internal ? 1 : -1; // from the crest towards the root, in u
  const kink = radii.root + s * 0.05 * pitch;
  const foot = radii.root + s * 0.25 * pitch;
  const half = radii.crestHalf + Math.abs(kink - radii.crest) * tan30;
  return {
    vertices: [
      [foot, v0 - half],
      [kink, v0 - half],
      [radii.crest, v0 - radii.crestHalf],
      [radii.crest, v0 + radii.crestHalf],
      [kink, v0 + half],
      [foot, v0 + half],
    ],
    sources: ['side0', 'flank0', 'crest', 'flank1', 'side1', 'foot'],
  };
}

/** How far past the face and the crest the ring reaches. */
const reach = (plan: Pick<ThreadPlan, 'pitch'>) => 0.1 * plan.pitch + 0.05;

/** The band the tooth is cut from: root to just past the face (shaft) or from inside the face to the root (hole). */
export function ringSection(plan: ThreadPlan): Section {
  const { radii, internal, from, to } = plan;
  const far = internal
    ? Math.max(0, Math.min(plan.radius, radii.crest) - reach(plan))
    : Math.max(plan.radius, radii.crest) + reach(plan);
  return {
    vertices: [
      [radii.root, from],
      [far, from],
      [far, to],
      [radii.root, to],
    ],
    sources: ['end0', 'far', 'end1', 'root'],
  };
}

/**
 * The lead-in at end `end` (0: `from`, 1: `to`): the region outside a 45°
 * cone that meets the end plane just past the root, so the tooth is cut back
 * to nothing at the end; it reaches two pitches beyond the end.
 */
export function leadSection(plan: ThreadPlan, end: 0 | 1): Section {
  const { radii, internal, pitch } = plan;
  const s = internal ? 1 : -1; // towards the root
  const start = radii.root + s * 0.1 * pitch; // where the cone meets the end plane
  const crestSide = internal
    ? Math.max(0, radii.crest - reach(plan))
    : radii.crest + reach(plan) + Math.max(0, plan.radius - radii.crest);
  const rise = Math.abs(start - crestSide);
  const at = end === 0 ? plan.from : plan.to;
  const into = end === 0 ? 1 : -1; // along v into the thread
  const beyond = at - into * 2 * pitch;
  return {
    vertices: [
      [start, beyond],
      [start, at],
      [crestSide, at + into * rise],
      [crestSide, beyond],
    ],
    sources: [`lead${end}x`, `lead${end}`, `lead${end}y`, `lead${end}z`],
  };
}

// ------------------------------------------------------------------ solids

/** The half-plane frame: (u, v) = origin + u·x + v·axis. */
function halfPlane(plan: ThreadPlan): PlanarFrame {
  return {
    origin: plan.axis.origin,
    x: plan.x,
    normal: cross(plan.x, plan.axis.direction),
  };
}

function face(
  ctx: EvalContext,
  scope: ShapeScope,
  plan: ThreadPlan,
  section: Section,
  prefix: string,
) {
  const { vertices, sources } = section;
  const curves: PlanarCurve[] = vertices.map((a, i) => ({
    kind: 'line',
    a,
    b: vertices[(i + 1) % vertices.length] as [number, number],
  }));
  return planarFace(
    ctx,
    scope,
    curves,
    halfPlane(plan),
    sources.map((s) => `${prefix}${s}`),
  );
}

function revolved(
  ctx: EvalContext,
  scope: ShapeScope,
  plan: ThreadPlan,
  section: Section,
  prefix: string,
): NamedShape {
  const solid = namedRevolve(ctx.kernel, {
    feature: ctx.feature.id,
    op: 'thread',
    ...face(ctx, scope, plan, section, prefix),
    axis: plan.axis,
    angle: 2 * Math.PI,
  });
  scope.track(solid.shape);
  return solid;
}

/**
 * Turns of tooth cut out of the ring in one piece (P4-12, ADR-0067 §H2).
 *
 * A thread's boolean needs memory proportional to the faces it works on, and
 * OCCT's ring − tooth of a ~400-turn thread wants more than the 2 GB a WASM
 * module can grow to: it runs out of memory and unwinds through a null
 * virtual call, which traps the heap for every later feature (found natively
 * in `spikes/p4-12-threads`; bisected there). Cutting the tooth out in
 * pieces keeps each boolean's share of that memory flat, so a thread of any
 * length builds in pieces instead of trapping.
 *
 * It is `MAX_TURNS` plus the two pitches the tooth runs past the thread, so a
 * thread of as many turns as may be modeled is one piece and its cut is
 * exactly what it was; a longer one (a raised cap) would be cut in pieces of
 * `MAX_TURNS` turns, at about 0.35 s a turn instead of 0.1 s.
 */
export const THREAD_CHUNK = MAX_TURNS + 2;

/** The tooth's pieces: `turns` turns from `centre`, in pieces of `chunk`. */
export function toothPieces(
  turns: number,
  chunk = THREAD_CHUNK,
): { from: number; turns: number }[] {
  const out: { from: number; turns: number }[] = [];
  for (let done = 0; done < turns - 1e-9; ) {
    const count = Math.min(chunk, turns - done);
    out.push({ from: done, turns: count });
    done += count;
  }
  return out;
}

/**
 * The cut tool of one thread: ring − tooth (cut back by the lead-ins).
 *
 * The tooth is swept and cut out of the ring in pieces (`toothPieces`), each
 * released as soon as it has been cut, so that no single boolean works on a
 * whole thread's worth of faces.
 */
export function buildTool(
  ctx: EvalContext,
  scope: ShapeScope,
  plan: ThreadPlan,
  prefix: string,
): NamedShape {
  const { kernel } = ctx;
  const options = { feature: ctx.feature.id, op: 'thread', simplify: true };
  // The tooth runs from a pitch before the thread to a pitch after it. A
  // shaft's tooth is centred on `from` (a pitch before), a hole's half a pitch
  // on, so a screw and a nut whose threads start at the same plane mesh.
  const turns = (plan.to - plan.from) / plan.pitch + 2;
  const centre = plan.from - (plan.internal ? 0.5 : 1) * plan.pitch;
  // Both lead-ins in one cut: they are apart, so they go in as one compound.
  const leads = ([0, 1] as const)
    .filter((end) => plan.lead[end])
    .map((end) => revolved(ctx, scope, plan, leadSection(plan, end), prefix));
  const lead = leads.length > 0 ? mergeTools(ctx, scope, leads, 'thread') : undefined;
  if (lead) scope.track(lead.shape);

  const pieces = toothPieces(turns);
  let tool = revolved(ctx, scope, plan, ringSection(plan), prefix);
  pieces.forEach((piece, k) => {
    // Each piece starts where the last one ended, at `centre + from` pitches,
    // and is released with its own scope as soon as it has been cut out: the
    // running tool only ever meets one piece's worth of faces.
    using gone = ctx.kernel.scope();
    let tooth = namedThreadSweep(kernel, {
      feature: ctx.feature.id,
      ...face(ctx, scope, plan, toothSection(plan, centre + piece.from * plan.pitch), prefix),
      axis: plan.axis,
      pitch: plan.pitch,
      turns: piece.turns,
      left: plan.left,
    });
    gone.track(tooth.shape);
    // The lead-ins cut the first and the last piece's ends back.
    if (lead && (k === 0 || k === pieces.length - 1)) {
      tooth = namedBoolean(kernel, 'cut', tooth, lead, options);
      gone.track(tooth.shape);
    }
    tool = namedBoolean(kernel, 'cut', tool, tooth, options);
    scope.track(tool.shape);
  });
  return tool;
}
