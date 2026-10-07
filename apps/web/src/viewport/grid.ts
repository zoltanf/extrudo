/**
 * Grid spacing, shared by the grid shader (`GridPlane.tsx`) and grid snapping
 * (P1-02). Levels are powers of ten mm, 1 mm at the finest.
 */

/** A minor cell is between GRID_PIXELS / 10 and GRID_PIXELS wide on screen. */
export const GRID_PIXELS = 60;

/**
 * The grid step points snap to (mm) at `perPixel` mm per screen pixel: the
 * finest level whose cells are at least 12 px wide, like the lines the grid
 * draws at full strength.
 */
export function gridStep(perPixel: number): number {
  return 10 ** Math.max(0, Math.ceil(Math.log10(perPixel * 12)));
}
