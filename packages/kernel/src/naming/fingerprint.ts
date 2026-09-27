/**
 * Fingerprints (ADR-0005): what a referenced face, edge or vertex looked
 * like, kept in the reference so it can be found again when its name no
 * longer resolves.
 */
import type { GeomFingerprint } from '@extrudo/core';
import type { SubShapeKind } from '../history';
import type { Vec3 } from '../kernel';
import type { ShapeDescription } from './description';
import type { TopoNames } from './names';
import { parseFace } from './topo-id';

/** The lowest score a fingerprint match needs to be used (0–1). */
export const FINGERPRINT_THRESHOLD = 0.6;

const round = (x: number) => Math.round(x * 1e6) / 1e6 || 0;
const roundVec = (v: Vec3): [number, number, number] => [round(v[0]), round(v[1]), round(v[2])];

/** The fingerprint of one sub-shape, rounded to 1e-6 so documents stay tidy. */
export function fingerprintOf(
  d: ShapeDescription,
  names: TopoNames,
  kind: SubShapeKind,
  index: number,
): GeomFingerprint {
  const faceNames = (faces: readonly number[]) =>
    [...new Set(faces.map((f) => names.faces[f] as string))].sort();
  if (kind === 'face') {
    const face = d.faces[index];
    if (!face) throw new Error(`No face ${index}`);
    // The faces next to it: those sharing an edge.
    const around = new Set<number>();
    for (const edge of d.edges) {
      if (edge.faces.includes(index)) for (const f of edge.faces) if (f !== index) around.add(f);
    }
    return {
      type: face.type,
      at: roundVec(face.centroid),
      ...(face.direction ? { dir: roundVec(face.direction) } : {}),
      size: round(face.area),
      adj: faceNames([...around]),
    };
  }
  if (kind === 'edge') {
    const edge = d.edges[index];
    if (!edge) throw new Error(`No edge ${index}`);
    return {
      type: edge.type,
      at: roundVec(edge.midpoint),
      ...(edge.direction ? { dir: roundVec(edge.direction) } : {}),
      size: round(edge.length),
      adj: faceNames(edge.faces),
    };
  }
  const vertex = d.vertices[index];
  if (!vertex) throw new Error(`No vertex ${index}`);
  return { type: 'point', at: roundVec(vertex.point), adj: faceNames(vertex.faces) };
}

/**
 * How well a candidate matches a stored fingerprint, from 0 to 1. A
 * different surface or curve type never matches. Otherwise a weighted mean
 * of: position (distance against the element's own size), direction (a
 * plane's normal must point the same way; axes and lines either way), size
 * (smaller over larger) and neighbours (shared adjacent faces, comparing
 * names without their split numbers).
 */
export function fingerprintScore(
  stored: GeomFingerprint,
  candidate: GeomFingerprint,
  kind: SubShapeKind,
): number {
  if (stored.type !== candidate.type) return 0;
  const scale = Math.max(
    1,
    kind === 'face'
      ? Math.sqrt(Math.max(stored.size ?? 0, candidate.size ?? 0))
      : Math.max(stored.size ?? 0, candidate.size ?? 0),
  );
  const parts: [number, number][] = [];
  parts.push([0.35, Math.exp(-distance(stored.at, candidate.at) / scale)]);
  if (kind !== 'vertex') {
    let direction = 0.5;
    if (stored.dir && candidate.dir) {
      const dot =
        stored.dir[0] * candidate.dir[0] +
        stored.dir[1] * candidate.dir[1] +
        stored.dir[2] * candidate.dir[2];
      direction = kind === 'face' && stored.type === 'plane' ? Math.max(0, dot) : Math.abs(dot);
    } else if (!stored.dir && !candidate.dir) {
      direction = 1;
    }
    parts.push([0.2, direction]);
    const a = stored.size ?? 0;
    const b = candidate.size ?? 0;
    parts.push([0.2, a === b ? 1 : Math.min(a, b) / Math.max(a, b)]);
  }
  if (stored.adj && stored.adj.length > 0) {
    parts.push([0.25, overlap(stored.adj, candidate.adj ?? [])]);
  }
  const weight = parts.reduce((sum, [w]) => sum + w, 0);
  return parts.reduce((sum, [w, s]) => sum + w * s, 0) / weight;
}

/** Shared names over all names (Jaccard), ignoring split numbers. */
function overlap(a: readonly string[], b: readonly string[]): number {
  const stems = (names: readonly string[]) => new Set(names.map((n) => parseFace(n).stem));
  const sa = stems(a);
  const sb = stems(b);
  let shared = 0;
  for (const name of sa) if (sb.has(name)) shared++;
  const all = sa.size + sb.size - shared;
  return all === 0 ? 1 : shared / all;
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(
    (a[0] ?? 0) - (b[0] ?? 0),
    (a[1] ?? 0) - (b[1] ?? 0),
    (a[2] ?? 0) - (b[2] ?? 0),
  );
}
