/**
 * Selection highlights on bodies (P2-03, architecture §5.4, ADR-0026):
 * which faces, edges and vertices of a body are under the pointer or
 * selected, and the face colours on the body's merged geometry. Faces are
 * tinted through the geometry's colour attribute, rewriting only the nodes
 * of faces whose state changed; edges and vertices are drawn as small
 * overlays (a handful of lines and dots).
 */
import type { BodyId, SelectionItem } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { readTopology } from './items';

/** Face state bits. */
export const HOVER = 1;
export const SELECTED = 2;

export interface BodyHighlight {
  /** Per face: `HOVER` and `SELECTED` bits. */
  faces: Uint8Array;
  hoverEdges: number[];
  selectedEdges: number[];
  hoverVertices: number[];
  selectedVertices: number[];
}

/**
 * What of body `id` the hover and the selection name. A hovered or
 * selected body marks all its faces.
 */
export function bodyHighlight(
  id: BodyId,
  mesh: BodyMesh,
  hover: SelectionItem | undefined,
  selection: readonly SelectionItem[],
): BodyHighlight {
  const faceCount = mesh.faceRanges.length >> 1;
  const out: BodyHighlight = {
    faces: new Uint8Array(faceCount),
    hoverEdges: [],
    selectedEdges: [],
    hoverVertices: [],
    selectedVertices: [],
  };
  const mark = (item: SelectionItem | undefined, bit: number) => {
    const t = readTopology(item);
    if (!t || t.body !== id) return;
    if (t.kind === 'body') {
      for (let f = 0; f < faceCount; f++) out.faces[f] = (out.faces[f] ?? 0) | bit;
    } else if (t.kind === 'face') {
      if (t.index < faceCount) out.faces[t.index] = (out.faces[t.index] ?? 0) | bit;
    } else if (t.kind === 'edge') {
      (bit === HOVER ? out.hoverEdges : out.selectedEdges).push(t.index);
    } else {
      (bit === HOVER ? out.hoverVertices : out.selectedVertices).push(t.index);
    }
  };
  for (const item of selection) mark(item, SELECTED);
  mark(hover, HOVER);
  return out;
}

export type Rgb = readonly [number, number, number];

export interface FacePalette {
  /** The body's colour (linear RGB, as the colour attribute takes it). */
  base: Rgb;
  /** The accent the highlights blend in. */
  accent: Rgb;
}

/** How much accent a face takes: pre-highlight 45 %, selected 90 % (docs/05-brand.md §3.4). */
export const HOVER_MIX = 0.45;
export const SELECTED_MIX = 0.9;

/** The colour of a face in a state. */
export function faceColor(state: number, { base, accent }: FacePalette): Rgb {
  const t = state & SELECTED ? SELECTED_MIX : state & HOVER ? HOVER_MIX : 0;
  return [
    base[0] + (accent[0] - base[0]) * t,
    base[1] + (accent[1] - base[1]) * t,
    base[2] + (accent[2] - base[2]) * t,
  ];
}

/**
 * Writes face colours into a colour attribute's array (three floats per
 * mesh node). Only faces whose state differs from `previous` are written;
 * without `previous`, all are. Returns the range of nodes written
 * (`[first, count]`), or `undefined` if nothing changed.
 */
export function paintFaces(
  colors: Float32Array,
  mesh: BodyMesh,
  states: Uint8Array,
  palette: FacePalette,
  previous?: Uint8Array,
): [number, number] | undefined {
  let lo = Number.POSITIVE_INFINITY;
  let hi = -1;
  const faceCount = mesh.faceRanges.length >> 1;
  for (let f = 0; f < faceCount; f++) {
    const state = states[f] ?? 0;
    if (previous && (previous[f] ?? 0) === state) continue;
    const [r, g, b] = faceColor(state, palette);
    const first = mesh.faceRanges[2 * f] ?? 0;
    const count = mesh.faceRanges[2 * f + 1] ?? 0;
    for (let i = 3 * first; i < 3 * (first + count); i++) {
      const node = mesh.indices[i] ?? 0;
      colors[3 * node] = r;
      colors[3 * node + 1] = g;
      colors[3 * node + 2] = b;
      if (node < lo) lo = node;
      if (node > hi) hi = node;
    }
  }
  return hi < 0 ? undefined : [lo, hi - lo + 1];
}

/** The polylines of some edges as line-segment pairs (xyz xyz per segment). */
export function edgeSegmentsOf(mesh: BodyMesh, edges: readonly number[]): Float32Array {
  const { edgePoints, edgeRanges } = mesh;
  let count = 0;
  for (const e of edges) count += Math.max(0, (edgeRanges[2 * e + 1] ?? 0) - 1);
  const out = new Float32Array(count * 6);
  let o = 0;
  for (const e of edges) {
    const first = edgeRanges[2 * e] ?? 0;
    const n = edgeRanges[2 * e + 1] ?? 0;
    for (let i = 0; i + 1 < n; i++) {
      const a = (first + i) * 3;
      out.set(edgePoints.subarray(a, a + 6), o);
      o += 6;
    }
  }
  return out;
}

/** The positions of some B-rep vertices, xyz each. */
export function vertexPositions(mesh: BodyMesh, vertices: readonly number[]): Float32Array {
  const out = new Float32Array(vertices.length * 3);
  vertices.forEach((v, i) => {
    out.set(mesh.vertices.subarray(3 * v, 3 * v + 3), 3 * i);
  });
  return out;
}
