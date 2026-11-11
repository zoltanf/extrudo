/**
 * What the kernel tells about a sheet's anchors (P6-24 S3, ADR-0143's S3
 * amendment): `KernelApi.resolveSheet` resolves each dimension's anchors
 * against the bodies at the marker and gives back, per anchor, its state and
 * the 3D geometry it stands for. `@extrudo/sheets` projects that through the
 * view's frame, measures and lays the dimension out, so the app and the CLI
 * give the same result. None of it is stored: it is derived.
 */
import type { SheetItemId } from './ids';
import type { GeomRef } from './refs';
import type { Vec3 } from './sketch/planes';

/**
 * How an anchor resolved: `ok` (its name, exactly), `moved` (a related name
 * or its fingerprint: drawn, with a warning), `detached` (nothing there).
 */
export type SheetAnchorStatus = 'ok' | 'moved' | 'detached';

/** A straight piece in world mm. */
export interface SheetSegment3 {
  start: Vec3;
  end: Vec3;
}

/** The geometry an anchor stands for, in world mm. */
export type SheetAnchorGeometry =
  /** A vertex, or an edge's start, end, middle or centre. */
  | { type: 'point'; point: Vec3 }
  /** A straight edge. */
  | ({ type: 'line' } & SheetSegment3)
  /** A circular edge, or a cylinder's face (its centre on the axis, level with the face's middle). */
  | { type: 'circle'; centre: Vec3; axis: Vec3; xDirection: Vec3; radius: number }
  /** An edge that is neither (an ellipse, a spline): only its ends. */
  | ({ type: 'curve' } & SheetSegment3)
  /**
   * A cylinder's or cone's outline in the dimension's view: the side the
   * anchor names, and the other side when the face has it.
   */
  | ({ type: 'silhouette'; opposite?: SheetSegment3 } & SheetSegment3);

export interface SheetAnchorReport {
  status: SheetAnchorStatus;
  /** Absent when detached, for a free anchor, and when the geometry can't give what is asked (`message`). */
  geometry?: SheetAnchorGeometry;
  /** What the reference resolved to now, with its fingerprint now ("keep closest match"). */
  resolved?: GeomRef;
  /**
   * Why a resolved anchor has no geometry ("The edge has no centre."), or why
   * one is detached when its feature is deleted or suppressed ("The feature
   * this was measured on is deleted.").
   */
  message?: string;
}

/**
 * A sheet's anchors, by dimension ID, one report per anchor in the item's
 * order; a free anchor's is `{ status: 'ok' }`.
 */
export type SheetAnchors = Record<SheetItemId, SheetAnchorReport[]>;

/**
 * Which outline of a cylinder or cone a point is on, seen along `direction`:
 * `1` on the side `axis × direction` points to, else `-1`. `axis` is the
 * face's axis with its canonical sign (`SurfaceGeometry.direction`), `origin`
 * a point on it. The Dimension tool and the kernel agree through this.
 */
export function sheetSilhouetteSide(
  direction: Vec3,
  origin: Vec3,
  axis: Vec3,
  point: Vec3,
): 1 | -1 {
  const w: Vec3 = [
    axis[1] * direction[2] - axis[2] * direction[1],
    axis[2] * direction[0] - axis[0] * direction[2],
    axis[0] * direction[1] - axis[1] * direction[0],
  ];
  const side =
    (point[0] - origin[0]) * w[0] + (point[1] - origin[1]) * w[1] + (point[2] - origin[2]) * w[2];
  return side >= 0 ? 1 : -1;
}

/**
 * The anchors to draw now: `next` (a fresh `resolveSheet`), except that an
 * anchor detached now keeps the geometry it had in `previous`, still marked
 * detached (and what it resolved to then), so a lost dimension stays where
 * it was drawn (ADR-0143's S3 amendment). Reports pair up by their index
 * in the item's anchors. The app holds `previous` in memory; nothing of it is stored,
 * so after reopening a file a detached dimension has no geometry.
 */
export function keepLastAnchors(
  previous: SheetAnchors | undefined,
  next: SheetAnchors,
): SheetAnchors {
  const out: SheetAnchors = {};
  for (const [id, reports] of Object.entries(next) as [SheetItemId, SheetAnchorReport[]][]) {
    const before = previous?.[id];
    out[id] = reports.map((report, i) => {
      const last = before?.[i];
      if (report.status !== 'detached' || report.geometry || !last?.geometry) return report;
      // What it resolved to last, too: the text stays where it was drawn.
      return {
        status: 'detached',
        geometry: last.geometry,
        ...(last.resolved && { resolved: last.resolved }),
        ...(report.message && { message: report.message }),
      };
    });
  }
  return out;
}
