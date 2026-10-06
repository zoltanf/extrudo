/**
 * The Control Point Spline and Conic tools (P4-05, FR-SK-03, ADR-0063 §4).
 *
 * - **Control Point Spline** (`splineControl`): each click adds a pole; the
 *   curve runs from the first pole to the last, tangent to the control polygon
 *   there, and does not pass through the poles between. Enter finishes, Esc
 *   takes back the last pole.
 * - **Conic** (`conic`): click the start, the end, then move and click the
 *   shoulder, where the end tangents meet. A unitless heads-up field "Rho"
 *   (default 0.5, 0.05 to 0.95) says how full the conic is, and stays for the
 *   next one, as the polygon's sides do.
 *
 * Both are one `spline` entity over their points, with a `mode`
 * (`sketch/schema.ts`); the shape comes from `controlSpline` and `conicSpline`,
 * so the preview is the curve that will be stored.
 */
import {
  closedControlSpline,
  conicSpline,
  controlSpline,
  type SketchEntityId,
  splinePolyline,
  type Vec2,
} from '@extrudo/core';
import { addPoint, place } from '@extrudo/sketch/build';
import type { Inference } from '@extrudo/sketch/inference';
import { closesOn } from './spline';
import {
  EMPTY_PREVIEW,
  emptyEdit,
  type HeadsUpField,
  type SketchEdit,
  type SketchTool,
  type ToolContext,
  type ToolPreview,
  type Typed,
} from './tool';

export const SPLINE_CONTROL_TOOL = 'splineControl';
export const CONIC_TOOL = 'conic';

/** A conic's default fullness, and the range the Rho field takes. */
export const DEFAULT_RHO = 0.5;
export const MIN_RHO = 0.05;
export const MAX_RHO = 0.95;

/** Whether a typed rho is one the tools and the panel take. */
export const inRhoRange = (rho: number): boolean => rho >= MIN_RHO && rho <= MAX_RHO;

/** The polyline of a spline mode's curve through the poles, for the preview. */
function previewCurve(mode: 'control' | 'conic', points: Vec2[], rho: number): Vec2[] {
  const spline =
    mode === 'control'
      ? controlSpline(points)
      : conicSpline(points[0] as Vec2, points[1] as Vec2, points[2] as Vec2, rho);
  return splinePolyline(spline, 8);
}

export class SplineControlTool implements SketchTool {
  readonly id = SPLINE_CONTROL_TOOL;
  #clicks: Inference[] = [];
  #pointer: Inference | undefined;

  constructor(private readonly context: ToolContext) {}

  prompt(): string {
    const n = this.#clicks.length;
    return n === 0
      ? 'Click the first control point.'
      : n === 1
        ? 'Click the next control point.'
        : 'Click the next control point, Enter to finish, or the first one to close it.';
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
      // A second click on the last pole finishes, like a double-click.
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
    const poles =
      pointer && !(last && last[0] === pointer[0] && last[1] === pointer[1])
        ? [...points, pointer]
        : points;
    if (poles.length === 0) return EMPTY_PREVIEW;
    if (poles.length === 1) return { lines: [], points };
    if (this.#pointer && closesOn(this.context, this.#clicks, this.#pointer)) {
      return { lines: [], polylines: [splinePolyline(closedControlSpline(points), 8)], points };
    }
    return { lines: [], polylines: [previewCurve('control', poles, DEFAULT_RHO)], points };
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
      mode: 'control',
      ...(closed ? { closed: true } : {}),
      construction: ctx.construction(),
    };
    this.#clicks = [];
    return edit;
  }
}

export class ConicTool implements SketchTool {
  readonly id = CONIC_TOOL;
  #clicks: Inference[] = [];
  #pointer: Inference | undefined;
  /** The typed rho; kept for the next conic, as the polygon's sides are. */
  #rho: Typed | undefined;

  constructor(private readonly context: ToolContext) {}

  /** The rho the next conic gets: the typed one, or the default. */
  get rho(): number {
    return this.#rho?.value ?? DEFAULT_RHO;
  }

