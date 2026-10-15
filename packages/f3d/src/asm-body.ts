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
import {
  asmSplineCurve,
  asmSplineReversed,
  asmSplineSurface,
  type SubtypeTable,
  subtypeTable,
} from './asm-spline';
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
   * false when it runs with it. `EDGE_CURVE`'s same-sense is the opposite. For a
   * B-spline curve this is against the B-spline's own parameter (the curve
   * record's sense is folded in).
   */
  reversed: boolean;
  /**
   * For a B-spline curve: the edge's stretch of the B-spline's parameter, low
   * to high (the edge record's two parameters, mapped through the curve's sense).
   */
  range?: [number, number];
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

/** One solid of a stream: the faces of one lump's shells. */
export interface AsmBodySolid {
  /** The faces of the lump's outer shell. */
  faces: AsmBodyFace[];
  /**
   * The faces of each void: a lump can hold more than one shell, one its
   * outside and the others cavities inside it. The outer shell is the one whose
   * box holds every other shell's (the file's shell order does not say).
   */
  voids?: AsmBodyFace[][];
  /**
   * The lump holds several shells and no one shell's box holds all the others,
   * so which is the outside is not known; `faces` is then the first shell's.
   */
  unknownOuter?: boolean;
}

/** The curve type of an edge record that names no curve. */
const NO_CURVE = 'none';

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

/**
 * A surface's geometry, with the record's own class name when it is not
 * carried. A `spline-surface` is its stored B-spline.
 */
function surfaceAt(records: AsmRecord[], walk: Walk, p: number): AsmSurface {
  let s = walk.surfaces.get(p);
  if (!s) {
    s = readSurface(records, walk, p);
    walk.surfaces.set(p, s);
  }
  return s;
}

function readSurface(records: AsmRecord[], walk: Walk, p: number): AsmSurface {
  const name = nameOf(records[p]);
  if (name === 'spline-surface') {
    const spline = asmSplineSurface(records, walk.table(), p);
    return spline
      ? { kind: 'bspline', spline, reversed: asmSplineReversed(records[p]) }
      : { kind: 'other', type: 'a spline surface with no B-spline' };
  }
  const s = asmSurfaceOf(records[p]);
  return s.kind === 'other' ? { kind: 'other', type: name || s.type } : s;
}

/**
 * A curve's geometry, with the record's own class name when it is not
 * carried. An `intcurve-curve` is its stored B-spline.
 */
function curveAt(records: AsmRecord[], walk: Walk, p: number): AsmCurve {
  let c = walk.curves.get(p);
  if (!c) {
    c = readCurve(records, walk, p);
    walk.curves.set(p, c);
  }
  return c;
}

function readCurve(records: AsmRecord[], walk: Walk, p: number): AsmCurve {
  const name = nameOf(records[p]);
  if (name === 'intcurve-curve') {
    const spline = asmSplineCurve(records, walk.table(), p);
    return spline
      ? { kind: 'bspline', spline, reversed: asmSplineReversed(records[p]) }
      : { kind: 'other', type: 'an intcurve with no B-spline' };
  }
  const c = asmCurveOf(records[p]);
  return c.kind === 'other' ? { kind: 'other', type: name || c.type } : c;
}

/**
 * The stream's walk state: a shell, face, loop or coedge is read at most once;
 * a surface, curve or edge record that several of them name is read once and
 * shared (so the STEP writer writes it once).
 */
interface Walk {
  surfaces: Map<number, AsmSurface>;
  curves: Map<number, AsmCurve>;
  edges: Map<number, AsmBodyEdge>;
  is: ReturnType<typeof isType>;
  /** The stream's subtype blocks, read on the first spline met. */
  table: () => SubtypeTable;
  shells: Set<number>;
  faces: Set<number>;
  loops: Set<number>;
  coedges: Set<number>;
}

/** One edge record: its curve, its two vertices' points, its sense (read once per stream). */
function readEdge(records: AsmRecord[], walk: Walk, edge: number): AsmBodyEdge {
  let e = walk.edges.get(edge);
  if (!e) {
    e = edgeOf(records, walk, edge);
    walk.edges.set(edge, e);
  }
  return e;
}

