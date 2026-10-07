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
import type { Inference, ModelAttachment, ModelSnap, PickFilter } from '@extrudo/sketch/inference';

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
  /**
   * Points placed on a body edge or vertex (auto-project, P6-07): the host
   * projects the ref in the same undo step and holds the point on the
   * projected geometry. A picking tool (P6-07 slice 2) instead gives the
   * `placeholder` ID its constraint or dimension used for that geometry.
   */
  models?: ModelAttachment[];
  /**
   * Where a dimension's label was placed (P6-07 slice 2): a dimension to
   * model geometry waits for the kernel's report, and the host recomputes
   * the label from here once the projected entity lands.
   */
  cursor?: Vec2;
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
  /** The body edge or vertex a click would pick (P6-07 slice 2), drawn like a snap. */
  modelHover?: ModelSnap;
  /** The body edges or vertices already picked, drawn like a snap. */
  modelPicked?: ModelSnap[];
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
  /**
   * The body edge or vertex under the pointer (auto-project, P6-07), in sketch
   * coordinates. `undefined` with the preference off, with no body under the
   * pointer or when the view offers no model geometry.
   */
  model(): ModelSnap | undefined;
  /**
   * The body edge or vertex `cursor` is over, offered to a picking tool
   * (auto-project, P6-07 slice 2). `undefined` with the preference off, when
   * a sketch entity is within the snap distance (the sketch's own geometry
   * always wins), or when no body edge or vertex is near. `entityId` is the
   * projected entity when the sketch already projects that ref.
   */
  pickModel(cursor: Vec2): ModelPick | undefined;
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

/**
 * A body edge or vertex a picking tool may pick (auto-project, P6-07
 * slice 2): the model snap plus, when the sketch already projects that ref,
 * the projected entity to use as an ordinary sketch entity.
 */
export interface ModelPick extends ModelSnap {
  entityId?: SketchEntityId;
}

export function emptyEdit(): SketchEdit {
  return { entities: {}, constraints: {}, dimensions: {}, auto: [] };
}

/** The stand-in sketch entity and IDs a picking tool uses for a model snap. */
export interface ModelStandIn {
  /** The entity the tool's rules test and its constraint or dimension names. */
  id: SketchEntityId;
  entity: SketchEntity;
  /** Every stand-in entity, the line and its two ends included, for measuring until the exact curve lands. */
  synthetic: Record<SketchEntityId, SketchEntity>;
}

/**
 * A body vertex stands in as a point, a body edge as a straight line between
 * its display polyline's ends (P6-07 slice 2): enough for a picking tool to
 * tell the kinds apart and choose a dimension, until the kernel reports the
 * exact curve. A curved edge's stand-in is approximate; the value is
 * measured again once the projection lands.
 */
export function modelStandIn(context: ToolContext, snap: ModelSnap): ModelStandIn {
  const id = context.newId() as SketchEntityId;
  if (snap.kind === 'vertex') {
    const entity: SketchEntity = { type: 'point', x: snap.point[0], y: snap.point[1] };
    return { id, entity, synthetic: { [id]: entity } };
  }
  const [a, b] = snap.line ?? [snap.point, snap.point];
  const start = context.newId() as SketchEntityId;
  const end = context.newId() as SketchEntityId;
  const synthetic: Record<SketchEntityId, SketchEntity> = {
    [start]: { type: 'point', x: a[0], y: a[1] },
    [end]: { type: 'point', x: b[0], y: b[1] },
    [id]: { type: 'line', start, end, construction: false },
  };
  return { id, entity: synthetic[id] as SketchEntity, synthetic };
}

/** The model attachments for the picks a tool made (only those on body geometry). */
export function modelAttachments(
  picks: readonly { id: SketchEntityId; model?: ModelSnap }[],
): ModelAttachment[] {
  return picks
    .filter((p): p is { id: SketchEntityId; model: ModelSnap } => p.model !== undefined)
    .map((p) => ({ placeholder: p.id, ref: p.model.ref, kind: p.model.kind }));
}
