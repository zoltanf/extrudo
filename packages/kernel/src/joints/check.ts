/**
 * The clearance check along a joint's motion (P6-05, ADR-0081 §4): samples
 * the joint's range, measures at each pose the smallest distance between the
 * moving bodies and every other live body, finds the tightest point and any
 * collision, and where the bodies come closer than the minimum gap. It runs
 * in the worker on the shapes of the last finished recompute through
 * existing `Kernel` calls only (no facade change): `transform` places a
 * moving body, `closestPoints` (or `minGap` for a mesh) measures, and where
 * the gap is 0, `common` tells touching from interference and names the
 * faces that collide.
 */
import type { BodyId, Joint, JointReport } from '@extrudo/core';
import { apply, IDENTITY, type Matrix12, rotation, translation } from '../features/matrix';
import { scale } from '../features/vec';
import type { HistoryRecord } from '../history';
import { type Kernel, KernelError, type ShapeHandle, type ShapeScope, type Vec3 } from '../kernel';
import {
  coarseSamples,
  JOINT_SAMPLES,
  MAX_JOINT_COMMONS,
  MAX_JOINT_EVALS,
  narrowBoundary,
  narrowMinimum,
} from './sampling';

/** What the check measures: the request the app sends. */
export interface JointCheckRequest {
  /** As stored; its report is the last recompute's. */
  joint: Joint;
  /** The bodies that move: the members of `movingComponents`. */
  moving: readonly BodyId[];
  /** Every other live body (display ignored, ADR-0081 §4). */
  others: readonly BodyId[];
  /** In degrees (revolute) or mm (slider), evaluated by the app. */
  range: { min: number; max: number };
  /** mm. */
  minGap: number;
}

export interface JointCheck {
  /** Evaluations (poses measured) used. */
  samples: number;
  /**
   * The smallest gap of a pose that doesn't collide, where it is and between
   * which bodies; `over` where it is flat (within 1 µm) over a stretch of
   * coarse samples, `at` then the one of them nearest as built. `from`/`to` are the closest points at `at` (absent for a
   * mesh pair, which has no closest points). Undefined when no body came
   * within the search distance at any pose.
   */
  tightest?: {
    at: number;
    gap: number;
    over?: { from: number; to: number };
    from?: Vec3;
    to?: Vec3;
    pair: [BodyId, BodyId];
  };
  /** Where the moving bodies interfere, with the overlap and its faces at `at`. */
  collisions: {
    from: number;
    to: number;
    volume: number;
    at: number;
    faces: { body: BodyId; index: number }[];
  }[];
  /** Where the gap is under the minimum without a collision (touching included). */
  underMinimum: { from: number; to: number }[];
}

/** The live shapes by body (the last finished recompute's). */
export type BodyShapes = ReadonlyMap<BodyId, ShapeHandle>;

/** A pair is measured only where the moved box, grown by this, meets the other box: mm. */
export const jointSearch = (minGap: number): number => Math.max(5, 2 * minGap);
/** A `common` with more volume than this is interference, less is touching: mm³. */
export const INTERFERENCE_VOLUME = 1e-6;
/** A gap of this or less is contact: mm. */
const CONTACT = 1e-7;
/** Gaps within this of the smallest are one flat minimum: mm. */
const FLAT = 1e-3;
/** Where refinement stops, per type. */
const STEP = { revolute: 0.1, slider: 0.01 } as const;
/** Evaluations per refinement. */
const REFINE = 8;

/** The check stopped: a newer one, a cancel or a recompute came first. */
export class CancelledError extends Error {
  override name = 'CancelledError';
  constructor() {
    super('The clearance check was cancelled.');
  }
}

export function isCheckCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'CancelledError';
}

/**
 * The matrix that poses a joint's moving side at `value` (degrees about a
 * revolute's axis, right-handed, or mm along a slider's direction; `flip`
 * reverses it). IDENTITY at 0.
 */
