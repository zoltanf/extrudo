/**
 * The sketch tool framework (P1-02, ADR-0012). A tool is a small state
 * machine in plain TypeScript: the host (`host.ts`) feeds it inferred
 * pointer positions and keys, and asks it for a preview, heads-up fields
 * and, on a click or Enter, a `SketchEdit` to commit. Tools never touch the
 * stores, so they run in unit tests as they are.
 */
import type {
  ConstraintId,
  DimensionId,
  SketchConstraint,
  SketchData,
  SketchDimension,
  SketchEntity,
  SketchEntityId,
  Vec2,
} from '@extrudo/core';
import type { Inference } from '@extrudo/sketch/inference';

export type FieldKind = 'length' | 'angle';

/** A value typed into the heads-up box: the expression and its value in base units (mm, degrees). */
export interface Typed {
  expr: string;
  value: number;
}

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
   * Inferred constraints (keys of `constraints`). The host test-solves each
   * and drops those that would conflict or be redundant; the others must hold.
   */
  auto: ConstraintId[];
}

/** Rubber-band geometry in sketch coordinates. */
export interface ToolPreview {
  lines: (readonly [Vec2, Vec2])[];
  points: Vec2[];
}

export interface ToolContext {
  /** The sketch as it is now. */
  sketch(): SketchData;
  newId(): string;
}

export interface SketchTool {
  readonly id: string;
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
}

export const EMPTY_PREVIEW: ToolPreview = { lines: [], points: [] };

export function emptyEdit(): SketchEdit {
  return { entities: {}, constraints: {}, dimensions: {}, auto: [] };
}

/** Adds constraints to an edit, marking them as inferred when `auto`. */
export function constrain(
  edit: SketchEdit,
  context: ToolContext,
  constraints: readonly SketchConstraint[],
  auto: boolean,
): void {
  for (const c of constraints) {
    const id = context.newId() as ConstraintId;
    edit.constraints[id] = c;
    if (auto) edit.auto.push(id);
  }
}
