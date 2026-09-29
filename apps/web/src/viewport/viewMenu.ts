/**
 * What the view asks of the shell on a right-click without movement
 * (P3-11, ADR-0042): the view knows what is under the pointer, the shell
 * knows the commands, the selection and the actions. The view hands over the
 * request and draws whatever comes back as a marking menu.
 */
import type { SelectionItem } from '@extrudo/core';
import type { MarkingEntry, MarkingSlot } from '../design-system';

export interface ViewMenuRequest {
  mode: 'model' | 'sketch';
  /** Model mode: the item the pointer is over (what a click would select), if any. */
  top?: SelectionItem;
  /** Model mode: the stack under the pointer, front first ("Select other…"'s rows). */
  stack: readonly SelectionItem[];
}

export interface ViewMenuContent {
  /** The ring, or one plain list (the `marking.radial` preference). */
  radial: boolean;
  /** Eight wedges clockwise from the top. */
  slots: readonly (MarkingSlot | undefined)[];
  /** The list under the ring; the view adds "Select other…" on top when there is a stack. */
  entries: readonly MarkingEntry[];
}

/** The shell's side of the marking menu; absent where the view keeps its plain "Select other…". */
export interface ViewMenu {
  /**
   * Called on a right-click without movement, at `at` (window px); may select what is
   * under the pointer.
   */
  open(request: ViewMenuRequest, at: { x: number; y: number }): ViewMenuContent | undefined;
}
