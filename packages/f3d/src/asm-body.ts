/**
 * The topology of a B-rep stream: body → lump → shell → face, with each face's
 * loops, their coedges in order, the edges with their curves and the
 * vertices/points (see `FORMAT.md`, "ASM B-rep" → "Topology, and earlier
 * states"). `asmFaces` flattens each face to a bag of edges for fillet and
 * chamfer naming; this reader keeps the loops, the face sense and the
 * shell/lump grouping a solid rebuild needs.
 *
 * A stream holds more than the solved solid: earlier versions of faces and
 * shells, and several bodies. The live solid is the one a `lump` names: each
 * `lump` points at its shell and its body, and the shell's face chain is the
 * current shell (history shells carry no faces). So the lumps, in stream
 * order, are the solids of the stream.
 *
 * Every walk is bounded: each pointer index is checked against the record
 * count, the whole stream is walked once (a shell, face, loop or coedge is read
 * at most once — a duplicate shell is skipped, a duplicated face, loop or
 * coedge throws `F3dFormatError`), so a crafted stream cannot make the read
 * quadratic, and a chain that runs away throws instead of looping.
 */
import { type AsmCurve, type AsmRecord, type AsmSurface, asmCurveOf, asmSurfaceOf } from './asm';
import { F3dFormatError } from './bytes';

/** A point in model space (cm). */
export type AsmPoint = [number, number, number];

/** How an edge runs, independent of which face sees it. */
export interface AsmBodyEdge {
  /** The edge record, shared when two loops use the same edge. */
  id: number;
  curve: AsmCurve;
  start?: AsmPoint;
  end?: AsmPoint;
  /**
   * The edge's own sense flag: true when the edge runs against its curve (the
   * edge's start-to-end direction is opposite the curve's own parametrisation),
   * false when it runs with it. `EDGE_CURVE`'s same-sense is the opposite.
   */
  reversed: boolean;
}

/** One edge as one loop sees it, in the loop's order. */
export interface AsmBodyCoedge {
  edge: AsmBodyEdge;
  /** The coedge's sense: true runs with the edge, false against it. */
  forward: boolean;
}

/** A closed loop of a face; the first loop the file writes is the outer one. */
export interface AsmBodyLoop {
  coedges: AsmBodyCoedge[];
  /** The face's outer loop (the first one); the rest are inner (holes). */
  outer: boolean;
}

export interface AsmBodyFace {
  surface: AsmSurface;
  /** The face sense flag: true when the surface normal runs against the face. */
  reversed: boolean;
  loops: AsmBodyLoop[];
}

/** One solid of a stream: the faces of one lump's shell. */
export interface AsmBodySolid {
  faces: AsmBodyFace[];
}

/** A crafted stream may not take an unbounded number of steps per walk. */
const MAX_SOLIDS = 1 << 16;
const MAX_FACES = 1 << 18;
const MAX_LOOPS = 1 << 12;
const MAX_EDGES = 1 << 20;

const pointers = (r: AsmRecord | undefined): number[] =>
  r ? r.values.filter((v) => v.t === 'ptr').map((v) => (v as { v: number }).v) : [];

const bools = (r: AsmRecord | undefined): boolean[] =>
  r ? r.values.filter((v) => v.t === 'bool').map((v) => (v as { v: boolean }).v) : [];

/** A record's own class name (its base classes are dropped). */
const nameOf = (r: AsmRecord | undefined): string => r?.derived ?? r?.type ?? '';

/** True when a record is `type` or a subtype of it (`tedge-edge`, `tvertex-vertex`). */
function isType(records: AsmRecord[]) {
  return (p: number, type: string): boolean => {
    if (p < 0 || p >= records.length) return false;
    const t = nameOf(records[p]);
    return t === type || t.endsWith(`-${type}`);
  };
}

/** The first pointer naming a record of `type`. */
const firstOf = (is: (p: number, t: string) => boolean, ptrs: number[], type: string): number =>
  ptrs.find((p) => is(p, type)) ?? -1;

/** A vertex's position, following vertex → point. */
function vertexPoint(
  records: AsmRecord[],
  is: ReturnType<typeof isType>,
  v: number,
): AsmPoint | undefined {
  if (!is(v, 'vertex')) return undefined;
  const point = firstOf(is, pointers(records[v]), 'point');
  if (point < 0) return undefined;
  const at = records[point]?.values.find((x) => x.t === 'vec');
  return at?.t === 'vec' ? at.v : undefined;
}

/** A surface's geometry, with the record's own class name when it is not carried. */
function surfaceAt(records: AsmRecord[], p: number): AsmSurface {
  const s = asmSurfaceOf(records[p]);
  return s.kind === 'other' ? { kind: 'other', type: nameOf(records[p]) || s.type } : s;
}

/** A curve's geometry, with the record's own class name when it is not carried. */
function curveAt(records: AsmRecord[], p: number): AsmCurve {
  const c = asmCurveOf(records[p]);
  return c.kind === 'other' ? { kind: 'other', type: nameOf(records[p]) || c.type } : c;
}

/** The stream's walk state: a shell, face, loop or coedge is read at most once. */
interface Walk {
  is: ReturnType<typeof isType>;
  shells: Set<number>;
  faces: Set<number>;
  loops: Set<number>;
  coedges: Set<number>;
}

