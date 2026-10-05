/**
 * Where a pattern's instances go (P3-07, ADR-0047): each one as a rigid
 * motion of the original, a `Matrix12` for `Kernel.transform`, with a label
 * and a slot for its names and body IDs. Pure maths over lines and paths,
 * so it tests without OCCT.
 *
 * The original is instance 0 and is not listed; `symmetric` series have it
 * in the middle, so their other instances lie on both sides of it. With
 * `includeOriginal` it is listed too, which is what the **report** (P4-12:
 * `patternReport`) needs: the view draws a dot on every instance, the
 * original included.
 *
 * The series builders (`rectangularSeries`, `circularSeries`, `pathSeries`)
 * say where a series' first and last instances are, how far apart they are
 * and which way it runs: what a count handle drags.
 */
import {
  angularStep,
  instanceLabel,
  MAX_PATTERN_INSTANCES,
  type PatternAngle,
  type PatternReport,
  type PatternSeries,
  seriesOf,
  seriesStep,
  slotOf,
} from '@extrudo/core';
import { KernelError, type Vec3 } from '../kernel';
import { apply, compose, type Matrix12, rotation, translation, turnTo } from './matrix';
import type { Path } from './pattern-path';
import type { LineOf } from './references';
import { add, cross, length, scale, sub, unit } from './vec';

export interface Placement {
  /** For names: `2`, `m1`, `2x1`. */
  label: string;
  /** A whole number that stays with the instance when counts change (`slotOf`). */
  slot: number;
  matrix: Matrix12;
  /** The original itself, which every pattern counts but never moves (P4-12). */
  original?: boolean;
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
 * With `includeOriginal` the origin is listed as the original instance.
 */
export function rectangularPlacements(
  first: Row,
  second?: Row,
  includeOriginal = false,
): Placement[] {
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
      if (i === 0 && j === 0) {
        if (includeOriginal) {
          out.push({
            label: instanceLabel(0, second ? 0 : undefined),
            slot: 0,
            matrix: translation([0, 0, 0]),
            original: true,
          });
        }
        continue;
      }
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
 * (or between neighbours, `measure` `step`). With `includeOriginal` the
 * original is listed as instance 0.
 */
export function circularPlacements(
  axis: LineOf,
  count: number,
  angle: number,
  measure: PatternAngle,
  symmetric: boolean,
  includeOriginal = false,
): Placement[] {
  const step = angularStep(count, angle, measure, 2 * Math.PI);
  const out: Placement[] = [];
  for (const i of seriesOf(count, symmetric)) {
    if (i === 0) {
      if (includeOriginal) {
        out.push({
          label: instanceLabel(0),
          slot: 0,
          matrix: rotation(axis.origin, axis.direction, 0),
          original: true,
        });
      }
      continue;
    }
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
 * path's direction about its path point. With `includeOriginal` the original
 * is listed as instance 0, at the start.
 */
export function pathPlacements(
  path: Path,
  count: number,
  step: number,
  aligned: boolean,
  includeOriginal = false,
): Placement[] {
  const start = path.at(0);
  const out: Placement[] = [];
  for (let i = 0; i < count; i++) {
    if (i === 0) {
      if (includeOriginal) {
        out.push({
          label: instanceLabel(0),
          slot: 0,
          matrix: translation([0, 0, 0]),
          original: true,
        });
      }
      continue;
    }
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

// ------------------------------------------------------------------ report

/** Where the instances of one row are, for a count handle (P4-12). */
function linearSeries(row: Row, centre: Vec3): PatternSeries {
  const direction = unit(row.line.direction);
  const indices = seriesOf(row.count, row.symmetric);
  const first = indices[0] as number;
  const last = indices[indices.length - 1] as number;
  return {
    mode: 'linear',
    direction,
    step: row.step,
    count: row.count,
    first: add(centre, scale(direction, first * row.step)),
    last: add(centre, scale(direction, last * row.step)),
  };
}

/** A rectangular pattern's series, one per direction (P4-12). */
export function rectangularSeries(
  first: Row,
  second: Row | undefined,
  centre: Vec3,
): PatternSeries[] {
  const out = [linearSeries(first, centre)];
  if (second) out.push(linearSeries(second, centre));
  return out;
}

/** A circular pattern's one series, about the axis (P4-12). */
export function circularSeries(
  axis: LineOf,
  count: number,
  angle: number,
  measure: PatternAngle,
  symmetric: boolean,
  centre: Vec3,
): PatternSeries {
  const step = angularStep(count, angle, measure, 2 * Math.PI);
  const indices = seriesOf(count, symmetric);
  const last = indices[indices.length - 1] as number;
  return {
    mode: 'turn',
    direction: axis.direction,
    step,
    count,
    first: centre,
    last: apply(rotation(axis.origin, axis.direction, last * step), centre),
  };
}

/** A path pattern's one series: it runs along the path, which ends at the last instance (P4-12). */
export function pathSeries(
  path: Path,
  count: number,
  step: number,
  aligned: boolean,
  centre: Vec3,
): PatternSeries {
  const start = path.at(0);
  const end = path.at((count - 1) * step);
  const move = translation(sub(end.point, start.point));
  const matrix = aligned ? compose(move, turnTo(start.point, start.tangent, end.tangent)) : move;
  return {
    mode: 'linear',
    direction: end.tangent,
    step,
    count,
    first: centre,
    last: apply(matrix, centre),
  };
}

/**
 * What a pattern reports for the view (P4-12, ADR-0047 amendment): where
 * every instance's centre goes (the placement applied to the centre of what
 * is patterned) and which series it belongs to, so the dialog can put a dot on
 * each instance and a handle on each series' last one. `placements` are all
 * the instances, the original included (`includeOriginal`).
 */
export function patternReport(
  placements: readonly Placement[],
  series: readonly PatternSeries[],
  centre: Vec3,
  skip: ReadonlySet<string>,
): PatternReport {
  return {
    series: [...series],
    instances: placements.map((placement) => {
      const at = apply(placement.matrix, centre);
      return {
        label: placement.label,
        at: [at[0], at[1], at[2]],
        skipped: placement.original !== true && skip.has(placement.label),
        original: placement.original === true,
      };
    }),
  };
}

const round = (value: number) => Math.round(value * 100) / 100;