export function jointMatrix(report: JointReport, joint: Joint, value: number): Matrix12 {
  if (value === 0 || !report.axis) return IDENTITY;
  const sign = joint.flip ? -1 : 1;
  const { origin, direction } = report.axis;
  if (joint.type === 'revolute') {
    return rotation(origin, direction, (sign * value * Math.PI) / 180);
  }
  if (joint.type === 'slider') return translation(scale(direction, sign * value));
  return IDENTITY;
}

/** Why a joint can't be checked as its report stands, or undefined. */
export function refusal(joint: Joint, report: JointReport | undefined): string | undefined {
  if (joint.type === 'rigid') return `${joint.name} is rigid: it doesn't move.`;
  if (joint.suppressed) return `${joint.name} is suppressed.`;
  if (!report) return `${joint.name} hasn't been computed yet.`;
  if (report.status === 'error' || report.status === 'inactive') {
    return report.message ?? `${joint.name} can't be resolved.`;
  }
  // The frames disagree as built (a print-layout Move laid the parts apart):
  // a guessed frame's warning alone doesn't stop the check.
  if (report.status === 'warning' && report.message?.includes("aren't where the joint was made")) {
    return report.message;
  }
  if (!report.axis) return `${joint.name} has no axis.`;
  return undefined;
}

interface Box {
  min: Vec3;
  max: Vec3;
}

/** A moving body and another whose boxes meet at a pose. */
interface Pair {
  m: { id: BodyId; shape: ShapeHandle };
  o: { id: BodyId; shape: ShapeHandle };
  /** The moving body placed at the pose (made once, by the first pair that asks). */
  place(): ShapeHandle;
}

/** One pose measured. */
interface Evaluation {
  v: number;
  /** The smallest gap of the pairs that met (∞ when none did). */
  gap: number;
  from?: Vec3;
  to?: Vec3;
  pair?: [BodyId, BodyId];
  /** Set when a `common` ran: the overlap's volume and faces. */
  volume?: number;
  faces?: { body: BodyId; index: number }[];
}

/**
 * Runs the check. `yieldNow` is called between passes and returns `false`
 * when the check must stop (`CancelledError`); every shape it makes is
 * released before the next pose, and on any throw.
 */
