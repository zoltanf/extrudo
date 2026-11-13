/**
 * A sheet's views as the kernel draws them (P6-24 S2, plan §6): what each view asks
 * `Recomputer.sheetViews` for, and the result turned into the `SheetViewLines` that
 * `layoutSheet` draws. Pure: the view runner (`viewRunner.ts`) and the tests call these.
 * The requests and the lines are the kernel's since S6 (`kernel/src/sheets/lines.ts`, so
 * the CLI draws views the same way), re-exported here; the rest is the screen's.
 *
 * - A view's request has its frame (`sheetViewFrame`, through its parents) and always an
 *   explicit list of bodies: its base view's `bodies`, or every body the model shows (not
 *   hidden, not a ghost: `shownBodies`), so a body hidden or shown later asks again.
 * - The request's `key` names what the lines depend on besides the bodies' versions:
 *   direction, up and bodies. Scale, position and style are not in it (they are applied
 *   on the sheet, so changing them computes nothing).
 */
import type { BodyId, ExtrudoDocument } from '@extrudo/core';
import type { ViewGeometry } from '@extrudo/kernel';

// Moved to the kernel (S6), so the CLI asks for views and draws their lines as this mode does.
export {
  baseViewOf,
  pieceContour,
  type SheetViewWant,
  sheetViewLines,
  sheetViewWant,
  sheetViewWants,
} from '@extrudo/kernel';

/**
 * Whether lines drawn from `versions` (a result's) are the model's now (`current`: each
 * body's version at the marker). A body the result skipped as missing must still be
 * missing; one it skipped as a mesh body is not drawn, so its version does not matter.
 */
export function linesAreCurrent(
  geometry: ViewGeometry,
  versions: Readonly<Record<BodyId, string>>,
  current: Readonly<Record<BodyId, string>>,
): boolean {
  for (const [id, version] of Object.entries(versions)) {
    if (current[id as BodyId] !== version) return false;
  }
  return geometry.skipped.every((s) => s.reason !== 'missing' || current[s.body] === undefined);
}

/**
 * What a view says on screen about its bodies (plan §4.6), or `undefined`: a chosen body
 * that is gone ("Box is gone. Choose bodies or delete the view."), a mesh body ("Mesh
 * bodies can't be drawn yet."), nothing to draw ("No shown bodies to draw.").
 */
export function sheetViewNotice(
  doc: Pick<ExtrudoDocument, 'bodies'>,
  geometry: ViewGeometry,
): string | undefined {
  const missing = geometry.skipped.filter((s) => s.reason === 'missing');
  if (missing.length > 0) {
    const names = missing.map((s) => doc.bodies[s.body]?.name ?? 'A body');
    const which =
      names.length === 1
        ? `${names[0]} is gone`
        : `${names.slice(0, -1).join(', ')} and ${names.at(-1)} are gone`;
    return `${which}. Choose bodies or delete the view.`;
  }
  if (geometry.skipped.some((s) => s.reason === 'mesh')) return "Mesh bodies can't be drawn yet.";
  if (geometry.curves.length === 0) return 'No shown bodies to draw.';
  return undefined;
}
