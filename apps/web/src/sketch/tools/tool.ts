/**
 * The sketch tool framework (P1-02, ADR-0012). A tool is a small state
 * machine in plain TypeScript: the host (`host.ts`) feeds it inferred
 * pointer positions and keys, and asks it for a preview, heads-up fields
 * and, on a click or Enter, a `SketchEdit` to commit. Tools never touch the
 * stores, so they run in unit tests as they are.
 */
import {
  type ConstraintId,
  type DimensionId,
  type LengthUnit,
  type SketchChange,
  type SketchConstraint,
  type SketchData,
  type SketchDimension,
  type SketchEntity,
  type SketchEntityId,
  UNITS,
  type Vec2,
} from '@extrudo/core';
import type { Typed } from '@extrudo/sketch/build';
import type { Inference, PickFilter } from '@extrudo/sketch/inference';

export type { Typed };

/** Lengths in mm, angles in degrees; unitless fields are counts (a polygon's sides). */
export type FieldKind = 'length' | 'angle' | 'unitless';

/** A heads-up field (FR-SK-06): the live measurement, or the typed value that locks it. */
export interface HeadsUpField {
  name: string;
  label: string;
  kind: FieldKind;
  /** The measured value, mm or degrees. */
  value: number;
  locked?: Typed;
}

/** What a tool adds to the sketch, with new IDs from `ToolContext.newId`. */
export interface SketchEdit {
  entities: Record<SketchEntityId, SketchEntity>;
  constraints: Record<ConstraintId, SketchConstraint>;
  dimensions: Record<DimensionId, SketchDimension>;
  /**
   * Inferred constraints (keys of `constraints`), and optional dimensions
   * (keys of `dimensions`: an offset's later distances). The host
   * test-solves each in order and drops those that would conflict or be
   * redundant; the others must hold.
   */
  auto: string[];
  /**
   * Constraints and dimensions the user asked for (the constraint tools,
   * P1-06; the Dimension tool, P1-07). The host test-solves each. It refuses
   * the whole edit, with a message, if a constraint conflicts or is
   * redundant; a dimension that would over-constrain the sketch waits for
   * the user to add it as driven or drop it (P1-08).
   */
  verify?: string[];
  /** A new dimension whose value to edit once the edit is in (the Dimension tool). */
  editDimension?: DimensionId;
  /**
   * What the modify tools (P1-10) change besides adding: existing entities
   * replaced (`update`), constraints and dimensions changed in place
   * (`replace`), things removed (Fix on something fixed frees it), and
   * existing dimensions' new expressions (`exprs`). As `modifySketch` takes them.
   */
  update?: SketchChange['update'];
  replace?: SketchChange['replace'];
  remove?: SketchChange['remove'];
  exprs?: SketchChange['exprs'];
  /** New dimensions whose expression is another new dimension's parameter. */
  links?: Record<DimensionId, DimensionId>;
  /** Points the solve must leave where the edit put them (Scale); otherwise nothing changes. */
  hold?: SketchEntityId[];
  /** Move the entities by `by`, the rest following, as a drag does (the Move tool). */
  move?: { entities: SketchEntityId[]; by: Vec2 };
  /** The undo step's name ("Trim"); a plain addition is "Draw". */
  label?: string;
  /** Why the click changes nothing, for the prompt. */
  error?: string;
}

/** A circle (no `from`/`sweep`) or a counter-clockwise arc, radians. */
export interface PreviewArc {
  center: Vec2;
  radius: number;
  from?: number;
  sweep?: number;
}