function edgeOf(records: AsmRecord[], walk: Walk, edge: number): AsmBodyEdge {
  const is = walk.is;
  const ep = pointers(records[edge]);
  const vertices = ep.filter((p) => is(p, 'vertex'));
  const curvePtr = ep.find((p) => p >= 0 && nameOf(records[p]).endsWith('curve')) ?? -1;
  const start = vertexPoint(records, is, vertices[0] ?? -1);
  const end = vertexPoint(records, is, vertices[1] ?? -1);
  const curve: AsmCurve =
    curvePtr < 0 ? { kind: 'other', type: NO_CURVE } : curveAt(records, walk, curvePtr);
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
  if (curve.kind === 'bspline') {
    // The edge runs against the B-spline when exactly one of the edge and the
    // curve record runs against what it is built on. The edge's two parameters
    // are its own: each reversal negates the parameter, so the B-spline's
    // stretch is the negated pair when the edge runs against it.
    const against = sense !== curve.reversed;
    const ts = records[edge]?.values.filter((v) => v.t === 'dbl').map((v) => v.v as number) ?? [];
    const [t0, t1] = ts;
    const range: [number, number] | undefined =
      t0 !== undefined && t1 !== undefined ? (against ? [-t1, -t0] : [t0, t1]) : undefined;
    return {
      id: edge,
      curve,
      reversed: against,
      ...(range ? { range } : {}),
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
    };
  }
  return {
    id: edge,
    curve,
    reversed,
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
  };
}

/**
 * An edge with no curve whose two ends are one point: the file closes a cone's
 * face at its apex with a loop of one such edge. STEP needs no bound there.
 */
