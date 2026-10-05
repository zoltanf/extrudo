/**
 * The Point tool (P1-04, FR-SK-02): each click adds a sketch point, for
 * construction and hole centers. A point placed on a curve or another point
 * keeps that relation as a constraint.
 */
import type { Vec2 } from '@extrudo/core';
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

export const POINT_TOOL = 'point';

export class PointTool implements SketchTool {
  readonly id = POINT_TOOL;
  #pointer: Inference | undefined;

  constructor(private readonly context: ToolContext) {}

  prompt(): string {
    return 'Click to place a point.';
  }

  anchor(): Vec2 | undefined {
    return undefined;
  }

  move(pointer: Inference): void {
    this.#pointer = pointer;
  }

  click(pointer: Inference): SketchEdit {
    this.#pointer = pointer;
    const edit = emptyEdit();
    const id = addPoint(edit, this.context, pointer.point);
    place(edit, this.context, pointer, id);
    return edit;
  }

  enter(): undefined {
    return undefined;
  }

  fields(): HeadsUpField[] {
    return [];
  }

  lock(): void {}

  escape(): boolean {
    return true;
  }

  preview(): ToolPreview {
    return this.#pointer ? { lines: [], points: [this.#pointer.point] } : EMPTY_PREVIEW;
  }
}