export async function checkJoint(
  kernel: Kernel,
  bodies: BodyShapes,
  report: JointReport,
  request: JointCheckRequest,
  yieldNow: () => Promise<boolean>,
  onProgress?: (done: number, of: number) => void,
): Promise<JointCheck> {
  const { joint, range, minGap } = request;
  const why = refusal(joint, report);
  if (why) throw new KernelError(why);
  if (joint.type === 'rigid') throw new KernelError(`${joint.name} is rigid: it doesn't move.`);
  if (!(range.max >= range.min)) {
    throw new KernelError(`${joint.name}'s minimum is above its maximum.`);
  }
  const shape = (id: BodyId) => {
    const found = bodies.get(id);
    if (found === undefined) {
      throw new KernelError('A body to check is no longer in the model. Try again.');
    }
    return found;
  };
  const moving = request.moving.map((id) => ({ id, shape: shape(id) }));
  const others = request.others
    .filter((id) => !request.moving.includes(id))
    .map((id) => ({ id, shape: shape(id) }));
  if (moving.length === 0) throw new KernelError(`${joint.name} moves no body.`);
  const boxOf = (h: ShapeHandle): Box => kernel.measure(h).bbox;
  const movingBoxes = moving.map((m) => boxOf(m.shape));
  const search = jointSearch(minGap);
  const otherBoxes = others.map((o) => grow(boxOf(o.shape), search));
  const step = STEP[joint.type];
  const coarse = coarseSamples(range, JOINT_SAMPLES[joint.type]);
  let used = 0;
  let commons = 0;
  const all: Evaluation[] = [];
  const total = coarse.length;

  /** The pairs whose boxes meet at a pose, with the moving body placed lazily. */
  const pairsAt = (v: number, scope: ShapeScope, visit: (pair: Pair) => void) => {
    used++;
    const matrix = jointMatrix(report, joint, v);
    const still = matrix === IDENTITY;
    for (const [i, m] of moving.entries()) {
      const box = still ? (movingBoxes[i] as Box) : movedBox(movingBoxes[i] as Box, matrix);
      let placed: ShapeHandle | undefined;
      const place = () => {
        placed ??= still ? m.shape : scope.track(kernel.transform(m.shape, matrix)).shape;
        return placed;
      };
      for (const [j, o] of others.entries()) {
        if (meets(box, otherBoxes[j] as Box)) visit({ m, o, place });
      }
    }
  };

  /** The smallest gap at a pose and where it is. */
  const evaluate = (v: number): Evaluation => {
    const out: Evaluation = { v, gap: Number.POSITIVE_INFINITY };
    using scope = kernel.scope();
    pairsAt(v, scope, (pair) => {
      if (out.gap <= CONTACT) return;
      const placed = pair.place();
      if (kernel.isMesh(placed) || kernel.isMesh(pair.o.shape)) {
        // manifold-3d's own gap: a mesh has no closest points to show.
        const gap = kernel.minGap(placed, pair.o.shape, search);
        if (gap < out.gap) {
          out.gap = gap;
          out.pair = [pair.m.id, pair.o.id];
          delete out.from;
          delete out.to;
        }
        return;
      }
      // Whole bodies: BRepExtrema prunes by its sub-shapes' boxes itself, and
      // a face-by-face search from here measured slower (ADR-0081's Results).
      const measured = kernel.closestPoints(placed, pair.o.shape);
      if (measured.distance < out.gap) {
        Object.assign(out, {
          gap: measured.distance,
          from: measured.from,
          to: measured.to,
          pair: [pair.m.id, pair.o.id],
        });
      }
    });
    all.push(out);
    return out;
  };

  /** The overlap at a pose (a `common` per pair that meets): its volume and faces. */
  const overlap = (e: Evaluation): Evaluation => {
    using scope = kernel.scope();
    let volume = 0;
    const faces: { body: BodyId; index: number }[] = [];
    pairsAt(e.v, scope, (pair) => {
      if (commons >= MAX_JOINT_COMMONS) return;
      commons++;
      const common = scope.track(kernel.common(pair.place(), pair.o.shape));
      const v = Math.max(0, kernel.properties(common.shape).volume);
      volume += v;
      if (v > INTERFERENCE_VOLUME) {
        faces.push(
          ...facesOf(common.history, 0, pair.m.id),
          ...facesOf(common.history, 1, pair.o.id),
        );
      }
    });
    e.volume = volume;
    if (faces.length > 0) e.faces = faces;
    return e;
  };

  const pause = async () => {
    if (!(await yieldNow())) throw new CancelledError();
  };
  const left = () => Math.max(0, MAX_JOINT_EVALS - used);

  // 1. The coarse pass: gaps only.
  const samples: Evaluation[] = [];
  for (const [i, v] of coarse.entries()) {
    await pause();
    if (left() === 0) break;
    samples.push(evaluate(v));
    onProgress?.(i + 1, total);
  }

  // 2. Touching or interfering: a `common` at each contact run's middle; where
  // that only touches, at its ends too, then the rest spread out. A contact
  // sample without one is classified as the nearest one in its run that has.
  const contact = (e: Evaluation) => e.gap <= CONTACT;
  const runs = runsOf(samples.map(contact));
  const measured = new Set<number>();
  const interferes = (k: number) => ((samples[k] as Evaluation).volume ?? 0) > INTERFERENCE_VOLUME;
  const tryCommon = async (k: number) => {
    if (measured.has(k) || commons >= MAX_JOINT_COMMONS || left() === 0) return;
    await pause();
    measured.add(k);
    overlap(samples[k] as Evaluation);
  };
  for (const [a, b] of runs) await tryCommon(Math.floor((a + b) / 2));
  for (const [a, b] of runs) {
    if (interferes(Math.floor((a + b) / 2))) continue;
    await tryCommon(a);
    await tryCommon(b);
    for (let k = a; k <= b; k++) await tryCommon(k);
  }
  const collidesAt = (k: number): boolean => {
    if (!contact(samples[k] as Evaluation)) return false;
    const run = runs.find(([a, b]) => k >= a && k <= b);
    if (!run) return false;
    let nearest: number | undefined;
    for (const j of measured) {
      if (j < run[0] || j > run[1]) continue;
      if (nearest === undefined || Math.abs(j - k) < Math.abs(nearest - k)) nearest = j;
    }
    // A run nobody could measure counts as a collision: say too much, not too little.
    return nearest === undefined || interferes(nearest);
  };
  const state = samples.map((e, k) =>
    collidesAt(k) ? 'collide' : e.gap < minGap ? 'under' : 'ok',
  );

  // 3. Each boundary between a colliding and a free pose, and between a pose
  // under the minimum and one that isn't, to the step. Next to a free pose a
  // collision starts where contact does; next to a touching one, only a
  // `common` tells (while the budget lasts).
  const touches = (v: number) => contact(evaluate(v));
  const collides = (v: number) => {
    const e = evaluate(v);
    if (!contact(e)) return false;
    if (commons >= MAX_JOINT_COMMONS) return true;
    return (overlap(e).volume ?? 0) > INTERFERENCE_VOLUME;
  };
  const tight = (v: number) => evaluate(v).gap < minGap;
  const collideEdge = new Map<number, number>();
  const tightEdge = new Map<number, number>();
  for (let k = 0; k + 1 < samples.length; k++) {
    const a = samples[k] as Evaluation;
    const b = samples[k + 1] as Evaluation;
    const sa = state[k];
    const sb = state[k + 1];
    if ((sa === 'collide') !== (sb === 'collide')) {
      await pause();
      const [free, hit] = sa === 'collide' ? [b.v, a.v] : [a.v, b.v];
      const freeSample = sa === 'collide' ? b : a;
      const predicate = contact(freeSample) ? collides : touches;
      collideEdge.set(k, narrowBoundary(predicate, free, hit, step, Math.min(REFINE, left())).at);
    }
    if ((sa === 'ok') !== (sb === 'ok')) {
      await pause();
      const [free, hit] = sa === 'ok' ? [a.v, b.v] : [b.v, a.v];
      tightEdge.set(k, narrowBoundary(tight, free, hit, step, Math.min(REFINE, left())).at);
    }
  }

  const collisions: JointCheck['collisions'] = [];
  for (const [a, b] of runsOf(state.map((s) => s === 'collide'))) {
    const from = a > 0 ? (collideEdge.get(a - 1) ?? samples[a]?.v) : samples[a]?.v;
    const to = b + 1 < samples.length ? (collideEdge.get(b) ?? samples[b]?.v) : samples[b]?.v;
    let worst: Evaluation | undefined;
    for (const e of all) {
      if (e.volume === undefined || e.volume <= INTERFERENCE_VOLUME) continue;
      if (e.v < (from as number) - 1e-9 || e.v > (to as number) + 1e-9) continue;
      if (!worst || (e.volume as number) > (worst.volume as number)) worst = e;
    }
    collisions.push({
      from: from as number,
      to: to as number,
      volume: worst?.volume ?? 0,
      at: worst?.v ?? (samples[Math.floor((a + b) / 2)] as Evaluation).v,
      faces: dedupe(worst?.faces ?? []),
    });
  }
  const underMinimum: JointCheck['underMinimum'] = [];
  for (const [a, b] of runsOf(state.map((s) => s !== 'ok'))) {
    const from = a > 0 ? (tightEdge.get(a - 1) ?? samples[a]?.v) : samples[a]?.v;
    const to = b + 1 < samples.length ? (tightEdge.get(b) ?? samples[b]?.v) : samples[b]?.v;
    // The collisions inside cut it into the stretches before and after them.
    let start = from as number;
    const end = to as number;
    const inside = collisions.filter((c) => c.to >= start && c.from <= end);
    for (const c of inside) {
      if (c.from > start) underMinimum.push({ from: start, to: c.from });
      start = Math.max(start, c.to);
    }
    if (end > start || (end === start && !inside.some((c) => c.to >= start))) {
      underMinimum.push({ from: start, to: end });
    }
  }

  // 4. The tightest pose that doesn't collide, refined where it is a dip.
  const free = (e: Evaluation) =>
    Number.isFinite(e.gap) &&
    !collisions.some((c) => e.v >= c.from - 1e-9 && e.v <= c.to + 1e-9) &&
    (e.volume === undefined || e.volume <= INTERFERENCE_VOLUME);
  const smallest = () => {
    let best: Evaluation | undefined;
    for (const e of all) if (free(e) && (!best || e.gap < best.gap)) best = e;
    return best;
  };
  let best = smallest();
  let over: { from: number; to: number } | undefined;
  if (best) {
    const k = samples.indexOf(best);
    const flat = runsOf(samples.map((e) => free(e) && e.gap - (best as Evaluation).gap <= FLAT));
    const stretch = flat.find(([a, b]) => k >= a && k <= b);
    if (stretch && stretch[1] > stretch[0]) {
      over = {
        from: (samples[stretch[0]] as Evaluation).v,
        to: (samples[stretch[1]] as Evaluation).v,
      };
      // Flat: the pose nearest as built stands for it, so its points can be shown unposed.
      for (let j = stretch[0]; j <= stretch[1]; j++) {
        const e = samples[j] as Evaluation;
        if (Math.abs(e.v) < Math.abs(best.v)) best = e;
      }
    } else if (k >= 0 && best.gap > CONTACT && left() > 0) {
      const lo = (samples[k - 1] ?? best).v;
      const hi = (samples[k + 1] ?? best).v;
      if (hi > lo) {
        await pause();
        narrowMinimum((v) => evaluate(v).gap, lo, hi, step, Math.min(REFINE, left()));
        best = smallest() ?? best;
      }
    }
  }
  onProgress?.(total, total);

  const tightest: JointCheck['tightest'] =
    best?.pair === undefined
      ? undefined
      : {
          at: best.v,
          gap: best.gap,
          ...(over && { over }),
          ...(best.from && best.to && { from: best.from, to: best.to }),
          pair: best.pair,
        };
  return { samples: used, ...(tightest && { tightest }), collisions, underMinimum };
}

