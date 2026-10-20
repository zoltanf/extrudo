/**
 * What a snapshot may ask for besides its size (#88): the direction to look
 * from, the bodies to show (framed on them), a section that cuts away the side
 * a plane's normal points to, and whether sketches and construction geometry
 * are drawn. Everything is drawn through a camera and render target of the
 * snapshot's own, so the person's view never moves.
 */
import { Plane, Vector3 } from 'three';
import { HOME_DIRECTION, type Vec3 } from './camera';
import { FACES, type FaceName } from './viewcube';

export const SNAPSHOT_VIEWS = ['iso', 'top', 'bottom', 'front', 'back', 'left', 'right'] as const;
export type SnapshotViewName = (typeof SNAPSHOT_VIEWS)[number];

export interface SnapshotOptions {
  /** A named view, or the direction from the model to the camera. */
  view?: SnapshotViewName | Vec3;
  /** Only these bodies, framed on them. */
  bodies?: readonly string[];
  /** Cuts away everything on the side of the plane its normal points to. */
  section?: { origin: Vec3; normal: Vec3 };
  /** Sketches and construction geometry; default true. */
  overlays?: boolean;
}

/** Scene objects drawn only with `overlays` (sketches, construction geometry). */
export const SNAPSHOT_OVERLAY = 'snapshot-overlay';

/** The name of a body's group in the scene. */
export const bodyObjectName = (id: string): string => `body:${id}`;

/** The direction from the model to the camera for a view (`iso` is the home view's). */
export function snapshotDirection(view: SnapshotViewName | Vec3): Vec3 {
  if (typeof view !== 'string') return view;
  if (view === 'iso') return HOME_DIRECTION;
  const face = FACES.find(
    (f) => f.name === (`${view[0]?.toUpperCase()}${view.slice(1)}` as FaceName),
  );
  return face?.normal ?? HOME_DIRECTION;
}

/** The clipping plane that keeps the side of `section` away from its normal. */
export function sectionPlane(section: { origin: Vec3; normal: Vec3 }): Plane {
  const n = new Vector3(...section.normal).normalize();
  // three keeps what lies on the plane's positive side: point it against the normal.
  return new Plane(n.clone().negate(), n.dot(new Vector3(...section.origin)));
}
