/**
 * The clearance check's view side (P6-05 J3, ADR-0081 §4), pure: what the
 * check is asked (which bodies move, the range, the default minimum gap) and
 * how its result reads — the panel's lines and the Viewport region's
 * `data-joint-check`. The check itself runs in the kernel worker
 * (`KernelApi.checkJoint`).
 */
import {
  type BodyId,
  type ComponentId,
  type ExprInput,
  type ExtrudoDocument,
  type Joint,
  type JointId,
  jointRange,
  movingComponents,
  TOLERANCE_PARAMETER,
} from '@extrudo/core';
import type { JointCheck, Vec3 } from '@extrudo/kernel';

/** The check in the viewport store: view state like the wall-thickness check's. */
export interface JointCheckState {
  joint: JointId;
  /** The minimum gap, a length expression. */
  min: string;
  /** Whether the view draws the marks (the leader, the tinted faces). */
  on: boolean;
}

/** The minimum gap a new check starts with: the document's `tolerance` if it has one (ADR-0062). */
export function defaultMinGap(doc: Pick<ExtrudoDocument, 'parameters'>): string {
  return doc.parameters.some((p) => p.name === TOLERANCE_PARAMETER)
    ? TOLERANCE_PARAMETER
    : '0.2 mm';
}

/** The bodies that move with the joint's side a, and every other live body (ADR-0081 §4). */
export function checkBodies(
  doc: Pick<ExtrudoDocument, 'joints'>,
  joint: Joint,
  live: readonly BodyId[],
  componentOf: (id: BodyId) => ComponentId | undefined,
): { moving: BodyId[]; others: BodyId[] } {
  const moves = new Set(movingComponents(doc, joint));
  const moving: BodyId[] = [];
  const others: BodyId[] = [];
  for (const id of live) {
    const component = componentOf(id);
    if (component !== undefined && moves.has(component)) moving.push(id);
    else others.push(id);
  }
  return { moving, others };
}

/**
 * The range the check samples, or why it can't: a revolute without limits is
 * a whole turn, a slider needs both.
 */
export function checkRange(
  joint: Joint,
  value: (input: ExprInput) => number,
): { min: number; max: number } | { error: string } {
  if (joint.type === 'rigid') return { error: `${joint.name} is rigid: it doesn't move.` };
  let range: { min: number; max: number } | undefined;
  try {
    range = jointRange(joint, value);
  } catch {
    return { error: `${joint.name}'s limits don't evaluate.` };
  }
  if (!range) {
    if (joint.type === 'slider') return { error: `Give ${joint.name} a travel to check it.` };
    return { min: -180, max: 180 };
  }
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max)) {
    return { error: `${joint.name}'s limits don't evaluate.` };
  }
  if (range.min > range.max) return { error: `${joint.name}'s minimum is above its maximum.` };
  return range;
}

/** One line of the result; `show` is the joint value a Show button poses. */
export interface ClearanceLine {
  kind: 'tightest' | 'collision' | 'under' | 'free';
  text: string;
  show?: number;
}

const trim = (value: number, digits: number) => String(Number(value.toFixed(digits)));

/** A joint value as a person reads it: "72°", "12.5 mm". */
export function jointValue(type: Joint['type'], value: number, digits = 1): string {
  return type === 'slider' ? `${trim(value, 2)} mm` : `${trim(value, digits)}°`;
}

