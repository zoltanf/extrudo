/**
 * Profile detection (P1-11, ADR-0020): the closed regions of a sketch, with
 * holes. No WASM: the app imports this entry like `@extrudo/sketch/inference`.
 */

export { interiorPoint, windingNumber } from './ink';
export {
  detectProfiles,
  insidePolygon,
  isTooManyCrossings,
  MAX_PROFILE_CUTS,
  PROFILE_TOLERANCE,
  type Profile,
  type ProfileEdge,
  type ProfileLoop,
  profileAt,
  profileCentroid,
  profileIds,
  profileKey,
  TOO_MANY_CROSSINGS,
  TooManyCrossingsError,
  textInkOf,
} from './profiles';