/** Rubber-band geometry in sketch coordinates. */
export interface ToolPreview {
  lines: (readonly [Vec2, Vec2])[];
  arcs?: PreviewArc[];
  points: Vec2[];
  /** Helper lines drawn thin and dashed (a radius, a center rectangle's diagonal). */
  guides?: (readonly [Vec2, Vec2])[];
  /** Curves given as points (an ellipse, a spline), drawn like lines. */
  polylines?: Vec2[][];
  /** Construction curves the tool adds whatever the X toggle says (a polygon's circle). */
  constructionArcs?: PreviewArc[];
  /** Sketch entities already picked (the constraint tools), drawn highlighted. */
  picked?: SketchEntityId[];
  /** The entity a click would pick, drawn in the pre-selection colour. */
  hover?: SketchEntityId;
  /** What a click would take away (Trim), drawn in the error colour. */
  removed?: Vec2[][];
  /** What a click would single out or add (Break's piece, Extend's extension), in the accent colour. */
  accent?: Vec2[][];
  /** A dimension being placed (P1-07), drawn like the sketch's own. */
  dimension?: SketchDimension;
}

export interface ToolContext {
  /** The sketch as it is now. */
  sketch(): SketchData;
  newId(): string;
  /** Whether new curves are construction geometry (the X toggle, FR-SK-04). */
  construction(): boolean;
  /** The document's length unit and display precision (new dimensions' values). */
  settings(): { units: LengthUnit; precision: number };
  /**
   * The entity under `cursor` that `accept` allows, within the snap distance
   * of the last pointer (points first; `pickEntity`).
   */
  pick(cursor: Vec2, accept?: PickFilter): SketchEntityId | undefined;
  /** The open sketch's selected points and curves (P1-09), which the modify tools start from. */
  selection(): SketchEntityId[];
  /**
   * The snap distance in mm at the last pointer's zoom (a few pixels): how near
   * a click must land to a point the tool holds itself (a spline's first point
   * closes it, P4-12). Absent in tests that draw without a view.
   */
  snapDistance?(): number;
}

/** A length in mm as a dimension expression in the document's unit, rounded to its precision. */
export function lengthExpr(context: ToolContext, mm: number): string {
  const { units, precision } = context.settings();
  const factor = UNITS[units]?.factor ?? 1;
  return String(Number((mm / factor).toFixed(precision)) + 0);
}

/** A length in mm rounded to the document's precision in its unit (a tool's suggested size). */
export function roundLength(context: ToolContext, mm: number): number {
  const factor = UNITS[context.settings().units]?.factor ?? 1;
  return Number(lengthExpr(context, mm)) * factor;
}

export interface SketchTool {
  readonly id: string;
  /**
   * The tool picks existing entities rather than placing points (the
   * constraint tools): the host runs no inference, so pointers carry the
   * bare cursor and nothing snaps.
   */
  readonly picks?: boolean;
  /** One line for the status prompt: what the next click does. */
  prompt(): string;
  /** Where alignment guides start: the tool's last point. */
  anchor(): Vec2 | undefined;
  move(pointer: Inference): void;
  /** A click at the pointer; returns an edit when the click completes some geometry. */
  click(pointer: Inference): SketchEdit | undefined;
  /** Enter: completes the geometry at the last pointer, with the typed values. */
  enter(): SketchEdit | undefined;
  fields(): HeadsUpField[];
  /** Locks a field to a typed value, or unlocks it. */
  lock(name: string, typed: Typed | undefined): void;
  /** Esc: steps back one stage. True when there was nothing left to cancel. */
  escape(): boolean;
  preview(): ToolPreview;
  /**
   * The pointer was pressed at `pointer` and dragged (P1-04: the Line tool's
   * tangent arc). True if the tool takes the drag: moves go to `move` and the
   * release to `dragEnd`. Tools without it ignore drags.
   */
  dragStart?(pointer: Inference): boolean;
  /** The dragged pointer was released; returns an edit like `click`. */
  dragEnd?(pointer: Inference): SketchEdit | undefined;
}

export const EMPTY_PREVIEW: ToolPreview = { lines: [], points: [] };

export function emptyEdit(): SketchEdit {
  return { entities: {}, constraints: {}, dimensions: {}, auto: [] };
}