  prompt(): string {
    return [
      'Click the start of the conic.',
      'Click the end of the conic.',
      'Click the shoulder, where the end tangents meet (Tab: rho).',
    ][this.#clicks.length] as string;
  }

  anchor(): Vec2 | undefined {
    return this.#clicks.length === 1 ? this.#clicks[0]?.point : undefined;
  }

  move(pointer: Inference): void {
    this.#pointer = pointer;
  }

  click(pointer: Inference): SketchEdit | undefined {
    this.#pointer = pointer;
    if (this.#clicks.length < 2) {
      const first = this.#clicks[0]?.point;
      if (first && Math.hypot(pointer.point[0] - first[0], pointer.point[1] - first[1]) < 1e-9) {
        return undefined;
      }
      this.#clicks.push(pointer);
      return undefined;
    }
    return this.#finish();
  }

  enter(): SketchEdit | undefined {
    return this.#clicks.length === 2 ? this.#finish() : undefined;
  }

  fields(): HeadsUpField[] {
    if (this.#clicks.length === 0) return [];
    return [{ name: 'rho', label: 'Rho', kind: 'unitless', value: this.rho, locked: this.#rho }];
  }

  lock(name: string, typed: Typed | undefined): void {
    if (name !== 'rho') return;
    this.#rho = typed && inRhoRange(typed.value) ? typed : undefined;
  }

  escape(): boolean {
    if (this.#rho) {
      this.#rho = undefined;
      return false;
    }
    if (this.#clicks.length > 0) {
      this.#clicks.pop();
      return false;
    }
    return true;
  }

  preview(): ToolPreview {
    const [start, end] = this.#clicks.map((c) => c.point);
    if (!start) return EMPTY_PREVIEW;
    if (!end)
      return { lines: [], guides: [[start, this.#pointer?.point ?? start]], points: [start] };
    const shoulder = this.#shoulder();
    if (!shoulder) return { lines: [], guides: [[start, end]], points: [start, end] };
    const rho = this.rho;
    return {
      lines: [],
      polylines: [previewCurve('conic', [start, end, shoulder], rho)],
      // The control polygon, so the user sees where the shoulder puts the curve.
      guides: [
        [start, shoulder],
        [shoulder, end],
      ],
      points: [start, end, shoulder],
    };
  }

  /** Where the shoulder is: the pointer, or the midpoint of a straight conic. */
  #shoulder(): Vec2 | undefined {
    const [start, end] = this.#clicks.map((c) => c.point);
    if (!start || !end) return undefined;
    const pointer = this.#pointer?.point;
    if (pointer) return pointer;
    return [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  }

  #finish(): SketchEdit | undefined {
    const [start, end] = this.#clicks.map((c) => c.point);
    const shoulder = this.#shoulder();
    if (!start || !end || !shoulder) return undefined;
    // A degenerate conic: its two ends in one place, or its shoulder on the
    // chord between them, which would be a straight line.
    const chord: Vec2 = [end[0] - start[0], end[1] - start[1]];
    const span = Math.hypot(chord[0], chord[1]);
    if (span < 1e-9) return undefined;
    const toShoulder: Vec2 = [shoulder[0] - start[0], shoulder[1] - start[1]];
    const across = Math.abs((chord[0] * toShoulder[1] - chord[1] * toShoulder[0]) / span);
    if (across < 1e-6 * span) return undefined;

    const ctx = this.context;
    const edit = emptyEdit();
    const points = [start, end, shoulder].map((p) => addPoint(edit, ctx, p));
    const [startId, endId, shoulderId] = points as [SketchEntityId, SketchEntityId, SketchEntityId];
    this.#clicks.forEach((c, i) => {
      const previous = points[i - 1];
      place(edit, ctx, c, points[i] as SketchEntityId, previous ? { point: previous } : {});
    });
    const id = ctx.newId() as SketchEntityId;
    edit.entities[id] = {
      type: 'spline',
      points: [startId, shoulderId, endId],
      mode: 'conic',
      rho: this.rho,
      construction: ctx.construction(),
    };
    this.#clicks = [];
    return edit;
  }
}
