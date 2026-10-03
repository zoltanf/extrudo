/**
 * Press Pull (P3-08, ADR-0051, FR-FT-08): one command, Q, that does what
 * pushing or pulling the selected thing ought to do. It is not a feature of
 * its own: it opens the dialog of the feature that fits the selection, with
 * the selection already in its first field (pre-selection, ADR-0027).
 *
 * - a sketch **profile** or a whole **text** (P4-03) is extruded (the
 *   Extrude dialog proposes a new body, or join and cut on a body's face:
 *   `features/operation.ts`);
 * - a **face** of a body moves along its normal (Offset Face: a flat face
 *   grows or sinks like a pad, a curved wall changes its radius, the faces
 *   next to it follow). Extrude's own press-pull on a face (E) stays for
 *   when the pulled face should sweep a prism with the faces around it left
 *   alone;
 * - an **edge** is rounded (Fillet).
 *
 * With several kinds selected a profile wins over a face over an edge.
 */
import type { ExtrudoDocument, SelectionItem } from '@extrudo/core';
import { parseSketchEntityRefId, readSketch } from '@extrudo/core';

/** The tool a Press Pull opens. */
export type PressPullTarget = 'extrude' | 'offsetFace' | 'fillet';

/** The command ID of Press Pull (a wedge of the marking menu, and the key Q). */
export const PRESS_PULL = 'pressPull';

/**
 * What Press Pull does with this selection, or undefined when nothing in it
 * can be pushed or pulled. The document is what tells a whole text (P4-03)
 * from a sketch curve: a text is extruded, like a profile.
 */
export function pressPullTarget(
  selection: readonly SelectionItem[],
  doc?: ExtrudoDocument,
): PressPullTarget | undefined {
  const has = (kind: SelectionItem['kind']) => selection.some((item) => item.kind === kind);
  if (has('profile')) return 'extrude';
  if (has('sketchEntity') && doc && textOf(selection, doc)) return 'extrude';
  if (has('face')) return 'offsetFace';
  if (has('edge')) return 'fillet';
  return undefined;
}

/** Whether a `sketchEntity` item of the selection names a text entity (P4-03). */
function textOf(selection: readonly SelectionItem[], doc: ExtrudoDocument): boolean {
  for (const item of selection) {
    if (item.kind !== 'sketchEntity') continue;
    const ref = parseSketchEntityRefId(item.id);
    const feature = ref && doc.features.find((f) => f.id === ref.feature);
    if (feature && readSketch(feature)?.data.entities[ref?.entity ?? '']?.type === 'text') {
      return true;
    }
  }
  return false;
}

/** What Press Pull says when the selection has nothing to push or pull (FR-UX-06 style). */
export const PRESS_PULL_PROMPT =
  'Select a face to move, an edge to round or a sketch profile to extrude, then press Q.';
