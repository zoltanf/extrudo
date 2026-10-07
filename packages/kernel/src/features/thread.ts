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
 * **Starts** (P4-12, ADR-0056's second amendment): with `starts` above 1 the
 * helix's lead is `starts × pitch` and each piece has one tooth per start,
 * the same section a pitch higher (the same as turned by 360° / starts), the
 * teeth one compound cut in one boolean; their faces are `f<k>.s<j>.<role>`.
 *
 * **Tapers** (P4-12, ADR-0056's third amendment): on a conical face the
 * thread follows the cone. Every radius of the sections is a function of the
 * axial position (`shiftAt`): the radii `threadRadii` gives hold at the
 * face's small end (`ThreadPlan.anchor`, where NPT gives its diameter) and
 * move by `(v − anchor)·tan(taper)` along the axis, so the ring is the cone's
 * band, the lead-ins follow the slope and the tooth is placed with the radii
 * the cone has at its centre and swept along a conical helix. A tapered
 * preset (NPT) fits a cone of its taper without a size (`autoTaperThread`).
 *
 * Faces: `thread:<id>:side:<source>`, sources `f<k>.root`, `f<k>.flank0`,
 * `f<k>.crest`, `f<k>.flank1` (one per turn, `#n`), `f<k>.end0|end1` (the
 * flat steps where a thread stops inside a face), `f<k>.lead0|lead1` (the
 * lead-in cones), where k is the face's place in the input (`f0`, `f1` …).
 */
import {
  autoTaperThread,
  autoThread,
  type BodyId,
  NPT_TAPER,
  TAPER_SLACK,
  THREAD_DEFAULTS,
  type ThreadInputs,
  type ThreadLoadFlank,
  type ThreadProfileName,
  type ThreadRadii,
  type ThreadReport,
  type ThreadSettings,
  taperDegrees,
  threadFeature,
  threadPresetOf,
  threadProfile,
  threadRadii,
  threadSettings,
} from '@extrudo/core';
import { type Axis, KernelError, type ShapeScope, type ThreadFace, type Vec3 } from '../kernel';
import { type NamedShape, namedBoolean, namedRevolve, namedThreadSweep } from '../naming/ops';
import type { PlanarCurve, PlanarFrame } from '../planar';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';
import { splitSolids } from './bodies';
import { type OperationWords, operate } from './operation';
import { compoundOf, mergeTools } from './pattern';
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
  /** Helices round the face, 1 to `MAX_STARTS`; absent is 1. */
  starts?: number;
}

/** Most starts a thread may have (ADR-0056's second amendment). */
export const MAX_STARTS = 8;

/** One threaded face, as the output's `data` lists it. */
export interface ThreadOutputFace {
  internal: boolean;
  /** The tooth profile. */
  profile: ThreadProfileName;
  /** Nominal (major) diameter and pitch, mm. */
  diameter: number;
  pitch: number;
  /** Helices round the face, and the lead length (starts × pitch, mm; `lead` below is the lead-ins). */
  starts: number;
  leadLength: number;
  /**
   * "M8", "1/4-20 UNC", "NPT 1/2", or "Ø8 × 1.25" for a custom size (", taper
   * 1.8°" on a cone); ", 2 starts" with more than one.
   */
  designation: string;
  /** The face's diameter (at its small end on a cone). */
  face: number;
  /** A cone's half angle in degrees (P4-12), signed along the face's axis; 0 on a cylinder. */
  taper: number;
  /** Where the thread runs along the face's axis (from its origin), mm. */
  from: number;
  to: number;
  /** Turns of one helix (the thread's length over its lead). */
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
    const report: ThreadReport = {
      kind: 'thread',
      designations: faces.map((f) => f.designation),
    };
    return { ...result, data, report, ...(warnings.length > 0 && { warnings }) };
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
  if (settings.exprs.has('starts')) {
    const starts = ctx.value('starts');
    if (!Number.isInteger(starts) || starts < 1 || starts > MAX_STARTS) {
      throw new KernelError(`Starts must be a whole number from 1 to ${MAX_STARTS}.`);
    }
    n.starts = starts;
  }
  return n;
}

const round = (value: number) => Math.round(value * 1000) / 1000;
const mm = (value: number) => `${round(value)} mm`;

/**
 * A thread's name: its preset's label, else its size ("Ø20 × 1.5"). With a
 * `taper` (radians, P4-12) a preset must be made for that taper (NPT on its
 * cone) and a custom size says it: "Ø20 × 1.5, taper 1.8°".
 */
export function designation(
  diameter: number,
  pitch: number,
  profile: ThreadProfileName = 'iso',
  taper = 0,
): string {
  const preset = threadPresetOf(diameter, pitch, profile, taper);
  if (preset) return preset.label;
  const prefix =
    profile === 'iso'
      ? ''
      : `${profile === 'trapezoidal' ? 'Tr' : profile === 'buttress' ? 'S' : 'PCO'} `;
  const tapered = Math.abs(taper) > 1e-9 ? `, taper ${taperDegrees(taper)}` : '';
  return `${prefix}Ø${round(diameter)} × ${round(pitch)}${tapered}`;
}

// --------------------------------------------------------------- planning

/** One thread, worked out: where it runs and its radii. */
export interface ThreadPlan {
  axis: Axis;
  /** A unit vector square to the axis: the half-plane the sections are drawn in. */
  x: Vec3;
  internal: boolean;
  /** Crest to crest along the axis: the tooth's own pitch. */
  pitch: number;
  /** Helices round the face. */
  starts: number;
  /** How far one helix advances in a turn: `starts × pitch`. */
  leadLength: number;
  profile: ThreadProfileName;
  /** Buttress only: which side the steep load flank faces. */
  loadFlank: ThreadLoadFlank;
  /** The thread's radii at `anchor` (all of them, on a cylinder). */
  radii: ThreadRadii;
  /** The face's radius at `anchor`. */
  radius: number;
  /**
   * A cone's half angle (radians, P4-12), signed along the axis: every radius
   * moves by `(v − anchor)·tan(taper)` (`shiftAt`). 0 on a cylinder.
   */
  taper: number;
  /** Where along the axis the radii hold: the face's small end on a cone, `from` on a cylinder. */
  anchor: number;
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
  // A cone's radii hold at its small end (where NPT gives its diameter).
  const taper = Math.abs(face.taper ?? 0) > 1e-12 ? (face.taper ?? 0) : 0;
  const anchor = taper < 0 ? face.to : face.from;
  const r = face.radius + (anchor - face.from) * Math.tan(taper);
  let { diameter, pitch } = n;
  if (settings.auto) {
    if (settings.profile !== 'iso') {
      throw new KernelError(`Enter a diameter and pitch for a ${settings.profile} thread.`);
    }
    if (taper !== 0) {
      const preset = autoTaperThread(r, taper, internal);
      if (!preset) {
        throw new KernelError(
          Math.abs(Math.abs(taper) - NPT_TAPER) > TAPER_SLACK
            ? `Enter a diameter and pitch: this cone's taper (${taperDegrees(taper)}) isn't a pipe thread's.`
            : `No NPT thread fits this ${mm(2 * r)} ${what}. Set the diameter and pitch.`,
        );
      }
      diameter = preset.diameter;
      pitch = preset.pitch;
    } else {
      const preset = autoThread(r, internal);
      if (!preset) {
        throw new KernelError(
          `No standard metric thread fits this ${mm(2 * r)} ${what}. Set the diameter and pitch.`,
        );
      }
      diameter = preset.diameter;
      pitch = preset.pitch;
    }
  }
  const radii = threadRadii(settings.profile, diameter, pitch, n.tolerance, internal);
  const starts = n.starts ?? 1;
  const leadLength = starts * pitch;
  const name =
    designation(diameter, pitch, settings.profile, taper) +
    (starts > 1 ? `, ${starts} starts` : '');
  // A tapered preset on a face of another taper (a cylinder included) is still
  // cut with the face's taper: say so, naming both.
  const sized = threadPresetOf(diameter, pitch, settings.profile);
  if (sized?.taper !== undefined && Math.abs(sized.taper - Math.abs(taper)) > TAPER_SLACK) {
    warnings.push(
      `${sized.label} is made for a ${taperDegrees(sized.taper)} taper, but this face ${taper === 0 ? 'is a cylinder (0°)' : `tapers ${taperDegrees(taper)}`}: the thread follows the face.`,
    );
  }
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
  if (length < leadLength - EPS) {
    throw new KernelError(
      `The thread is ${mm(length)} long, shorter than one turn (${mm(leadLength)}). Make it longer.`,
    );
  }
  const turns = length / leadLength;
  if (turns > MAX_TURNS) {
    throw new KernelError(
      `The thread would have ${Math.ceil(turns)} turns${starts > 1 ? ' per start' : ''}; up to ${MAX_TURNS} can be modeled. Make it shorter or the pitch larger.`,
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
    starts,
    leadLength,
    profile: settings.profile,
    loadFlank: settings.loadFlank,
    radii,
    radius: r,
    taper,
    anchor,
    from,
    to,
    lead,
    left: settings.hand === 'left',
    report: {
      internal,
      profile: settings.profile,
      diameter,
      pitch,
      starts,
      leadLength,
      designation: name,
      face: 2 * r,
      taper: (taper * 180) / Math.PI,
      from,
      to,
      turns,
      lead,
    },
  };
}

/** How far a tapered thread's radii have moved at `v` along the axis (0 on a cylinder). */
export function shiftAt(plan: Partial<Pick<ThreadPlan, 'taper' | 'anchor'>>, v: number): number {
  const taper = plan.taper ?? 0;
  return taper === 0 ? 0 : (v - (plan.anchor ?? 0)) * Math.tan(taper);
}

/** A unit vector square to `d`. */
function squareTo(d: Vec3): Vec3 {
  const helper: Vec3 = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const v = cross(d, helper);
  return scale(v, 1 / Math.sqrt(dot(v, v)));
}

// ------------------------------------------------------------------ sections

/**
 * A closed section in the (u, v) half-plane (u from the axis, v along it) and
 * each curve's source (curve i runs from the previous curve's end to `to`).
 */
export interface Section {
  curves: PlanarCurve[];
  sources: string[];
}

/**
 * The tooth of the part (`internal` points inward), one tooth centred at
 * `v0` on the axis. The outline comes from the profile table
 * (`threadProfile`), so the kernel knows no angles of its own: each segment
 * (a line or an arc) is placed with `u = crest + s·r` (`s` points towards
 * the root) and `v = v0 + a`.
 */
export function toothSection(
  plan: Pick<ThreadPlan, 'internal' | 'pitch' | 'profile' | 'loadFlank' | 'radii'> &
    Partial<Pick<ThreadPlan, 'taper' | 'anchor'>>,
  v0: number,
): Section {
  const { radii, internal } = plan;
  const shape = threadProfile(plan.profile, plan.pitch, {
    internal,
    loadFlank: plan.loadFlank,
  });
  const s = internal ? 1 : -1;
  // On a cone, the radii the cone has at the tooth's centre (the sweep then
  // carries it along the slope).
  const crest = radii.crest + shiftAt(plan, v0);
  const place = ([a, r]: readonly [number, number]): [number, number] => [crest + s * r, v0 + a];
  const curves: PlanarCurve[] = [];
  const sources: string[] = [];
  const segments = shape.segments;
  const last = segments[segments.length - 1];
  let at = last ? place(last.to) : ([0, 0] as [number, number]);
  for (const segment of segments) {
    const to = place(segment.to);
    if (segment.kind === 'line') {
      curves.push({ kind: 'line', a: at, b: to });
    } else {
      // (a, r) -> (u, v) swaps the axes (a reflection); an external thread
      // negates r too, a second reflection that restores the turn's sense.
      const centre = place(segment.centre);
      curves.push(arcFrom(at, to, centre, internal ? !segment.ccw : segment.ccw));
    }
    sources.push(segment.source);
    at = to;
  }
  return { curves, sources };
}

/**
 * A planar arc from `a` to `b` about `centre`, counter-clockwise when `ccw`.
 * The sketch model stores arcs counter-clockwise, so a clockwise arc is
 * emitted as the same geometric arc traversed the other way (its start
 * angle moves to the old end): General Fuse finds the loop by its shared
 * vertices either way.
 */
function arcFrom(
  a: readonly [number, number],
  b: readonly [number, number],
  centre: readonly [number, number],
  ccw: boolean,
): PlanarCurve {
  const radius = Math.hypot(a[0] - centre[0], a[1] - centre[1]);
  let from = Math.atan2(a[1] - centre[1], a[0] - centre[0]);
  const end = Math.atan2(b[1] - centre[1], b[0] - centre[0]);
  let sweep = end - from;
  if (ccw) {
    while (sweep <= 0) sweep += 2 * Math.PI;
  } else {
    while (sweep >= 0) sweep -= 2 * Math.PI;
    from += sweep;
    sweep = -sweep;
  }
  return { kind: 'arc', center: centre, radius, from, sweep };
}

/** How far past the face and the crest the ring reaches. */
const reach = (plan: Pick<ThreadPlan, 'pitch'>) => 0.1 * plan.pitch + 0.05;

/** The band the tooth is cut from: root to just past the face (shaft) or from inside the face to the root (hole). */
export function ringSection(plan: ThreadPlan): Section {
  const { radii, internal, from, to } = plan;
  const far = internal
    ? Math.min(plan.radius, radii.crest) - reach(plan)
    : Math.max(plan.radius, radii.crest) + reach(plan);
  // On a cone both edges follow its slope: the band is a trapezoid.
  const at = (u: number, v: number): [number, number] => [
    internal ? Math.max(0, u + shiftAt(plan, v)) : u + shiftAt(plan, v),
    v,
  ];
  const corners: [number, number][] = [
    at(radii.root, from),
    at(far, from),
    at(far, to),
    at(radii.root, to),
  ];
  return {
    curves: corners.map((a, i) => ({
      kind: 'line',
      a,
      b: corners[(i + 1) % corners.length] as [number, number],
    })),
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
  // On a cone the lead-in follows the slope: each corner moves with its height.
  const shifted = (u: number, v: number): [number, number] => [
    internal ? Math.max(0, u + shiftAt(plan, v)) : u + shiftAt(plan, v),
    v,
  ];
  const corners: [number, number][] = [
    shifted(start, beyond),
    shifted(start, at),
    shifted(crestSide, at + into * rise),
    shifted(crestSide, beyond),
  ];
  return {
    curves: corners.map((a, i) => ({
      kind: 'line',
      a,
      b: corners[(i + 1) % corners.length] as [number, number],
    })),
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
  return planarFace(
    ctx,
    scope,
    section.curves,
    halfPlane(plan),
    section.sources.map((s) => `${prefix}${s}`),
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
  const turns = (plan.to - plan.from) / plan.leadLength + 2;
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
    // One tooth per start: shifting a tooth a pitch along the axis is turning
    // it by 360° / starts, so every start is the same sweep, a pitch higher.
    const teeth = Array.from({ length: plan.starts }, (_, j) => {
      const at = centre + piece.from * plan.leadLength + j * plan.pitch;
      const start = namedThreadSweep(kernel, {
        feature: ctx.feature.id,
        ...face(
          ctx,
          scope,
          plan,
          toothSection(plan, at),
          plan.starts > 1 ? `${prefix}s${j}.` : prefix,
        ),
        axis: plan.axis,
        pitch: plan.leadLength,
        turns: piece.turns,
        left: plan.left,
        ...(plan.taper !== 0 && { taper: plan.taper }),
      });
      gone.track(start.shape);
      return start;
    });
    // The teeth never touch (a root flat lies between), so they are one
    // compound, a valid argument: one cut per piece whatever the starts.
    let tooth = compoundOf(ctx, gone, teeth);
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
