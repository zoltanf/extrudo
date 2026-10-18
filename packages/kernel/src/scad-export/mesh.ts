/**
 * Mesh versions (P6-09, ADR-0088 §8): a shape as OpenSCAD's `polyhedron`,
 * from the welded export mesh: points rounded to 1e-4 mm and merged, faces
 * clockwise seen from outside (the export mesh's are counter-clockwise), and
 * triangles that rounding collapses left out.
 */
import type { ExportMesh } from '../mesh';
import type { CsgNode } from './ir';

/** Points are rounded to this many decimals of a millimetre. */
const DECIMALS = 4;
const STEP = 10 ** DECIMALS;

function round(v: number): number {
  const r = Math.round(v * STEP) / STEP;
  return Object.is(r, -0) ? 0 : r;
}

export function polyhedronOf(mesh: ExportMesh): Extract<CsgNode, { kind: 'polyhedron' }> {
  const { positions, indices } = mesh;
  const points: [number, number, number][] = [];
  const index = new Map<string, number>();
  /** Each node's rounded key, computed once. */
  const keys: string[] = [];
  const rounded: [number, number, number][] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const p: [number, number, number] = [
      round(positions[i] as number),
      round(positions[i + 1] as number),
      round(positions[i + 2] as number),
    ];
    rounded.push(p);
    keys.push(p.join(','));
  }
  const pointOf = (node: number): number => {
    const key = keys[node] as string;
    let at = index.get(key);
    if (at === undefined) {
      at = points.length;
      points.push(rounded[node] as [number, number, number]);
      index.set(key, at);
    }
    return at;
  };
  const faces: [number, number, number][] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] as number, indices[t + 1] as number, indices[t + 2] as number];
    // Collapsed by rounding: two corners on one point.
    if (keys[a] === keys[b] || keys[b] === keys[c] || keys[a] === keys[c]) continue;
    const pa = pointOf(a);
    const pb = pointOf(b);
    const pc = pointOf(c);
    faces.push([pa, pc, pb]);
  }
  return { kind: 'polyhedron', points, faces };
}