export function isApexEdge(e: AsmBodyEdge): boolean {
  if (e.curve.kind !== 'other' || e.curve.type !== NO_CURVE || !e.start) return false;
  const end = e.end ?? e.start;
  return Math.hypot(end[0] - e.start[0], end[1] - e.start[1], end[2] - e.start[2]) < 1e-9;
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
        coedges.push({ edge: readEdge(records, walk, edge), forward });
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
  const surface = surfaceAt(records, walk, fp[fp.length - 1] ?? -1);
  // The face record's flag is the face's forward sense: true when the face's
  // normal runs with its surface's. A surface the file wrote with a negative
  // radius has its normal reversed, so the face is then reversed too; so has a
  // spline surface whose record runs against its B-spline (STEP's B-spline
  // surface normal is the B-spline's own).
  const inward =
    ((surface.kind === 'sphere' || surface.kind === 'torus') && surface.inward) ||
    (surface.kind === 'bspline' && surface.reversed);
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
 * the faces of the shell that lump names and of the shells chained after it
 * (the outer shell and its voids; the stream's earlier shells are not read).
 * The whole stream is walked once: a shell read
 * already is skipped, and a face, loop or coedge claimed twice throws, so a
 * crafted stream cannot make the read quadratic.
 */
export function asmBodies(records: AsmRecord[]): AsmBodySolid[] {
  let table: SubtypeTable | undefined;
  const walk: Walk = {
    is: isType(records),
    table: () => {
      table ??= subtypeTable(records);
      return table;
    },
    surfaces: new Map(),
    curves: new Map(),
    edges: new Map(),
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
    // A shell names its lump. A lump whose shell names another lump is an
    // earlier record (history): its shell is a stale one whose face chain runs
    // into the live lump's faces, so it is not a solid of its own.
    const owner = firstOf(walk.is, pointers(records[shell]), 'lump');
    if (owner >= 0 && owner !== i) continue;
    walk.shells.add(shell);
    // The lump's shells with faces, in the file's order.
    const shells: AsmBodyFace[][] = [];
    const own = shellFaces(records, walk, shell);
    if (own.length > 0) shells.push(own);
    // A shell's first pointer of its own type is the lump's next shell; each
    // shell is visited once, so a crafted chain ends.
    let next = firstOf(walk.is, pointers(records[shell]), 'shell');
    while (next >= 0 && !walk.shells.has(next)) {
      walk.shells.add(next);
      const faces = shellFaces(records, walk, next);
      if (faces.length > 0) shells.push(faces);
      next = firstOf(walk.is, pointers(records[next]), 'shell');
    }
    out.push(lumpSolid(shells));
  }
  return out;
}

/** An axis-aligned box: min x, y, z, max x, y, z (cm). */
type Box = [number, number, number, number, number, number];

/**
 * A box around a shell: its vertices, a whole circle's or ellipse's extent for
 * a closed edge, a B-spline edge's control points (which hold the curve), and
 * a sphere's or torus's extent for a face with no edge.
 */
function shellBox(faces: AsmBodyFace[]): Box {
  const box: Box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const add = (p: AsmPoint, pad: AsmPoint = [0, 0, 0]): void => {
    for (let k = 0; k < 3; k++) {
      const x = p[k] as number;
      const d = pad[k] as number;
      box[k] = Math.min(box[k] as number, x - d);
      box[k + 3] = Math.max(box[k + 3] as number, x + d);
    }
  };
  for (const face of faces) {
    const s = face.surface;
    if (face.loops.length === 0 && (s.kind === 'sphere' || s.kind === 'torus')) {
      const r = s.kind === 'sphere' ? s.radius : Math.abs(s.major) + s.minor;
      add(s.center, [r, r, r]);
    }
    for (const loop of face.loops)
      for (const { edge } of loop.coedges) {
        if (edge.start) add(edge.start);
        if (edge.end) add(edge.end);
        const c = edge.curve;
        if (c.kind === 'bspline') for (const p of c.spline.points) add(p);
        else if (c.kind === 'ellipse' && edge.start && (!edge.end || same(edge.start, edge.end))) {
          // A closed edge is the whole ellipse: along each axis it reaches
          // √((a·eₖ)² + (b·eₖ)²) from its centre (a, b its two semi-axes).
          const n = unit(c.normal);
          const a = c.major;
          const b = cross(n, a).map((x) => x * c.ratio) as AsmPoint;
          add(
            c.center,
            [0, 1, 2].map((k) => Math.hypot(a[k] as number, b[k] as number)) as AsmPoint,
          );
        }
      }
  }
  return box;
}

const same = (p: AsmPoint, q: AsmPoint): boolean =>
  Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) < 1e-9;
const unit = (v: AsmPoint): AsmPoint => {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};
const cross = (u: AsmPoint, v: AsmPoint): AsmPoint => [
  u[1] * v[2] - u[2] * v[1],
  u[2] * v[0] - u[0] * v[2],
  u[0] * v[1] - u[1] * v[0],
];

/** True when box `a` holds box `b` (to 1e-6 cm). */
const holds = (a: Box, b: Box): boolean =>
  [0, 1, 2].every(
    (k) =>
      (a[k] as number) <= (b[k] as number) + 1e-6 &&
      (a[k + 3] as number) >= (b[k + 3] as number) - 1e-6,
  );

/**
 * A lump's solid from its shells (with faces), in the file's order. One shell
 * is the outside and the rest are voids inside it. The file's order does not
 * say which: over the corpus the outer shell is the chain's first in most
 * lumps and its second in others, and in every one it is the only shell whose
 * box holds all the others'. A lump where no single shell does is marked
 * `unknownOuter`.
 */
function lumpSolid(shells: AsmBodyFace[][]): AsmBodySolid {
  if (shells.length < 2) return { faces: shells[0] ?? [] };
  const boxes = shells.map(shellBox);
  // A box holds every other box exactly when it holds their union, so one
  // pass for the union and one for the candidates keeps a crafted lump of
  // many shells linear.
  const union: Box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const b of boxes)
    for (let k = 0; k < 3; k++) {
      union[k] = Math.min(union[k] as number, b[k] as number);
      union[k + 3] = Math.max(union[k + 3] as number, b[k + 3] as number);
    }
  const outer = boxes.map((a, i) => (holds(a, union) ? i : -1)).filter((i) => i >= 0);
  if (outer.length !== 1)
    return {
      faces: shells[0] as AsmBodyFace[],
      voids: shells.slice(1),
      unknownOuter: true,
    };
  const at = outer[0] as number;
  return { faces: shells[at] as AsmBodyFace[], voids: shells.filter((_, i) => i !== at) };
}