/** The faces of input `input` a `common` kept a piece of. */
function facesOf(
  history: readonly HistoryRecord[],
  input: number,
  body: BodyId,
): { body: BodyId; index: number }[] {
  const out: { body: BodyId; index: number }[] = [];
  for (const record of history) {
    if (record.input !== input || record.from.kind !== 'face') continue;
    if (record.relation === 'deleted' || record.to.length === 0) continue;
    if (!record.to.some((t) => t.kind === 'face')) continue;
    out.push({ body, index: record.from.index });
  }
  return out;
}

function dedupe(faces: readonly { body: BodyId; index: number }[]) {
  const seen = new Set<string>();
  return faces.filter((f) => {
    const key = `${f.body}:${f.index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Runs of `true`, as inclusive index pairs. */
function runsOf(flags: readonly boolean[]): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (const [i, f] of flags.entries()) {
    if (f && start < 0) start = i;
    if (!f && start >= 0) {
      out.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0) out.push([start, flags.length - 1]);
  return out;
}

function grow(box: Box, by: number): Box {
  return {
    min: [box.min[0] - by, box.min[1] - by, box.min[2] - by],
    max: [box.max[0] + by, box.max[1] + by, box.max[2] + by],
  };
}

function meets(a: Box, b: Box): boolean {
  for (let i = 0; i < 3; i++) {
    if ((a.max[i] as number) < (b.min[i] as number) || (a.min[i] as number) > (b.max[i] as number))
      return false;
  }
  return true;
}

/** The box round a box's eight corners moved by `matrix`. */
function movedBox(box: Box, matrix: Matrix12): Box {
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const x of [box.min[0], box.max[0]]) {
    for (const y of [box.min[1], box.max[1]]) {
      for (const z of [box.min[2], box.max[2]]) {
        const p = apply(matrix, [x, y, z]);
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i] as number, p[i] as number);
          max[i] = Math.max(max[i] as number, p[i] as number);
        }
      }
    }
  }
  return { min: min as unknown as Vec3, max: max as unknown as Vec3 };
}
