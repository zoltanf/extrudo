/**
 * What a body's view builds from its mesh alone, kept per mesh (ADR-0102 §10): a body that mounts
 * again (the bodies after an edited feature, when its dialog closes) takes them instead of
 * building them again. Kept in `WeakMap`s by the mesh object, so they go with the mesh; a mesh's
 * arrays are never written in place (ADR-0102 §9).
 */
import type { BodyMesh } from '@extrudo/kernel';
import { type FacePalette, paintFaces } from '../selection/highlight';
import { edgeSegments } from './bodyGeometry';

/**
 * A mesh's edges as line segments, made once per mesh (ADR-0102 §10): a body that mounts again
 * (the bodies after an edited feature, when its dialog closes) takes the same array. Shared by
 * every geometry made from it, which reads it only; nothing writes into it.
 */
const edgeCache = new WeakMap<BodyMesh, Float32Array>();
export function keptEdgeSegments(mesh: BodyMesh): Float32Array {
  let segments = edgeCache.get(mesh);
  if (!segments) {
    segments = edgeSegments(mesh);
    edgeCache.set(mesh, segments);
  }
  return segments;
}

/**
 * The last whole painting of each mesh's faces (ADR-0102 §10): the palette's key, the face states
 * it was painted for and the colours (a copy). A new geometry of the same mesh, painted for the
 * same key and the same states, copies them instead of painting every face again. A geometry's
 * colours start at 0 and a whole painting writes every node of every face, so the copy is the
 * same as painting.
 */
const paintCache = new WeakMap<
  BodyMesh,
  { key: string; states: Uint8Array; colors: Float32Array; range: [number, number] | undefined }
>();
export function paintAll(
  colors: Float32Array,
  mesh: BodyMesh,
  states: Uint8Array,
  palette: FacePalette,
  key: string,
): [number, number] | undefined {
  const kept = paintCache.get(mesh);
  if (
    kept &&
    kept.key === key &&
    kept.colors.length === colors.length &&
    kept.states.length === states.length &&
    kept.states.every((state, f) => state === states[f])
  ) {
    colors.set(kept.colors);
    return kept.range;
  }
  const range = paintFaces(colors, mesh, states, palette);
  paintCache.set(mesh, { key, states: states.slice(), colors: colors.slice(), range });
  return range;
}
