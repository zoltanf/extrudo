/**
 * Profile detection (P1-11, ADR-0020): the closed regions of a sketch, with
 * holes. No WASM: the app imports this entry like `@extrudo/sketch/inference`.
 */

export { interiorPoint, windingNumber } from './ink';
export {
  detectProfiles,
  insidePolygon,
  MAX_PROFILE_COORDINATE,
  MAX_PROFILE_CUTS,
  MAX_PROFILE_POINTS,
  MAX_PROFILE_SEGMENTS,
  MAX_PROFILE_TESTS,
  PROFILE_CUTS_PER_SEGMENT,
  PROFILE_TOLERANCE,
  type Profile,
  type ProfileEdge,
  type ProfileLoop,
  type ProfilesRefusal,
  ProfilesRefusedError,
  profileAt,
  profileCentroid,
  profileIds,
  profileKey,
  profilesRefusal,
  TOO_LARGE_COORDINATES,
  TOO_MANY_CROSSINGS,
  TOO_MANY_CURVES,
  textInkOf,
} from './profiles';
