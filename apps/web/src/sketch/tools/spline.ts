/**
 * The fit-point Spline tool (P1-05, FR-SK-03): each click adds a point the
 * curve passes through; Enter (or a second click on the last point) ends
 * it. A click back on the first point (with three or more) closes the spline
 * into a loop (P4-12). Esc takes back the last point.
 *
 * The spline is one entity over its fit points (ADR-0014); its shape comes
 * from `fitSpline`, so the preview is the curve that will be stored. Each
 * fit point keeps what it snapped to, so a spline can start and end on
 * other curves.
 */
import {
  closedFitSpline,
  fitSpline,
  type SketchEntityId,
  splinePolyline,
  type Vec2,
} from '@extrudo/core';
import { addPoint, place } from '@extrudo/sketch/build';
import type { Inference } from '@extrudo/sketch/inference';
import {
  EMPTY_PREVIEW,
  emptyEdit,
  type HeadsUpField,
  type SketchEdit,
  type SketchTool,
  type ToolContext,
  type ToolPreview,
} from './tool';

export const SPLINE_TOOL = 'spline';

export class SplineTool implements SketchTool {
  readonly id = SPLINE_TOOL;
  #clicks: Inference[] = [];
  #pointer: Inference | undefined;

  constructor(private readonly context: ToolContext) {}

  prompt(): string {
    const n = this.#clicks.length;
    return n === 0
      ? 'Click the first point of the spline.'
      : n === 1
        ? 'Click the next point.'
        : 'Click the next point, Enter to finish, or the first point to close it.';
  }

  anchor(): Vec2 | undefined {
    return this.#clicks.at(-1)?.point;
  }

  move(pointer: Inference): void {
    this.#pointer = pointer;
  }

  click(pointer: Inference): SketchEdit | undefined {
    this.#pointer = pointer;
    const last = this.#clicks.at(-1)?.point;
    if (last && Math.hypot(pointer.point[0] - last[0], pointer.point[1] - last[1]) < 1e-9) {
      // A second click on the last point finishes, like a double-click.
      return this.#finish();
    }
    if (closesOn(this.context, this.#clicks, pointer)) return this.#finish(true);
    this.#clicks.push(pointer);
    return undefined;
  }

  enter(): SketchEdit | undefined {
    return this.#finish();
  }

  fields(): HeadsUpField[] {
    return [];
  }

  lock(): void {}

  escape(): boolean {
    if (this.#clicks.length === 0) return true;
    this.#clicks.pop();
    return false;
  }

  preview(): ToolPreview {
    const points = this.#clicks.map((c) => c.point);
    const pointer = this.#pointer?.point;
    const last = points.at(-1);
    const through =
      pointer && !(last && last[0] === pointer[0] && last[1] === pointer[1])
        ? [...points, pointer]
        : points;
    if (through.length === 0) return EMPTY_PREVIEW;
    if (through.length === 1) return { lines: [], points };
    if (pointer && this.#pointer && closesOn(this.context, this.#clicks, this.#pointer)) {
      return { lines: [], polylines: [splinePolyline(closedFitSpline(points))], points };
    }
    return { lines: [], polylines: [splinePolyline(fitSpline(through))], points };
  }

  #finish(closed = false): SketchEdit | undefined {
    if (this.#clicks.length < 2) return undefined;
    const ctx = this.context;
    const edit = emptyEdit();
    const points = this.#clicks.map((c) => addPoint(edit, ctx, c.point));
    this.#clicks.forEach((c, i) => {
      const previous = points[i - 1];
      place(edit, ctx, c, points[i] as SketchEntityId, previous ? { point: previous } : {});
    });
    const id = ctx.newId() as SketchEntityId;
    edit.entities[id] = {
      type: 'spline',
      points,
      ...(closed ? { closed: true } : {}),
      construction: ctx.construction(),
    };
    this.#clicks = [];
    return edit;
  }
}

/**
 * Whether a click closes a spline being drawn (P4-12): it lands on the first
 * point (within the snap distance) once there are three points or more.
 */
export function closesOn(
  context: ToolContext,
  clicks: readonly Inference[],
  pointer: Inference,
): boolean {
  const first = clicks[0]?.point;
  if (!first || clicks.length < 3) return false;
  const near = Math.max(1e-9, context.snapDistance?.() ?? 0);
  return Math.hypot(pointer.point[0] - first[0], pointer.point[1] - first[1]) <= near;
}
