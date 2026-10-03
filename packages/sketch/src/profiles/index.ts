/**
 * Profile detection (P1-11, ADR-0020): the closed regions of a sketch, with
 * holes. No WASM: the app imports this entry like `@extrudo/sketch/inference`.
 */

export { interiorPoint, windingNumber } from './ink';
export {
  detectProfiles,
  insidePolygon,
  PROFILE_TOLERANCE,
  type Profile,
  type ProfileEdge,
  type ProfileLoop,
  profileAt,
  profileCentroid,
  profileIds,
  profileKey,
  textInkOf,
} from './profiles';
