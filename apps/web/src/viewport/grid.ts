/**
 * Grid spacing, shared by the grid shader (`GridPlane.tsx`) and grid snapping
 * (P1-02). Levels are spacings in mm; sketches stay mm either way, the grid is
 * display and snapping only (P6-18 S2, ADR-0113 §2). Metric designs use powers
 * of ten mm with 1 mm the finest (ADR-0008); inch designs use binary fractions
 * of an inch, whole inches and feet.
 */
import type { LengthUnit } from '@extrudo/core';

/** A level's lines fade out as its cells crowd towards this width on screen. */
export const MINOR_PIXELS = 12;

/** The metric levels: powers of ten mm, 1 mm at the finest. */
export const METRIC_LEVELS: readonly number[] = [1, 10, 100, 1e3, 1e4, 1e5, 1e6];

/** The inch levels: 1/16 … 1 in, then 6 in, 1 ft, 10 ft and 100 ft, in mm. */
export const INCH_LEVELS: readonly number[] = [
  1 / 16,
  1 / 8,
  1 / 4,
  1 / 2,
  1,
  6,
  12,
  120,
  1200,
].map((inch) => inch * 25.4);

/** The grid levels of a design's unit; `cm` and `m` stay on the mm levels. */
export function gridLevels(unit: LengthUnit): readonly number[] {
  return unit === 'in' ? INCH_LEVELS : METRIC_LEVELS;
}

/**
 * The grid step points snap to (mm) at `perPixel` mm per screen pixel: the
 * finest level whose cells are at least `MINOR_PIXELS` px wide, like the lines
 * the grid draws at full strength — or the coarsest level when even its cells
 * are narrower than that.
 */
export function gridStep(perPixel: number, unit: LengthUnit = 'mm'): number {
  const levels = gridLevels(unit);
  const want = perPixel * MINOR_PIXELS;
  for (const level of levels) if (level >= want) return level;
  // biome-ignore lint/style/noNonNullAssertion: both tables end at their coarsest level
  return levels[levels.length - 1]!;
}
