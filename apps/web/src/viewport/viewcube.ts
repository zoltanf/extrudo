/**
 * The ViewCube's geometry as data (UI spec §2, FR-VP-02): 26 view directions
 * (6 faces, 12 edges, 8 corners) and the 3 × 3 hotspot grid on each face.
 *
 * Z-up world: Front looks from −Y, Right from +X, Top from +Z.
 */
import type { Vec3 } from './camera';

export type FaceName = 'Top' | 'Bottom' | 'Front' | 'Back' | 'Left' | 'Right';

export interface CubeFace {
  name: FaceName;
  /** Outward normal: the direction from the target to the camera for this view. */
  normal: Vec3;
  /** World direction of the label's "right" on screen. */
  right: Vec3;
  /** World direction of the label's "down" on screen. */
  down: Vec3;
}

/**
 * Face frames. For each face the label reads upright in that face's standard
 * view (see `orientationFor`): side faces have +Z up, Top has +Y up, Bottom
 * has −Y up.
 */
export const FACES: readonly CubeFace[] = [
  { name: 'Front', normal: [0, -1, 0], right: [1, 0, 0], down: [0, 0, -1] },
  { name: 'Right', normal: [1, 0, 0], right: [0, 1, 0], down: [0, 0, -1] },
  { name: 'Back', normal: [0, 1, 0], right: [-1, 0, 0], down: [0, 0, -1] },
  { name: 'Left', normal: [-1, 0, 0], right: [0, -1, 0], down: [0, 0, -1] },
  { name: 'Top', normal: [0, 0, 1], right: [1, 0, 0], down: [0, -1, 0] },
  { name: 'Bottom', normal: [0, 0, -1], right: [1, 0, 0], down: [0, 1, 0] },
];

export type HotspotKind = 'face' | 'edge' | 'corner';

export interface Hotspot {
  /** "Top", "Top Front", "Top Front Right". Unique per direction. */
  name: string;
  kind: HotspotKind;
  /** Integer direction, each component −1, 0 or 1. */
  direction: Vec3;
}

/** Name of an integer direction: Top/Bottom, then Front/Back, then Left/Right. */
export function directionName(d: Vec3): string {
  const parts: string[] = [];
  if (d[2] !== 0) parts.push(d[2] > 0 ? 'Top' : 'Bottom');
  if (d[1] !== 0) parts.push(d[1] > 0 ? 'Back' : 'Front');
  if (d[0] !== 0) parts.push(d[0] > 0 ? 'Right' : 'Left');
  return parts.join(' ');
}

function hotspot(direction: Vec3): Hotspot {
  const nonZero = direction.filter((c) => c !== 0).length;
  const kind: HotspotKind = nonZero === 1 ? 'face' : nonZero === 2 ? 'edge' : 'corner';
  return { name: directionName(direction), kind, direction };
}

/**
 * The 3 × 3 grid of hotspots on a face, row by row from the top-left as the
 * face's label reads. The middle is the face itself, the sides are edges and
 * the four corners are corners.
 */
export function faceCells(face: CubeFace): Hotspot[] {
  const cells: Hotspot[] = [];
  for (const row of [-1, 0, 1]) {
    for (const col of [-1, 0, 1]) {
      const d = [0, 1, 2].map(
        (i) => (face.normal[i] ?? 0) + col * (face.right[i] ?? 0) + row * (face.down[i] ?? 0),
      ) as unknown as Vec3;
      cells.push(hotspot(d));
    }
  }
  return cells;
}

/** All 26 view directions. */
export function allHotspots(): Hotspot[] {
  const seen = new Map<string, Hotspot>();
  for (const face of FACES) for (const cell of faceCells(face)) seen.set(cell.name, cell);
  return [...seen.values()];
}

/** The face a view direction looks straight at, if any (within `tolerance`). */
export function faceOn(back: Vec3, tolerance = 1e-4): CubeFace | undefined {
  return FACES.find(
    (f) =>
      Math.abs(back[0] - f.normal[0]) < tolerance &&
      Math.abs(back[1] - f.normal[1]) < tolerance &&
      Math.abs(back[2] - f.normal[2]) < tolerance,
  );
}

/** The named direction a view looks along, if it matches a face, edge or corner. */
export function namedDirection(back: Vec3, tolerance = 1e-4): Hotspot | undefined {
  return allHotspots().find((h) => {
    const len = Math.hypot(...h.direction);
    return h.direction.every((c, i) => Math.abs(c / len - (back[i] ?? 0)) < tolerance);
  });
}
