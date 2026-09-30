/**
 * Press Pull (P3-08, ADR-0051, FR-FT-08): one command, Q, that does what
 * pushing or pulling the selected thing ought to do. It is not a feature of
 * its own: it opens the dialog of the feature that fits the selection, with
 * the selection already in its first field (pre-selection, ADR-0027).
 *
 * - a sketch **profile** is extruded (the Extrude dialog proposes a new
 *   body, or join and cut on a body's face: `features/operation.ts`);
 * - a **face** of a body moves along its normal (Offset Face: a flat face
 *   grows or sinks like a pad, a curved wall changes its radius, the faces
 *   next to it follow). Extrude's own press-pull on a face (E) stays for
 *   when the pulled face should sweep a prism with the faces around it left
 *   alone;
 * - an **edge** is rounded (Fillet).
 *
 * With several kinds selected a profile wins over a face over an edge.
 */
import type { SelectionItem } from '@extrudo/core';

/** The tool a Press Pull opens. */
export type PressPullTarget = 'extrude' | 'offsetFace' | 'fillet';

/** The command ID of Press Pull (a wedge of the marking menu, and the key Q). */
export const PRESS_PULL = 'pressPull';

/** What Press Pull does with this selection, or undefined when nothing in it can be pushed or pulled. */
export function pressPullTarget(selection: readonly SelectionItem[]): PressPullTarget | undefined {
  const has = (kind: SelectionItem['kind']) => selection.some((item) => item.kind === kind);
  if (has('profile')) return 'extrude';
  if (has('face')) return 'offsetFace';
  if (has('edge')) return 'fillet';
  return undefined;
}

/** What Press Pull says when the selection has nothing to push or pull (FR-UX-06 style). */
export const PRESS_PULL_PROMPT =
  'Select a face to move, an edge to round or a sketch profile to extrude, then press Q.';
