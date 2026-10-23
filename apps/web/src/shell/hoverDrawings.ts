/**
 * The session's hover on the view's sketches (ADR-0102 §3): the shell builds
 * the sketch drawings without it and the view's wrapper (`DialogViewport`)
 * adds it, so a hover re-renders the view, not the whole shell.
 */
import type { FeatureId, SelectionItem } from '@extrudo/core';
import { sketchEntityIdsIn } from '../selection/items';
import { profileIdsIn } from '../sketch/profiles';
import type { SketchDrawing } from '../viewport/sketchGeometry';

/**
 * `sketches` with the hover marked: a sketch in `hovered` (its timeline chip
 * or browser row, or its group's) is highlighted; a shown sketch's curve or
 * region under the pointer is its `hoverEntity` / `hoverProfile` (curves only
 * on sketches not being edited). Untouched sketches keep their objects, and
 * with nothing marked the same array comes back.
 */
export function sketchesWithHover(
  sketches: readonly SketchDrawing[],
  hover: SelectionItem | undefined,
  hovered: ReadonlySet<FeatureId>,
): readonly SketchDrawing[] {
  if (!hover) return sketches;
  let changed = false;
  const out = sketches.map((sketch) => {
    const id = sketch.id as FeatureId;
    const highlight = hovered.has(id);
    const hoverEntity = sketch.active ? undefined : sketchEntityIdsIn([hover], id)[0];
    const hoverProfile = sketch.profiles ? profileIdsIn([hover], id)[0] : undefined;
    if (!highlight && hoverEntity === undefined && hoverProfile === undefined) return sketch;
    changed = true;
    return {
      ...sketch,
      ...(highlight && { highlight }),
      ...(hoverEntity !== undefined && { hoverEntity }),
      ...(hoverProfile !== undefined && { hoverProfile }),
    };
  });
  return changed ? out : sketches;
}
