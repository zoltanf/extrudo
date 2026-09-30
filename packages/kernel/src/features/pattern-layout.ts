/**
 * Where a pattern's instances go (P3-07, ADR-0047): each one as a rigid
 * motion of the original, a `Matrix12` for `Kernel.transform`, with a label
 * and a slot for its names and body IDs. Pure maths over lines and paths,
 * so it tests without OCCT.
 *
 * The original is instance 0 and is not listed; `symmetric` series have it
 * in the middle, so their other instances lie on both sides of it.
 */
import {
  angularStep,
  instanceLabel,
  MAX_PATTERN_INSTANCES,
  type PatternAngle,
  seriesOf,
  seriesStep,
  slotOf,
} from '@extrudo/core';
import { KernelError, type Vec3 } from '../kernel';
import { compose, type Matrix12, rotation, translation, turnTo } from './matrix';
import type { Path } from './pattern-path';
import type { LineOf } from './references';
import { add, cross, length, scale, sub, unit } from './vec';

export interface Placement {
  /** For names: `2`, `m1`, `2x1`. */
  label: string;
  /** A whole number that stays with the instance when counts change (`slotOf`). */
  slot: number;
  matrix: Matrix12;
}

/** One direction of a rectangular pattern. */
export interface Row {
  line: LineOf;
  count: number;
  /** The step between neighbours, mm (already resolved from a distance and a measure). */
  step: number;
  symmetric: boolean;
}

/** Checks a count typed as an expression: a whole number from 1 up. */
export function wholeCount(value: number, label: string): number {
  if (!Number.isFinite(value) || Math.abs(value - Math.round(value)) > 1e-9) {
    throw new KernelError(`${label} must be a whole number, not ${value}.`);
  }
  if (value < 1) throw new KernelError(`${label} must be at least 1.`);
  return Math.round(value);
}

/** Refuses a pattern that would make more than `MAX_PATTERN_INSTANCES`. */
export function limitInstances(total: number): void {
  if (total > MAX_PATTERN_INSTANCES) {
    throw new KernelError(
      `A pattern can make up to ${MAX_PATTERN_INSTANCES} instances, and this one makes ${total}. Lower a count.`,
    );
  }
}

/** A row's step from what the user typed (see `seriesStep`). */
export const rowStep = (count: number, distance: number, measure: 'spacing' | 'extent') =>
  seriesStep(count, distance, measure);

/**
 * A grid or a row: each index pair but the origin `(0, 0)`, the move by
 * `i × step1` along the first direction and `j × step2` along the second.
 */
export function rectangularPlacements(first: Row, second?: Row): Placement[] {
  if (second) {
    const parallel = length(cross(unit(first.line.direction), unit(second.line.direction)));
    if (parallel < 1e-6) {
      throw new KernelError(
        'The two directions are parallel, so the instances would lie on one line. Pick a direction that turns away from the first.',
      );
    }
  }
  const out: Placement[] = [];
  const rows = second ? seriesOf(second.count, second.symmetric) : [0];
  for (const j of rows) {
    for (const i of seriesOf(first.count, first.symmetric)) {
      if (i === 0 && j === 0) continue;
      let by: Vec3 = scale(unit(first.line.direction), i * first.step);
      if (second) by = add(by, scale(unit(second.line.direction), j * second.step));
      out.push({
        label: instanceLabel(i, second ? j : undefined),
        slot: slotOf(i, second ? j : 0),
        matrix: translation(by),
      });
    }
  }
  return out;
}

/**
 * Instances turned about `axis`: `count` of them, `angle` radians in all
 * (or between neighbours, `measure` `step`).
 */
export function circularPlacements(
  axis: LineOf,
  count: number,
  angle: number,
  measure: PatternAngle,
  symmetric: boolean,
): Placement[] {
  const step = angularStep(count, angle, measure, 2 * Math.PI);
  const out: Placement[] = [];
  for (const i of seriesOf(count, symmetric)) {
    if (i === 0) continue;
    out.push({
      label: instanceLabel(i),
      slot: slotOf(i),
      matrix: rotation(axis.origin, axis.direction, i * step),
    });
  }
  return out;
}

/**
 * Instances along a path: the `i`th `i × step` from its start (the first
 * instance, the original, is taken to sit at the start; the others move
 * by the way the path went from there). With `aligned` each turns with the
 * path's direction about its path point.
 */
export function pathPlacements(
  path: Path,
  count: number,
  step: number,
  aligned: boolean,
): Placement[] {
  const start = path.at(0);
  const out: Placement[] = [];
  for (let i = 1; i < count; i++) {
    const s = i * step;
    if (s > path.length * (1 + 1e-4) + 1e-6) {
      throw new KernelError(
        `The path is ${round(path.length)} mm long, and instance ${i + 1} would be ${round(s)} mm along it. Lower the count or the distance.`,
      );
    }
    const here = path.at(s);
    const move = translation(sub(here.point, start.point));
    const matrix = aligned ? compose(move, turnTo(start.point, start.tangent, here.tangent)) : move;
    out.push({ label: instanceLabel(i), slot: slotOf(i), matrix });
  }
  return out;
}

const round = (value: number) => Math.round(value * 100) / 100;