/** One edge record: its curve, its two vertices' points, its sense. */
function readEdge(records: AsmRecord[], is: ReturnType<typeof isType>, edge: number): AsmBodyEdge {
  const ep = pointers(records[edge]);
  const vertices = ep.filter((p) => is(p, 'vertex'));
  const curvePtr = ep.find((p) => p >= 0 && nameOf(records[p]).endsWith('curve')) ?? -1;
  const start = vertexPoint(records, is, vertices[0] ?? -1);
  const end = vertexPoint(records, is, vertices[1] ?? -1);
  const curve = curveAt(records, curvePtr);
  // The edge runs against its curve when the edge record's sense is true (read
  // from the record). For a straight curve the points say it directly, and the
  // two disagree on a rare few edges in the corpus, where the points are the
  // ones a kernel can rebuild, so a line's sense comes from its geometry.
  const sense = bools(records[edge])[0] ?? false;
  const reversed =
    curve.kind === 'line' && start && end
      ? (end[0] - start[0]) * curve.direction[0] +
          (end[1] - start[1]) * curve.direction[1] +
          (end[2] - start[2]) * curve.direction[2] <
        0
      : sense;
  return {
    id: edge,
    curve,
    reversed,
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
  };
}

/** The loops of one face, in the file’s order, each with its coedges in order. */
function readLoops(records: AsmRecord[], walk: Walk, face: number): AsmBodyLoop[] {
  const loops: AsmBodyLoop[] = [];
  let loop = firstOf(walk.is, pointers(records[face]), 'loop');
  while (loop >= 0) {
    if (walk.loops.has(loop)) throw new F3dFormatError('ASM body: a loop is used by two faces.');
    walk.loops.add(loop);
    if (loops.length >= MAX_LOOPS) throw new F3dFormatError('ASM body: too many loops.');
    const outer = loops.length === 0;
    const coedges: AsmBodyCoedge[] = [];
    const cycle = new Set<number>();
    let coedge = firstOf(walk.is, pointers(records[loop]), 'coedge');
    while (coedge >= 0) {
      if (cycle.has(coedge)) break; // the coedge cycle closes; the loop is whole
      cycle.add(coedge);
      if (walk.coedges.has(coedge))
        throw new F3dFormatError('ASM body: a coedge is used by two loops.');
      walk.coedges.add(coedge);
      if (coedges.length >= MAX_EDGES) throw new F3dFormatError('ASM body: too many coedges.');
      const cp = pointers(records[coedge]);
      const edge = firstOf(walk.is, cp, 'edge');
      if (edge >= 0) {
        const forward = bools(records[coedge])[0] ?? true;
        coedges.push({ edge: readEdge(records, walk.is, edge), forward });
      }
      coedge = firstOf(
        walk.is,
        cp.filter((p) => walk.is(p, 'coedge')),
        'coedge',
      );
    }
    loops.push({ coedges, outer });
    loop = firstOf(walk.is, pointers(records[loop]), 'loop');
  }
  return loops;
}

/** One face record: its surface, its sense and its loops. */
function readFace(records: AsmRecord[], walk: Walk, face: number): AsmBodyFace {
  const fp = pointers(records[face]);
  const surface = surfaceAt(records, fp[fp.length - 1] ?? -1);
  // The face record's flag is the face's forward sense: true when the face's
  // normal runs with its surface's. A surface the file wrote with a negative
  // radius has its normal reversed, so the face is then reversed too.
  const inward = (surface.kind === 'sphere' || surface.kind === 'torus') && surface.inward;
  const forward = (bools(records[face])[0] ?? true) !== inward;
  return { surface, reversed: !forward, loops: readLoops(records, walk, face) };
}

/** The faces of one shell: its first face, then the face chain. */
function shellFaces(records: AsmRecord[], walk: Walk, shell: number): AsmBodyFace[] {
  const faces: AsmBodyFace[] = [];
  let face = firstOf(walk.is, pointers(records[shell]), 'face');
  while (face >= 0) {
    if (walk.faces.has(face)) throw new F3dFormatError('ASM body: a face is used by two shells.');
    walk.faces.add(face);
    if (faces.length >= MAX_FACES) throw new F3dFormatError('ASM body: too many faces.');
    faces.push(readFace(records, walk, face));
    const next = pointers(records[face]).find((p) => p !== face && walk.is(p, 'face')) ?? -1;
    face = next;
  }
  return faces;
}

/**
 * The live solids of a B-rep stream, one per `lump`, in stream order. Each is
 * the faces of the shell that lump names (the current shell; the stream's
 * earlier shells are not read). The whole stream is walked once: a shell read
 * already is skipped, and a face, loop or coedge claimed twice throws, so a
 * crafted stream cannot make the read quadratic.
 */
export function asmBodies(records: AsmRecord[]): AsmBodySolid[] {
  const walk: Walk = {
    is: isType(records),
    shells: new Set(),
    faces: new Set(),
    loops: new Set(),
    coedges: new Set(),
  };
  const out: AsmBodySolid[] = [];
  for (let i = 0; i < records.length; i++) {
    if (records[i]?.type !== 'lump') continue;
    if (out.length >= MAX_SOLIDS) throw new F3dFormatError('ASM body: too many solids.');
    const shell = firstOf(walk.is, pointers(records[i]), 'shell');
    if (shell < 0 || walk.shells.has(shell)) continue;
    walk.shells.add(shell);
    out.push({ faces: shellFaces(records, walk, shell) });
  }
  return out;
}