/** The result as the panel says it (ADR-0081 §4's sentences). */
export function clearanceLines(
  joint: Pick<Joint, 'type'>,
  range: { min: number; max: number },
  minGap: number,
  check: JointCheck,
): ClearanceLine[] {
  const value = (v: number) => jointValue(joint.type, v);
  const fixed = (v: number) =>
    joint.type === 'slider' ? `${v.toFixed(2)} mm` : `${v.toFixed(1)}°`;
  const lines: ClearanceLine[] = [];
  const { tightest } = check;
  if (tightest) {
    const where = tightest.over
      ? `${value(tightest.over.from)}–${value(tightest.over.to)}`
      : value(tightest.at);
    lines.push({
      kind: 'tightest',
      text: `Tightest gap ${tightest.gap.toFixed(2)} mm at ${where}`,
      show: tightest.at,
    });
  }
  for (const u of check.underMinimum) {
    lines.push({
      kind: 'under',
      text:
        u.from === u.to
          ? `Under ${trim(minGap, 2)} mm at ${value(u.from)}`
          : `Under ${trim(minGap, 2)} mm from ${value(u.from)} to ${value(u.to)}`,
      show: (u.from + u.to) / 2,
    });
  }
  for (const c of check.collisions) {
    lines.push({
      kind: 'collision',
      text: `Collides from ${fixed(c.from)} to ${fixed(c.to)} (${trim(c.volume, 1)} mm³ at ${value(c.at)})`,
      show: c.at,
    });
  }
  if (check.collisions.length === 0) {
    lines.push({
      kind: 'free',
      text: `No collision from ${value(range.min)} to ${value(range.max)}.`,
    });
  }
  return lines;
}

/** What the check is doing, for the panel and `data-joint-check`. */
export type ClearanceStatus = 'idle' | 'pending' | 'ready' | 'stale' | 'error';

/**
 * The Viewport region's `data-joint-check`: "joint=Hinge min=0.3 tightest=0.3
 * at=0 collides=none under=none samples=44" (collisions and stretches under the
 * minimum as `from..to`, joined by `,`), with `pending`, `stale`, `idle` or
 * `error` instead of or after the numbers.
 */
export function clearanceSummary(
  jointName: string,
  minGap: number | undefined,
  status: ClearanceStatus,
  check: JointCheck | undefined,
): string {
  const head = `joint=${jointName.replace(/\s+/g, '_')} min=${minGap === undefined ? '?' : trim(minGap, 3)}`;
  if (status !== 'ready' && status !== 'stale') return `${head} ${status}`;
  if (!check) return `${head} ${status}`;
  const ranges = (list: readonly { from: number; to: number }[]) =>
    list.length === 0
      ? 'none'
      : list.map((r) => `${r.from.toFixed(1)}..${r.to.toFixed(1)}`).join(',');
  const parts = [
    head,
    `tightest=${check.tightest ? trim(check.tightest.gap, 3) : 'none'}`,
    `at=${check.tightest ? trim(check.tightest.at, 1) : 'none'}`,
    `collides=${ranges(check.collisions)}`,
    `under=${ranges(check.underMinimum)}`,
    `samples=${check.samples}`,
  ];
  if (status === 'stale') parts.push('stale');
  return parts.join(' ');
}

/** Whether the pose shown (0 as built) is where a mark belongs: inside `[from, to]`. */
export function shownAt(pose: number, from: number, to: number): boolean {
  return pose >= Math.min(from, to) - 1e-6 && pose <= Math.max(from, to) + 1e-6;
}

/** What the view draws of a check at the pose shown (`pose`: 0 as built). */
export interface ClearanceMarks {
  /** The tightest gap's leader, when the pose shown is where it was found. */
  leader?: { from: Vec3; to: Vec3; gap: number };
  /** The faces of the collisions whose range holds the pose shown, per body. */
  collisions?: Record<BodyId, number[]>;
}

/** The marks of a ready check whose marks are on; none while it is stale or running. */
export function clearanceMarks(
  check: {
    state: JointCheckState | undefined;
    status: ClearanceStatus;
    result: JointCheck | undefined;
  },
  pose: number,
): ClearanceMarks {
  const { state, status, result } = check;
  if (!state?.on || status !== 'ready' || !result) return {};
  const out: ClearanceMarks = {};
  const t = result.tightest;
  if (t?.from && t.to && Math.abs(t.at - pose) < 1e-6) {
    out.leader = { from: t.from, to: t.to, gap: t.gap };
  }
  for (const c of result.collisions) {
    if (!shownAt(pose, c.from, c.to)) continue;
    out.collisions ??= {};
    for (const f of c.faces) {
      const list = out.collisions[f.body] ?? [];
      list.push(f.index);
      out.collisions[f.body] = list;
    }
  }
  return out;
}
