/**
 * Framing for a design's thumbnail (ADR-0009's amendment, 2026-10-09). A
 * thumbnail is framed for itself, not cut from what the person is looking at:
 * the current orientation and projection, aspect 1, no shift, the shown
 * bounds centred with a margin on each side.
 */
import { fitBox, type Projection, type Vec3, type View, withShift } from './camera';

/** The share of the picture left empty on each side of the model. */
export const THUMBNAIL_MARGIN = 0.12;

/** The view a square thumbnail is drawn from: `view`'s orientation, fitted to the box. */
export function thumbnailView(
  view: View,
  box: { min: Vec3; max: Vec3 },
  projection: Projection,
): View {
  // fitBox leaves `margin` times the needed height; 12 % per side leaves 76 % for the model.
  const margin = 1 / (1 - 2 * THUMBNAIL_MARGIN);
  return withShift(fitBox(view, box.min, box.max, 1, projection, margin), 0);
}
