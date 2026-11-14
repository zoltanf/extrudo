/**
 * PartDesign's Hole (ADR-0144 S7) as Extrudo's `hole`: one hole at each
 * centre the profile sketch gives (its circles' and arcs' centres, and its
 * points where `BaseProfileType` says so), referred to as the sketch's own
 * points, on the sketch's plane, drilling against the sketch's normal
 * (`Reversed` along it). The sizes are what the file stores, never a thread
 * or screw table's (those changed between FreeCAD versions).
 */
import type { Design } from '@extrudo/api';
import { type GeomRef, holeInputs, type SketchEntityId, sketchEntityRefId } from '@extrudo/core';
import type { DecodedHole } from './features';
import type { DecodedSketch } from './sketch-decode';
import type { AddSketchResult } from './sketches';

/** The most centres one hole may drill at: Extrudo's own `MAX_HOLES` (a test keeps them equal). */
export const MAX_HOLE_CENTRES = 200;

const literal = (v: number) => `${Number(v.toPrecision(15))}`;

/** What adding a hole came to. */
export type HoleAdded =
  | { readonly feature: string; readonly centres: number }
  | { readonly stop: 'sketch' | 'limit' | 'failed'; readonly detail: string };

/** The geometry indices a hole drills at, in the sketch's order. */
export function holeCentres(
  hole: DecodedHole,
  sketch: DecodedSketch,
): number[] | { stop: 'sketch' | 'limit'; detail: string } {
  const out: number[] = [];
  for (let i = 0; i < sketch.geometry.length; i++) {
    const g = sketch.geometry[i];
    // FreeCAD drills at the drawn geometry only (the sketch's shape leaves construction out).
    if (g === undefined || g.construction || g.internal !== 0) continue;
    if (
      (g.kind === 'circle' && hole.on.circles) ||
      (g.kind === 'arc' && hole.on.arcs) ||
      (g.kind === 'point' && hole.on.points)
    ) {
      out.push(i);
      if (out.length > MAX_HOLE_CENTRES)
        return { stop: 'limit', detail: `its sketch has more than ${MAX_HOLE_CENTRES} centres` };
    }
  }
  if (out.length === 0) return { stop: 'sketch', detail: 'its sketch has no circle to drill at' };
  return out;
}

/**
 * Adds one hole for `hole`, its cut taken as `cut` (a file that doesn't say
 * which tries counterbore, then countersink: the walk's second attempt).
 */
export function addHole(
  design: Design,
  hole: DecodedHole,
  sketch: Extract<AddSketchResult, { imported: true }>,
  decoded: DecodedSketch,
  cut: 'none' | 'counterbore' | 'countersink',
  name: string,
): HoleAdded {
  const centres = holeCentres(hole, decoded);
  if (!Array.isArray(centres)) return centres;
  const points: GeomRef[] = [];
  for (const i of centres) {
    const p = sketch.centres[i];
    if (p === undefined)
      return {
        stop: 'sketch',
        detail: `a centre it drills at (geometry ${i + 1}) didn't come in with the sketch`,
      };
    points.push({ kind: 'sketchEntity', id: sketchEntityRefId(sketch.id, p as SketchEntityId) });
  }
  const numbers: Record<string, string> = { diameter: `${literal(hole.diameter)} mm` };
  if (hole.extent === 'blind') {
    numbers.depth = `${literal(hole.depth as number)} mm`;
    numbers.tipAngle = `${literal(hole.tipAngle)} deg`;
  }
  if (cut === 'counterbore') {
    numbers.cbDiameter = `${literal(hole.cutDiameter as number)} mm`;
    numbers.cbDepth = `${literal(hole.cutDepth as number)} mm`;
  } else if (cut === 'countersink') {
    numbers.csDiameter = `${literal(hole.cutDiameter as number)} mm`;
    numbers.csAngle = `${literal(hole.cutAngle as number)} deg`;
  }
  // Extrudo drills against its plane's normal; FreeCAD against the sketch's, which a turned-over
  // plane has the other way.
  const flip = hole.reversed !== sketch.outcome.mirrored;
  try {
    const inputs = holeInputs({
      plane: sketch.plane,
      points,
      numbers,
      type: cut === 'none' ? 'simple' : cut,
      extent: hole.extent,
      ...(flip ? { flip: true } : {}),
    });
    return { feature: design.add('hole', inputs, { name }).id, centres: points.length };
  } catch (error) {
    return { stop: 'failed', detail: `Extrudo refused it: ${(error as Error).message}` };
  }
}
