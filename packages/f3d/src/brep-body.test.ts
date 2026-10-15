/**
 * The B-rep body reader (`asmBodies`) and the STEP writer (`solidToStep`) on
 * hand-built streams: a box, a cylinder, a reversed face, a face with a hole,
 * an unsupported surface, and hostile cycles. Bytes are synthetic, built like
 * `asm.test.ts` does; no real file is used.
 */
import { describe, expect, it } from 'vitest';
import { readAsm } from './asm';
import { type AsmBodySolid, asmBodies } from './asm-body';
import { splinePoint } from './asm-spline';
import { fileBodies } from './body-check';
import { solidStep, torusSpline, utf16StreamName } from './brep-step';
import { F3dFormatError } from './bytes';

type V = [number, number, number];
interface LineIn {
  t: 'line';
  p: V;
  d: V;
}
interface EllipseIn {
  t: 'ellipse';
  c: V;
  n: V;
  major: V;
  ratio: number;
}
/** An `intcurve` with its stored B-spline, as the file writes it. */
interface SplineIn {
  t: 'spline';
  degree: number;
  /** (value, multiplicity) pairs; the file writes the end knots `degree` times. */
  knots: [number, number][];
  points: V[];
  weights?: number[];
  /** 0 open, 1 closed, 2 periodic. */
  form?: number;
  /** The curve record's own sense flag. */
  reversed?: boolean;
  /** Write the block as `{ ref n }`: the n-th subtype block of the stream. */
  ref?: number;
  /** A curve saved with no B-spline (a helix). */
  none?: boolean;
  /** Override the knot count the header says (a crafted record). */
  count?: number;
}
/** An edge that names no curve (the file's edge at a cone's apex). */
interface NoCurveIn {
  t: 'none';
}
type CurveIn = LineIn | EllipseIn | SplineIn | NoCurveIn;
interface Occurrence {
  curve: CurveIn;
  a?: V;
  b?: V;
  forward?: boolean;
  /** The edge's own sense: true when it runs against its curve. */
  reversed?: boolean;
  /** The edge record's two parameters. */
  params?: [number, number];
}
type SurfaceIn =
  | { t: 'plane'; p: V; n: V }
  | { t: 'cone'; c: V; axis: V; major: V; sine: number; cosine: number }
  | { t: 'sphere'; c: V; axis: V; r: number; inward?: boolean }
  | { t: 'torus'; c: V; axis: V; major: number; minor: number; ref?: V; inward?: boolean }
  | {
      t: 'spline';
      uDegree: number;
      vDegree: number;
      uKnots: [number, number][];
      vKnots: [number, number][];
      /** u running fastest, as the file writes them. */
      points: V[];
      weights?: number[];
      /** The surface record's own sense flag. */
      reversed?: boolean;
      /** Override the knot counts the header says (a crafted record). */
      counts?: [number, number];
    }
  | { t: 'other'; type: string };

/** Whether a surface is written with a negative radius (its normal inward). */
const inwardOf = (s: SurfaceIn): boolean =>
  (s.t === 'sphere' || s.t === 'torus') && s.inward === true;
interface FaceIn {
  surface: SurfaceIn;
  reversed?: boolean;
  /** The raw face-record flag (its forward sense); overrides `reversed` when set. */
  forward?: boolean;
  loops: Occurrence[][];
}

const enc = new TextEncoder();
const i64 = (v: number): number[] => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigInt64(0, BigInt(v), true);
  return [...b];
};
const cls = (s: string): number[] => {
  const b = [...enc.encode(s)];
  return [0x0d, b.length, ...b];
};
const ptr = (v: number): number[] => [0x0c, ...i64(v)];
const int = (v: number): number[] => [0x04, ...i64(v)];
const dbl = (x: number): number[] => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, x, true);
  return [0x06, ...b];
};
const vec = (x: number, y: number, z: number): number[] => {
  const b = new Uint8Array(24);
  const view = new DataView(b.buffer);
  [x, y, z].forEach((c, i) => {
    view.setFloat64(i * 8, c, true);
  });
  return [0x13, ...b];
};
const boolean = (b: boolean): number[] => (b ? [0x0a] : [0x0b]);
const str = (s: string): number[] => {
  const b = [...enc.encode(s)];
  return [0x07, b.length, ...b];
};
const rec = (type: string, ...vals: number[][]): number[] => [...cls(type), ...vals.flat(), 0x11];
const OPEN = [0x0f];
const CLOSE = [0x10];
/** A B-spline's knots and points as the file writes them, then its fit tolerance. */
const bsBody = (knots: [number, number][], points: V[], weights?: number[]): number[][] => [
  ...knots.flatMap(([k, m]) => [dbl(k), int(m)]),
  ...points.flatMap((p, i) => [
    dbl(p[0]),
    dbl(p[1]),
    dbl(p[2]),
    ...(weights ? [dbl(weights[i] as number)] : []),
  ]),
  dbl(1e-6),
];
/** An `intcurve` record: sense flag, then its subtype block. */
const intcurve = (c: SplineIn): number[] =>
  rec(
    'intcurve-curve',
    ptr(-1),
    int(-1),
    ptr(-1),
    boolean(c.reversed ?? false),
    OPEN,
    ...(c.ref !== undefined
      ? [cls('ref'), int(c.ref)]
      : c.none
        ? [cls('helix_int_cur'), int(22800), boolean(true), dbl(0), cls('nullbs')]
        : [
            cls('exact_int_cur'),
            int(22800),
            int(0),
            cls(c.weights ? 'nurbs' : 'nubs'),
            int(c.degree),
            int(c.form ?? 0),
            int(c.count ?? c.knots.length),
            ...bsBody(c.knots, c.points, c.weights),
            cls('nullbs'),
          ]),
    CLOSE,
    boolean(false),
    boolean(false),
  );
const splineSurface = (s: Extract<SurfaceIn, { t: 'spline' }>): number[] =>
  rec(
    'spline-surface',
    ptr(-1),
    int(-1),
    ptr(-1),
    boolean(s.reversed ?? false),
    OPEN,
    cls('exact_spl_sur'),
    int(22800),
    int(0),
    cls(s.weights ? 'nurbs' : 'nubs'),
    int(s.uDegree),
    int(s.vDegree),
    ...(s.weights ? [cls('both')] : []),
    int(0),
    int(0),
    int(0),
    int(0),
    int(s.counts?.[0] ?? s.uKnots.length),
    int(s.counts?.[1] ?? s.vKnots.length),
    ...s.uKnots.flatMap(([k, m]) => [dbl(k), int(m)]),
    ...bsBody(s.vKnots, s.points, s.weights),
    CLOSE,
    boolean(false),
    boolean(false),
  );
const header = (): number[] => [
  ...enc.encode('ASM BinaryFile8'),
  ...new Array<number>(32).fill(0),
  ...new Array<number>(6).fill(0).flatMap(() => [0x06, ...new Array<number>(8).fill(0)]),
];
const stream = (...records: number[][]): Uint8Array =>
  new Uint8Array([...header(), ...records.flat()]);

const keyV = (v: V | undefined) => (v ? v.map((x) => x.toFixed(6)).join(',') : '-');
const keyCurve = (c: CurveIn) =>
  c.t === 'line'
    ? `l:${keyV(c.p)}:${keyV(c.d)}`
    : c.t === 'ellipse'
      ? `e:${keyV(c.c)}:${keyV(c.n)}:${keyV(c.major)}:${c.ratio}`
      : `s:${JSON.stringify(c)}`;

/**
 * A stream with one lump holding `faces`, laid out as the reader expects. With
 * `voids`, the lump's shell chain goes on with one shell per entry, each with
 * its own faces.
 */
function solidStream(
  shellFaces: FaceIn[],
  opts: { faceCycle?: boolean; lumps?: number; voids?: FaceIn[][]; staleLump?: boolean } = {},
): Uint8Array {
  const shellsIn = [shellFaces, ...(opts.voids ?? [])];
  const faces = shellsIn.flat();
  // Each shell's faces are a run of the face block: [start, end).
  const runs: [number, number][] = [];
  for (let k = 0, at = 0; k < shellsIn.length; k++) {
    runs.push([at, at + (shellsIn[k] as FaceIn[]).length]);
    at += (shellsIn[k] as FaceIn[]).length;
  }
  const shellOf = (fi: number): number => runs.findIndex(([a, b]) => fi >= a && fi < b);
  const vertexAt = new Map<string, number>();
  const vertices: V[] = [];
  const curveAt = new Map<string, number>();
  const curves: CurveIn[] = [];
  const surfaceAt = new Map<string, number>();
  const surfaces: SurfaceIn[] = [];
  const vertex = (p: V): number => {
    const k = keyV(p);
    const known = vertexAt.get(k);
    if (known !== undefined) return known;
    const at = vertices.push(p) - 1;
    vertexAt.set(k, at);
    return at;
  };
  const curve = (c: CurveIn): number => {
    const k = keyCurve(c);
    const known = curveAt.get(k);
    if (known !== undefined) return known;
    const at = curves.push(c) - 1;
    curveAt.set(k, at);
    return at;
  };
  const surface = (s: SurfaceIn): number => {
    const k = JSON.stringify(s);
    const known = surfaceAt.get(k);
    if (known !== undefined) return known;
    const at = surfaces.push(s) - 1;
    surfaceAt.set(k, at);
    return at;
  };

  // Leaves: a global edge list (an edge shared by two faces has one record) and,
  // per face/loop, the coedge order.
  const edges: Occurrence[] = [];
  const edgeAt = new Map<string, number>();
  const edgeOf = (o: Occurrence): number => {
    const k =
      (o.a && o.b
        ? `line:${[keyV(o.a), keyV(o.b)].sort().join('|')}`
        : `curve:${keyCurve(o.curve)}`) + `:${o.reversed ? 'r' : 'f'}`;
    const known = edgeAt.get(k);
    if (known !== undefined) return known;
    const at = edges.push(o) - 1;
    edgeAt.set(k, at);
    return at;
  };
  const faceCoedges: { edge: number; forward: boolean }[][][] = faces.map((face) => {
    surface(face.surface);
    for (const loop of face.loops)
      for (const o of loop) {
        if (o.a) vertex(o.a);
        if (o.b) vertex(o.b);
        if (o.curve.t !== 'none') curve(o.curve);
      }
    return face.loops.map((loop) =>
      loop.map((o) => ({ edge: edgeOf(o), forward: o.forward ?? true })),
    );
  });
  const flatCoedges = faceCoedges.flat(2);

  // Index blocks, in a fixed order so pointers can be written once.
  const lumps = opts.lumps ?? 1;
  const BODY = 0;
  const LUMP = 1;
  const SHELL = LUMP + lumps;
  const FACE = SHELL + shellsIn.length;
  const LOOP = FACE + faces.length;
  const COEDGE = LOOP + faces.reduce((n, f) => n + f.loops.length, 0);
  const EDGE = COEDGE + flatCoedges.length;
  const VERTEX = EDGE + edges.length;
  const POINT = VERTEX + vertices.length;
  const CURVE = POINT + vertices.length;
  const SURFACE = CURVE + curves.length;

  const records: number[][] = new Array(SURFACE + surfaces.length);
  records[BODY] = rec('body', ptr(-1), int(1), ptr(-1), ptr(LUMP), ptr(-1), ptr(-1));
  for (let li = 0; li < lumps; li++)
    records[LUMP + li] = rec('lump', ptr(-1), int(-1), ptr(-1), ptr(SHELL), ptr(BODY));
  // Each shell names the next one of the lump, then its first face.
  for (let k = 0; k < shellsIn.length; k++)
    records[SHELL + k] = rec(
      'shell',
      ptr(-1),
      int(-1),
      ptr(-1),
      ptr(k + 1 < shellsIn.length ? SHELL + k + 1 : -1),
      ptr(FACE + (runs[k] as [number, number])[0]),
      ptr(-1),
      ptr(LUMP),
    );

  let loopIdx = LOOP;
  let g = 0;
  const loopIds: number[][] = [];
  for (let fi = 0; fi < faces.length; fi++) {
    const ids: number[] = [];
    const faceLoops = faces[fi]?.loops ?? [];
    const faceGroups = faceCoedges[fi] ?? [];
    for (let li = 0; li < faceLoops.length; li++) {
      ids.push(loopIdx);
      const group = faceGroups[li] as { edge: number; forward: boolean }[];
      const first = COEDGE + g;
      for (let ci = 0; ci < group.length; ci++) {
        const occ = flatCoedges[g] as { edge: number; forward: boolean };
        records[COEDGE + g] = rec(
          'coedge',
          ptr(-1),
          int(-1),
          ptr(first + ((ci + 1) % group.length)),
          ptr(first + ((ci + group.length - 1) % group.length)),
          ptr(-1),
          ptr(EDGE + occ.edge),
          ptr(loopIdx),
          ptr(-1),
          boolean(group[ci]?.forward ?? true),
        );
        g++;
      }
      loopIdx++;
    }
    loopIds.push(ids);
  }
  const faceCoedgeBase: number[] = [];
  {
    let acc = 0;
    for (const loops of faceCoedges) {
      faceCoedgeBase.push(acc);
      acc += loops.reduce((n, grp) => n + grp.length, 0);
    }
  }
  for (let fi = 0; fi < faces.length; fi++) {
    const ids = loopIds[fi] as number[];
    for (let li = 0; li < ids.length; li++) {
      const first =
        COEDGE +
        (faceCoedgeBase[fi] as number) +
        (faceCoedges[fi] ?? []).slice(0, li).reduce((n, grp) => n + grp.length, 0);
      records[ids[li] as number] = rec(
        'loop',
        ptr(-1),
        int(-1),
        ptr(li + 1 < ids.length ? (ids[li + 1] as number) : -1),
        ptr(first),
        ptr(FACE + fi),
      );
    }
  }
  for (let fi = 0; fi < faces.length; fi++) {
    const shell = shellOf(fi);
    const [first, end] = runs[shell] as [number, number];
    const next = fi + 1 < end ? FACE + fi + 1 : opts.faceCycle ? FACE + first : -1;
    records[FACE + fi] = rec(
      'face',
      ptr(-1),
      int(-1),
      ptr(next),
      ptr(loopIds[fi]?.[0] ?? -1),
      ptr(SHELL + shell),
      ptr(-1),
      ptr(SURFACE + (surfaceAt.get(JSON.stringify(faces[fi]?.surface)) as number)),
      // The record's flag is the face's forward sense; the reader derives the
      // reversed flag from it and the surface's radius sign.
      boolean(
        faces[fi]?.forward ??
          !(faces[fi]?.reversed ?? false) !== inwardOf((faces[fi] as FaceIn).surface),
      ),
    );
  }

  const coedgeForEdge = (edge: number): number => {
    let at = 0;
    for (const group of faceCoedges.flat())
      for (const c of group) {
        if (c.edge === edge) return COEDGE + at;
        at++;
      }
    return COEDGE;
  };
  for (let ei = 0; ei < edges.length; ei++) {
    const o = edges[ei] as Occurrence;
    records[EDGE + ei] = rec(
      'edge',
      ptr(-1),
      int(-1),
      ptr(o.a ? VERTEX + (vertexAt.get(keyV(o.a)) as number) : -1),
      o.params ? dbl(o.params[0]) : [],
      ptr(o.b ? VERTEX + (vertexAt.get(keyV(o.b)) as number) : -1),
      o.params ? dbl(o.params[1]) : [],
      ptr(coedgeForEdge(ei)),
      ptr(o.curve.t === 'none' ? -1 : CURVE + (curveAt.get(keyCurve(o.curve)) as number)),
      boolean(o.reversed ?? false),
      str('unknown'),
    );
  }
  for (let vi = 0; vi < vertices.length; vi++) {
    const v = vertices[vi] as V;
    records[VERTEX + vi] = rec('vertex', ptr(-1), int(-1), ptr(-1), ptr(POINT + vi));
    records[POINT + vi] = rec('point', ptr(-1), int(-1), ptr(-1), vec(...v));
  }
  for (let ci = 0; ci < curves.length; ci++) {
    const c = curves[ci] as Exclude<CurveIn, NoCurveIn>;
    records[CURVE + ci] =
      c.t === 'spline'
        ? intcurve(c)
        : c.t === 'line'
          ? rec('straight-curve', ptr(-1), int(-1), ptr(-1), vec(...c.p), vec(...c.d))
          : rec(
              'ellipse-curve',
              ptr(-1),
              int(-1),
              ptr(-1),
              vec(...c.c),
              vec(...c.n),
              vec(...c.major),
              dbl(c.ratio),
            );
  }
  for (let si = 0; si < surfaces.length; si++) {
    const s = surfaces[si] as SurfaceIn;
    if (s.t === 'plane')
      records[SURFACE + si] = rec(
        'plane-surface',
        ptr(-1),
        int(-1),
        ptr(-1),
        vec(...s.p),
        vec(...s.n),
      );
    else if (s.t === 'cone')
      records[SURFACE + si] = rec(
        'cone-surface',
        ptr(-1),
        int(-1),
        ptr(-1),
        vec(...s.c),
        vec(...s.axis),
        vec(...s.major),
        dbl(1),
        boolean(false),
        boolean(false),
        dbl(s.sine),
        dbl(s.cosine),
      );
    else if (s.t === 'sphere')
      records[SURFACE + si] = rec(
        'sphere-surface',
        ptr(-1),
        int(-1),
        ptr(-1),
        vec(...s.c),
        dbl(s.inward ? -s.r : s.r),
        vec(...s.axis),
        vec(...((s.axis[0] === 0 && s.axis[2] === 0 ? [0, 0, 1] : [1, 0, 0]) as V)),
      );
    else if (s.t === 'torus')
      records[SURFACE + si] = rec(
        'torus-surface',
        ptr(-1),
        int(-1),
        ptr(-1),
        vec(...s.c),
        vec(...s.axis),
        dbl(s.major),
        dbl(s.inward ? -s.minor : s.minor),
        vec(...(s.ref ?? [1, 0, 0])),
      );
    else if (s.t === 'spline') records[SURFACE + si] = splineSurface(s);
    else records[SURFACE + si] = rec(s.type, ptr(-1), int(-1), ptr(-1));
  }
  if (opts.staleLump) {
    // An earlier lump record: its shell names the live lump and chains into
    // the live shell's faces.
    const at = records.length;
    records.push(rec('lump', ptr(-1), int(-1), ptr(-1), ptr(at + 1), ptr(BODY)));
    records.push(rec('shell', ptr(-1), int(-1), ptr(-1), ptr(-1), ptr(FACE), ptr(-1), ptr(LUMP)));
  }
  return stream(...records);
}

const sub = (a: V, b: V): V => [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
const line = (a: V, b: V): Occurrence => ({ curve: { t: 'line', p: a, d: sub(b, a) }, a, b });
const quad = (a: V, b: V, c: V, d: V): Occurrence[] => [
  line(a, b),
  line(b, c),
  line(c, d),
  line(d, a),
];

const V0: V = [0, 0, 0];
const V1: V = [10, 0, 0];
const V2: V = [10, 10, 0];
const V3: V = [0, 10, 0];
const V4: V = [0, 0, 10];
const V5: V = [10, 0, 10];
const V6: V = [10, 10, 10];
const V7: V = [0, 10, 10];
const boxFaces = (reversed = false): FaceIn[] => [
  { surface: { t: 'plane', p: V0, n: [0, 0, -1] }, reversed, loops: [quad(V0, V3, V2, V1)] },
  { surface: { t: 'plane', p: V4, n: [0, 0, 1] }, loops: [quad(V4, V5, V6, V7)] },
  { surface: { t: 'plane', p: V0, n: [0, -1, 0] }, loops: [quad(V0, V1, V5, V4)] },
  { surface: { t: 'plane', p: V3, n: [0, 1, 0] }, loops: [quad(V3, V7, V6, V2)] },
  { surface: { t: 'plane', p: V0, n: [-1, 0, 0] }, loops: [quad(V0, V4, V7, V3)] },
  { surface: { t: 'plane', p: V1, n: [1, 0, 0] }, loops: [quad(V1, V2, V6, V5)] },
];
function squareAt(offset: number): Occurrence[] {
  const a: V = [offset, offset, 0];
  const b: V = [offset + 1, offset, 0];
  const c: V = [offset + 1, offset + 1, 0];
  const d: V = [offset, offset + 1, 0];
  return [line(a, b), line(b, c), line(c, d), line(d, a)];
}
const firstSolid = (bytes: Uint8Array) => asmBodies(readAsm(bytes))[0] as AsmBodySolid;

const moveV = (v: V, by: V): V => [v[0] + by[0], v[1] + by[1], v[2] + by[2]];
/** A face moved by `by` (its surface, curves and points). */
function moveFace(f: FaceIn, by: V): FaceIn {
  const s = f.surface;
  return {
    ...f,
    surface: s.t === 'plane' ? { ...s, p: moveV(s.p, by) } : s,
    loops: f.loops.map((loop) =>
      loop.map((o) => ({
        ...o,
        ...(o.a ? { a: moveV(o.a, by) } : {}),
        ...(o.b ? { b: moveV(o.b, by) } : {}),
        curve: o.curve.t === 'line' ? { ...o.curve, p: moveV(o.curve.p, by) } : o.curve,
      })),
    ),
  };
}
/**
 * A 2 cm cubic cavity at (at, at, at) inside the 10 cm box: the box's faces
 * scaled down and moved, each face reversed, as the file writes a void's faces
 * (their normals point out of the material, into the cavity).
 */
function cavity(at: number): FaceIn[] {
  const scale = (v: V): V => [at + v[0] / 5, at + v[1] / 5, at + v[2] / 5];
  return boxFaces().map((f) => ({
    surface: f.surface.t === 'plane' ? { ...f.surface, p: scale(f.surface.p) } : f.surface,
    reversed: true,
    loops: f.loops.map((loop) =>
      loop.map((o) => {
        const a = scale(o.a as V);
        const b = scale(o.b as V);
        return line(a, b);
      }),
    ),
  }));
}

describe('asmBodies', () => {
  it('reads a box as one solid with six faces, loops and edges', () => {
    const solids = asmBodies(readAsm(solidStream(boxFaces())));
    expect(solids).toHaveLength(1);
    const faces = (solids[0] as AsmBodySolid).faces;
    expect(faces).toHaveLength(6);
    expect(faces.every((f) => f.loops.length === 1)).toBe(true);
    expect(faces[0]?.loops[0]?.outer).toBe(true);
    expect(faces[0]?.loops[0]?.coedges).toHaveLength(4);
    expect(faces[0]?.loops[0]?.coedges[0]?.edge.curve.kind).toBe('line');
    expect(faces[0]?.loops[0]?.coedges[0]?.edge.start).toEqual([0, 0, 0]);
  });

  it('keeps the face sense and the coedge sense', () => {
    expect(asmBodies(readAsm(solidStream(boxFaces(true))))[0]?.faces[0]?.reversed).toBe(true);
    const one = asmBodies(
      readAsm(
        solidStream([
          {
            surface: { t: 'plane', p: V0, n: [0, 0, 1] },
            loops: [[{ curve: { t: 'line', p: V0, d: [1, 0, 0] }, a: V0, b: V1, forward: false }]],
          },
        ]),
      ),
    );
    expect(one[0]?.faces[0]?.loops[0]?.coedges[0]?.forward).toBe(false);
  });

  it('keeps the edge sense: an edge can run against its curve', () => {
    const against = asmBodies(
      readAsm(
        solidStream([
          {
            surface: { t: 'plane', p: V0, n: [0, 0, 1] },
            loops: [[{ curve: { t: 'line', p: V0, d: [-1, 0, 0] }, a: V0, b: V1 }]],
          },
        ]),
      ),
    );
    const withIt = asmBodies(
      readAsm(
        solidStream([
          {
            surface: { t: 'plane', p: V0, n: [0, 0, 1] },
            loops: [[{ curve: { t: 'line', p: V0, d: [1, 0, 0] }, a: V0, b: V1 }]],
          },
        ]),
      ),
    );
    expect(against[0]?.faces[0]?.loops[0]?.coedges[0]?.edge.reversed).toBe(true);
    expect(withIt[0]?.faces[0]?.loops[0]?.coedges[0]?.edge.reversed).toBe(false);
  });

  it('reads an inner loop as a second, non-outer loop', () => {
    const solid = asmBodies(
      readAsm(
        solidStream([
          { surface: { t: 'plane', p: V0, n: [0, 0, 1] }, loops: [squareAt(0), squareAt(3)] },
        ]),
      ),
    );
    const loops = solid[0]?.faces[0]?.loops;
    expect(loops).toHaveLength(2);
    expect(loops?.[0]?.outer).toBe(true);
    expect(loops?.[1]?.outer).toBe(false);
  });

  it('throws on a crafted face chain that repeats instead of looping', () => {
    expect(() => asmBodies(readAsm(solidStream(boxFaces(), { faceCycle: true })))).toThrow(
      F3dFormatError,
    );
  });

  it('reads a lump’s further shells as voids, each with its own faces', () => {
    const solids = asmBodies(readAsm(solidStream(boxFaces(), { voids: [cavity(2), cavity(6)] })));
    expect(solids).toHaveLength(1);
    expect(solids[0]?.faces).toHaveLength(6);
    expect(solids[0]?.voids?.map((v) => v.length)).toEqual([6, 6]);
    expect(solids[0]?.voids?.[0]?.every((f) => f.reversed)).toBe(true);
    expect(solids[0]?.unknownOuter).toBeUndefined();
    expect(asmBodies(readAsm(solidStream(boxFaces())))[0]?.voids).toBeUndefined();
  });

  it('takes the shell whose box holds the others as the outside, in either order', () => {
    const solid = firstSolid(solidStream(cavity(2), { voids: [boxFaces()] }));
    // The outer box's corner (10, 10, 10) is in `faces`; the cavity is the void.
    const points = (faces: AsmBodySolid['faces']) =>
      faces.flatMap((f) => f.loops.flatMap((l) => l.coedges.map((c) => c.edge.start)));
    expect(points(solid.faces)).toContainEqual([10, 10, 10]);
    expect(solid.voids).toHaveLength(1);
    expect(points(solid.voids?.[0] ?? [])).not.toContainEqual([10, 10, 10]);
  });

  it('marks a lump whose shells do not nest, and the writer refuses it', () => {
    const apart = boxFaces().map((f) => moveFace(f, [20, 0, 0]));
    const solid = firstSolid(solidStream(boxFaces(), { voids: [apart] }));
    expect(solid.unknownOuter).toBe(true);
    expect(solidStep(solid)).toEqual({
      reason: 'unsupported geometry (a solid with voids whose outer shell is not known)',
    });
  });

  it('reads a stream whose many lumps all name one shell just once', () => {
    const solids = asmBodies(readAsm(solidStream(boxFaces(), { lumps: 10_000 })));
    expect(solids).toHaveLength(1);
    expect(solids[0]?.faces).toHaveLength(6);
  });
});

describe('solidToStep', () => {
  it('writes a box as AP214 STEP with planes and edges', () => {
    const { step, reason } = solidStep(firstSolid(solidStream(boxFaces())));
    expect(reason).toBeUndefined();
    expect(step).toContain('ISO-10303-21;');
    expect(step).toContain('AUTOMOTIVE_DESIGN');
    expect((step as string).match(/PLANE\(''/g)).toHaveLength(6);
    expect((step as string).match(/ADVANCED_FACE/g)).toHaveLength(6);
    expect((step as string).match(/EDGE_CURVE/g)).toHaveLength(12);
    expect(step).toContain('MANIFOLD_SOLID_BREP');
    expect(step).toContain('SI_UNIT(.MILLI.,.METRE.)');
    // cm → mm: the box is 10 cm, so a corner sits at 100 mm.
    expect(step).toContain("CARTESIAN_POINT('',(100,100,100))");
  });

  it('writes a cylinder as a cylindrical surface with a circle', () => {
    const { step, reason } = solidStep(
      firstSolid(
        solidStream([
          {
            surface: { t: 'cone', c: V0, axis: [0, 0, 1], major: [5, 0, 0], sine: 0, cosine: 1 },
            loops: [
              [
                {
                  curve: { t: 'ellipse', c: V0, n: [0, 0, 1], major: [5, 0, 0], ratio: 1 },
                  a: [5, 0, 0],
                  b: [5, 0, 0],
                },
              ],
            ],
          },
        ]),
      ),
    );
    expect(reason).toBeUndefined();
    expect(step).toContain('CYLINDRICAL_SURFACE');
    expect(step).toMatch(/CIRCLE\('',#\d+,50\)/); // 5 cm radius → 50 mm
  });

  it('reverses a reversed face’s loop and writes its same-sense true', () => {
    const { step } = solidStep(firstSolid(solidStream(boxFaces(true))));
    // The face's own sense flag is true here (the file winds its loop about the
    // face normal): the loop is reversed, so an orientation flips to false.
    expect(step).toContain('ORIENTED_EDGE');
    expect(step).toMatch(/ORIENTED_EDGE\('',\*,\*,#\d+, \.F\.\)/);
    expect(step).toMatch(/ADVANCED_FACE\([^)]*\)[^;]*,\.T\.\);/);
  });

  it('writes an edge that runs against its curve as a false same-sense', () => {
    const { step } = solidStep(
      firstSolid(
        solidStream([
          {
            surface: { t: 'plane', p: V0, n: [0, 0, 1] },
            loops: [[{ curve: { t: 'line', p: V0, d: [-1, 0, 0] }, a: V0, b: V1 }]],
          },
        ]),
      ),
    );
    expect(step).toMatch(/EDGE_CURVE\('',#\d+,#\d+,#\d+,\.F\.\)/);
  });

  it('marks the first loop outer and a hole as a bound', () => {
    const { step } = solidStep(
      firstSolid(
        solidStream([
          { surface: { t: 'plane', p: V0, n: [0, 0, 1] }, loops: [squareAt(0), squareAt(3)] },
        ]),
      ),
    );
    expect((step as string).match(/FACE_OUTER_BOUND/g)).toHaveLength(1);
    expect((step as string).match(/FACE_BOUND/g)).toHaveLength(1);
  });

  it('refuses an unsupported surface with a reason', () => {
    const { step, reason } = solidStep(
      firstSolid(
        solidStream([{ surface: { t: 'other', type: 'bspline-surface' }, loops: [squareAt(0)] }]),
      ),
    );
    expect(step).toBeUndefined();
    expect(reason).toBe('unsupported geometry (bspline-surface)');
  });

  it('writes a sphere as a spherical surface with its radius', () => {
    const { step, reason } = solidStep(
      firstSolid(
        solidStream([
          {
            surface: { t: 'sphere', c: [1, 2, 3], axis: [0, 0, 1], r: 2.5 },
            loops: [squareAt(0)],
          },
        ]),
      ),
    );
    expect(reason).toBeUndefined();
    expect(step).toMatch(/SPHERICAL_SURFACE\('',#\d+,25\)/);
    expect(step).toContain("CARTESIAN_POINT('',(10,20,30))");
  });

  it('writes a torus as a toroidal surface with its two radii', () => {
    const { step, reason } = solidStep(
      firstSolid(
        solidStream([
          {
            surface: { t: 'torus', c: V0, axis: [0, 0, 1], major: 1.5, minor: 0.25 },
            loops: [squareAt(0)],
          },
        ]),
      ),
    );
    expect(reason).toBeUndefined();
    expect(step).toMatch(/TOROIDAL_SURFACE\('',#\d+,15,2\.5\)/);
  });

  it('writes a torus whose tube is not smaller than its ring as a rational B-spline', () => {
    const { step, reason } = solidStep(
      firstSolid(
        solidStream([
          {
            surface: { t: 'torus', c: V0, axis: [0, 0, 1], major: 0.3, minor: 0.3 },
            loops: [squareAt(0)],
          },
        ]),
      ),
    );
    expect(reason).toBeUndefined();
    expect(step).not.toContain('TOROIDAL_SURFACE');
    expect(step).toContain('RATIONAL_B_SPLINE_SURFACE');
  });

  it('writes a reversed, inward sphere with a positive radius and same-sense false', () => {
    const solid = firstSolid(
      solidStream([
        {
          surface: { t: 'sphere', c: [1, 2, 3], axis: [0, 0, 1], r: 2.5, inward: true },
          reversed: true,
          loops: [squareAt(0)],
        },
      ]),
    );
    expect(solid.faces[0]?.reversed).toBe(true);
    const { step, reason } = solidStep(solid);
    expect(reason).toBeUndefined();
    expect(step).toMatch(/SPHERICAL_SURFACE\('',#\d+,25\)/); // radius positive
    expect(step).toMatch(/ADVANCED_FACE\([^)]*\)[^;]*,.F\.\);/); // face reversed
  });

  it('writes a reversed, inward torus with a positive minor radius and same-sense false', () => {
    const solid = firstSolid(
      solidStream([
        {
          surface: { t: 'torus', c: V0, axis: [0, 0, 1], major: 1.5, minor: 0.25, inward: true },
          reversed: true,
          loops: [squareAt(0)],
        },
      ]),
    );
    expect(solid.faces[0]?.reversed).toBe(true);
    const { step, reason } = solidStep(solid);
    expect(reason).toBeUndefined();
    expect(step).toMatch(/TOROIDAL_SURFACE\('',#\d+,15,2\.5\)/); // minor positive
    expect(step).toMatch(/ADVANCED_FACE\([^)]*\)[^;]*,.F\.\);/);
  });

  it('writes an inward-signed sphere body, and the body check checks it', () => {
    const solid = firstSolid(
      solidStream([
        {
          surface: { t: 'sphere', c: [1, 2, 3], axis: [0, 0, 1], r: 2.5, inward: true },
          loops: [squareAt(0)],
        },
      ]),
    );
    const { step, reason } = solidStep(solid);
    expect(reason).toBeUndefined();
    expect(step).toBeDefined();
    const measured = new Map([[1, { volume: 100, box: [0, 0, 0, 1, 1, 1] } as const]]);
    const bodies = fileBodies(
      [{ record: 1, name: 'Body1', step }],
      [{ record: 1, name: 'Body1' }],
      measured,
    );
    expect(bodies[0]?.measure).toEqual({ volume: 100, box: [0, 0, 0, 1, 1, 1] });
    expect(bodies[0]?.unchecked).toBeUndefined();
  });

  it('reverses the face a negative-radius surface points the other way', () => {
    // The same raw face flag (forward) gives a forward face on a positive-radius
    // surface and a reversed face on a negative-radius one.
    const plain = firstSolid(
      solidStream([
        {
          surface: { t: 'sphere', c: [1, 2, 3], axis: [0, 0, 1], r: 2.5 },
          forward: false,
          loops: [squareAt(0)],
        },
      ]),
    );
    const inward = firstSolid(
      solidStream([
        {
          surface: { t: 'sphere', c: [1, 2, 3], axis: [0, 0, 1], r: 2.5, inward: true },
          forward: false,
          loops: [squareAt(0)],
        },
      ]),
    );
    expect(plain.faces[0]?.reversed).toBe(true);
    expect(inward.faces[0]?.reversed).toBe(false);
  });

  it('refuses a torus with a negative ring radius with its own reason', () => {
    const { step, reason } = solidStep(
      firstSolid(
        solidStream([
          {
            surface: { t: 'torus', c: V0, axis: [0, 0, 1], major: -1.5, minor: 0.25 },
            loops: [squareAt(0)],
          },
        ]),
      ),
    );
    expect(step).toBeUndefined();
    expect(reason).toBe('unsupported geometry (a torus with a negative ring radius)');
  });

  it('declares every box face normal outward, after its same-sense', () => {
    const solid = firstSolid(solidStream(boxFaces()));
    const all: V[] = [];
    for (const f of solid.faces)
      for (const l of f.loops) for (const c of l.coedges) if (c.edge.start) all.push(c.edge.start);
    const avg = (ps: V[], k: number): number =>
      ps.reduce((a, p) => a + (p[k] as number), 0) / ps.length;
    const centre: V = [avg(all, 0), avg(all, 1), avg(all, 2)];
    for (const f of solid.faces) {
      if (f.surface.kind !== 'plane') throw new Error('box face is not a plane');
      const n = f.surface.normal;
      // `same_sense` is true for a not-reversed face, so the declared normal is
      // the surface's own unless the face is reversed.
      const declared = (f.reversed ? n.map((x) => -x) : n) as V;
      const pts: V[] = [];
      for (const l of f.loops) for (const c of l.coedges) if (c.edge.start) pts.push(c.edge.start);
      const at: V = [avg(pts, 0), avg(pts, 1), avg(pts, 2)];
      const out: V = [at[0] - centre[0], at[1] - centre[1], at[2] - centre[2]];
      const dot = declared[0] * out[0] + declared[1] * out[1] + declared[2] * out[2];
      expect(dot).toBeGreaterThan(0);
    }
  });

  it('splits a closed circle edge into two half edges at its antipode', () => {
    const { step, reason } = solidStep(
      firstSolid(
        solidStream([
          {
            surface: { t: 'plane', p: V0, n: [0, 0, 1] },
            loops: [
              [
                {
                  curve: { t: 'ellipse', c: V0, n: [0, 0, 1], major: [5, 0, 0], ratio: 1 },
                  a: [5, 0, 0],
                  b: [5, 0, 0],
                },
              ],
            ],
          },
        ]),
      ),
    );
    expect(reason).toBeUndefined();
    // Two EDGE_CURVEs on the same circle, meeting at the antipode (−5, 0, 0).
    expect((step as string).match(/EDGE_CURVE/g)).toHaveLength(2);
    expect(step).toContain("CARTESIAN_POINT('',(-50,0,0))");
  });

  // A cone's file slope is sine/cosine; a negative slope narrows along its axis.
  // STEP's semi-angle is positive and the cone widens along the placement's +Z.
  const coneSolid = (sine: number) =>
    firstSolid(
      solidStream([
        {
          surface: { t: 'cone', c: V0, axis: [0, 0, 1], major: [5, 0, 0], sine, cosine: 1 },
          loops: [[line(V0, V1)]],
        },
      ]),
    );

  it('writes a widening cone with its axis and a positive semi-angle', () => {
    const { step, reason } = solidStep(coneSolid(0.5));
    expect(reason).toBeUndefined();
    expect(step).toMatch(/CONICAL_SURFACE\('',#\d+,50,0\.463647609\)/);
    expect(step).toContain("DIRECTION('',(0,0,1))");
    expect(step).not.toContain("DIRECTION('',(0,0,-1))");
  });

  it('writes a narrowing cone with the axis flipped, same positive semi-angle', () => {
    const { step, reason } = solidStep(coneSolid(-0.5));
    expect(reason).toBeUndefined();
    expect(step).toMatch(/CONICAL_SURFACE\('',#\d+,50,0\.463647609\)/);
    expect(step).toContain("DIRECTION('',(0,0,-1))");
  });

  it('refuses an edge with no vertex instead of writing a broken shell', () => {
    const { step, reason } = solidStep(
      firstSolid(
        solidStream([
          {
            surface: { t: 'plane', p: V0, n: [0, 0, 1] },
            loops: [[{ curve: { t: 'line', p: V0, d: [1, 0, 0] } }]],
          },
        ]),
      ),
    );
    expect(step).toBeUndefined();
    expect(reason).toBe('unsupported geometry (an edge with no vertex)');
  });

  it('refuses a face with no boundary', () => {
    const { step, reason } = solidStep(
      firstSolid(solidStream([{ surface: { t: 'plane', p: V0, n: [0, 0, 1] }, loops: [] }])),
    );
    expect(step).toBeUndefined();
    expect(reason).toBe('unsupported geometry (a face with no boundary)');
  });

  it('refuses a loop with no edge', () => {
    const { step, reason } = solidStep(
      firstSolid(solidStream([{ surface: { t: 'plane', p: V0, n: [0, 0, 1] }, loops: [[]] }])),
    );
    expect(step).toBeUndefined();
    expect(reason).toBe('unsupported geometry (a loop with no edge)');
  });
});

describe('degenerate tori', () => {
  type Torus = Parameters<typeof torusSpline>[0];
  const torus = (major: number, minor: number): Torus => ({
    kind: 'torus',
    center: [1, 2, 3],
    axis: [0, 0, 1],
    ref: [1, 0, 0],
    major,
    minor,
    inward: false,
  });
  /** The surface at (u, v): its weights are a u weight times a v weight, so rows then a column. */
  const at = (s: ReturnType<typeof torusSpline>, u: number, v: number): V => {
    const row = (i: number) =>
      splinePoint(
        {
          degree: 2,
          knots: s.vKnots,
          mults: s.vMults,
          points: s.points[i] as V[],
          weights: s.weights?.[i] as number[],
          closed: false,
        },
        v,
      );
    return splinePoint(
      {
        degree: 2,
        knots: s.uKnots,
        mults: s.uMults,
        points: s.points.map((_, i) => row(i)),
        weights: s.weights?.map((w) => w[0] as number),
        closed: true,
      },
      u,
    );
  };
  for (const [name, major, minor] of [
    ['an apple (tube larger than ring)', 1, 2],
    ['a horn (tube equal to ring)', 1.5, 1.5],
    ['a lemon (negative ring)', -1, 2],
  ] as const)
    it(`writes ${name} as the tube's arc on its side of the axis, swept round`, () => {
      const s = torusSpline(torus(major, minor), 0.4);
      const [u0, u1] = [s.uKnots[0] as number, s.uKnots[s.uKnots.length - 1] as number];
      const [v0, v1] = [s.vKnots[0] as number, s.vKnots[s.vKnots.length - 1] as number];
      expect(u0).toBeCloseTo(0.4, 12);
      expect(u1 - u0).toBeCloseTo(2 * Math.PI, 12);
      for (let a = 0; a <= 8; a++)
        for (let b = 0; b <= 8; b++) {
          const u = u0 + ((u1 - u0) * a) / 8;
          const v = v0 + ((v1 - v0) * b) / 8;
          const p = at(s, u, v);
          const q: V = [p[0] - 1, p[1] - 2, p[2] - 3];
          const radial = q[0] * Math.cos(u) + q[1] * Math.sin(u);
          // On the tube circle centred at the signed ring radius, on its own side of the axis.
          expect(Math.hypot(radial - major, q[2])).toBeCloseTo(minor, 9);
          expect(radial).toBeGreaterThan(-1e-9);
          expect(Math.abs(q[0] * Math.sin(u) - q[1] * Math.cos(u))).toBeLessThan(1e-9);
          // The two ends of the arc are on the axis.
          if (b === 0 || b === 8) expect(radial).toBeCloseTo(0, 9);
          if (b === 4 && a === 3) {
            // u × v points out of the tube.
            const h = 1e-6;
            const du = at(s, u + h, v).map((x, k) => x - (p[k] as number)) as V;
            const dv = at(s, u, v + h).map((x, k) => x - (p[k] as number)) as V;
            const n: V = [
              du[1] * dv[2] - du[2] * dv[1],
              du[2] * dv[0] - du[0] * dv[2],
              du[0] * dv[1] - du[1] * dv[0],
            ];
            const out: V = [q[0] - major * Math.cos(u), q[1] - major * Math.sin(u), q[2]];
            expect(n[0] * out[0] + n[1] * out[1] + n[2] * out[2]).toBeGreaterThan(0);
          }
        }
    });
});

describe('cone apex and earlier lumps', () => {
  // A cone narrowing to its apex at (0, 0, 1): base circle of radius 1 at z = 0.
  const apex: V = [0, 0, 1];
  const rim: V = [1, 0, 0];
  const circle: Occurrence = {
    curve: { t: 'ellipse', c: V0, n: [0, 0, 1], major: [1, 0, 0], ratio: 1 },
    a: rim,
    b: rim,
  };
  const point: Occurrence = { curve: { t: 'none' }, a: apex, b: apex };
  const cone = (loops: Occurrence[][]): FaceIn => ({
    surface: {
      t: 'cone',
      c: V0,
      axis: [0, 0, 1],
      major: [1, 0, 0],
      sine: -Math.SQRT1_2,
      cosine: Math.SQRT1_2,
    },
    loops,
  });

  it('leaves out the loop the file closes a cone with at its apex', () => {
    for (const loops of [
      [[circle], [point]],
      [[point], [circle]],
    ]) {
      const { step, reason } = solidStep(firstSolid(solidStream([cone(loops)])));
      expect(reason).toBeUndefined();
      expect(step?.match(/FACE_(OUTER_)?BOUND\(/g)).toHaveLength(1);
    }
  });

  it('still refuses an edge with no curve between two points', () => {
    const open: Occurrence = { curve: { t: 'none' }, a: rim, b: apex };
    const { reason } = solidStep(firstSolid(solidStream([cone([[circle], [open]])])));
    expect(reason).toBe('unsupported geometry (none)');
  });

  it('skips an earlier lump whose shell names the live lump', () => {
    const solids = asmBodies(readAsm(solidStream(boxFaces(), { staleLump: true })));
    expect(solids).toHaveLength(1);
    expect(solids[0]?.faces).toHaveLength(6);
  });
});

describe('loop winding', () => {
  /** The written loop: each oriented edge's edge-curve id and flag, in order. */
  const loopOf = (step: string): string[] => {
    const loop = step.match(/EDGE_LOOP\('',\(([^)]*)\)\)/)?.[1] ?? '';
    return loop.split(',').map((ref) => {
      const line = step.match(
        new RegExp(`${ref}=ORIENTED_EDGE\\('',\\*,\\*,(#\\d+), \\.(T|F)\\.\\)`),
      );
      return `${line?.[1]}${line?.[2]}`;
    });
  };
  it('follows the file’s face flag on a negative-radius surface, not the folded sense', () => {
    // The same raw flag on a sphere signed outward and inward: the faces' senses
    // differ (the reader folds the sign in), the loop the file wound does not.
    const face = (inward: boolean): FaceIn => ({
      surface: { t: 'sphere', c: [1, 2, 3], axis: [0, 0, 1], r: 2.5, inward },
      forward: true,
      loops: [squareAt(0)],
    });
    const plain = solidStep(firstSolid(solidStream([face(false)]))).step as string;
    const inward = solidStep(firstSolid(solidStream([face(true)]))).step as string;
    expect(plain).toMatch(/ADVANCED_FACE\([^;]*\.T\.\);/);
    expect(inward).toMatch(/ADVANCED_FACE\([^;]*\.F\.\);/);
    expect(loopOf(inward)).toEqual(loopOf(plain));
  });
});

describe('solids with voids', () => {
  it('writes the voids as a BREP_WITH_VOIDS of reversed oriented shells', () => {
    const solid = firstSolid(solidStream(boxFaces(), { voids: [cavity(2), cavity(6)] }));
    const step = solidStep(solid).step as string;
    expect(step).not.toContain('MANIFOLD_SOLID_BREP');
    expect(step.match(/CLOSED_SHELL\('',\(/g)).toHaveLength(3);
    const oriented = [...step.matchAll(/#(\d+)=ORIENTED_CLOSED_SHELL\('',\*,#\d+,\.F\.\);/g)];
    expect(oriented).toHaveLength(2);
    const ids = oriented.map((m) => `#${m[1]}`).join(',');
    expect(step).toMatch(new RegExp(`=BREP_WITH_VOIDS\\('body',#\\d+,\\(${ids}\\)\\);`));
    // A void's faces keep the file's sense: reversed, same-sense false.
    expect(step.match(/ADVANCED_FACE\([^;]*\.F\.\);/g)).toHaveLength(12);
  });
});

describe('B-spline curves and surfaces', () => {
  // A cubic from V0 to V1 (cm) with the file's end multiplicities (3, not 4).
  const cubic = (extra: Partial<SplineIn> = {}): SplineIn => ({
    t: 'spline',
    degree: 3,
    knots: [
      [0, 3],
      [1, 3],
    ],
    points: [V0, [3, 1, 0], [7, 1, 0], V1],
    ...extra,
  });
  const splineEdge = (c: SplineIn, params: [number, number] = [0, 1]): Occurrence => ({
    curve: c,
    a: V0,
    b: V1,
    params,
  });
  const onPlane = (...edges: Occurrence[]) =>
    firstSolid(
      solidStream([
        // Closed through V2: the builder shares an edge record between two
        // occurrences with the same two vertices.
        {
          surface: { t: 'plane', p: V0, n: [0, 0, 1] },
          loops: [[...edges, line(V1, V2), line(V2, V0)]],
        },
      ]),
    );
  const firstEdge = (solid: AsmBodySolid) => solid.faces[0]?.loops[0]?.coedges[0]?.edge;
  // A closed polyline square of degree 1, five points, the first repeated last.
  const square = (extra: Partial<SplineIn> = {}): SplineIn => ({
    t: 'spline',
    degree: 1,
    form: 1,
    knots: [
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
    ],
    points: [V0, [1, 0, 0], [1, 1, 0], [0, 1, 0], V0],
    ...extra,
  });

  it('reads an intcurve’s stored B-spline, its end knots raised to degree + 1', () => {
    const edge = firstEdge(onPlane(splineEdge(cubic())));
    expect(edge?.curve.kind).toBe('bspline');
    if (edge?.curve.kind !== 'bspline') return;
    expect(edge.curve.spline.degree).toBe(3);
    expect(edge.curve.spline.knots).toEqual([0, 1]);
    expect(edge.curve.spline.mults).toEqual([4, 4]);
    expect(edge.curve.spline.points).toHaveLength(4);
    expect(edge.curve.spline.weights).toBeUndefined();
    expect(edge.range).toEqual([0, 1]);
    expect(edge.reversed).toBe(false);
  });

  it('follows a { ref n } block to the n-th subtype block of the stream', () => {
    const solid = firstSolid(
      solidStream([
        {
          surface: { t: 'plane', p: V0, n: [0, 0, 1] },
          loops: [[splineEdge(cubic()), { ...splineEdge(cubic({ ref: 0 })), a: V1, b: V2 }]],
        },
      ]),
    );
    const first = solid.faces[0]?.loops[0]?.coedges[0]?.edge;
    const second = solid.faces[0]?.loops[0]?.coedges[1]?.edge;
    expect(second?.id).not.toBe(first?.id);
    expect(second?.curve.kind).toBe('bspline');
    if (second?.curve.kind === 'bspline') expect(second.curve.spline.points[1]).toEqual([3, 1, 0]);
  });

  it('folds the curve record’s sense into the edge, and maps its parameters', () => {
    // The curve runs against its B-spline: the edge's parameters are negated.
    const edge = firstEdge(onPlane(splineEdge(cubic({ reversed: true }), [-1, 0])));
    expect(edge?.reversed).toBe(true);
    expect(edge?.range?.map((t) => t + 0)).toEqual([0, 1]); // −0 + 0 is 0
    const { step } = solidStep(onPlane(splineEdge(cubic({ reversed: true }), [-1, 0])));
    expect(step).toMatch(/EDGE_CURVE\('',#\d+,#\d+,#\d+,\.F\.\)/);
  });

  it('writes a B-spline curve in mm with STEP’s knot multiplicities', () => {
    const { step, reason } = solidStep(onPlane(splineEdge(cubic())));
    expect(reason).toBeUndefined();
    expect(step).toMatch(
      /B_SPLINE_CURVE_WITH_KNOTS\('',3,\(#\d+,#\d+,#\d+,#\d+\),\.UNSPECIFIED\.,\.F\.,\.F\.,\(4,4\),\(0,1\),\.UNSPECIFIED\.\)/,
    );
    expect(step).toContain("CARTESIAN_POINT('',(30,10,0))");
  });

  it('writes a weighted curve as a rational B-spline', () => {
    const { step, reason } = solidStep(onPlane(splineEdge(cubic({ weights: [1, 0.5, 0.5, 1] }))));
    expect(reason).toBeUndefined();
    expect(step).toContain('(BOUNDED_CURVE()B_SPLINE_CURVE(3,');
    expect(step).toContain('RATIONAL_B_SPLINE_CURVE((1,0.5,0.5,1))');
  });

  it('writes a rational curve whose weights are all 1 as a plain B-spline', () => {
    const { step } = solidStep(onPlane(splineEdge(cubic({ weights: [1, 1, 1, 1] }))));
    expect(step).toContain("B_SPLINE_CURVE_WITH_KNOTS('',3,");
    expect(step).not.toContain('RATIONAL');
  });

  it('splits a closed spline edge at the middle of its stretch', () => {
    const solid = firstSolid(
      solidStream([
        {
          surface: { t: 'plane', p: V0, n: [0, 0, 1] },
          loops: [[{ curve: square(), a: V0, b: V0, params: [0, 4] }]],
        },
      ]),
    );
    const { step, reason } = solidStep(solid);
    expect(reason).toBeUndefined();
    expect((step as string).match(/EDGE_CURVE/g)).toHaveLength(2);
    // The middle of 0…4 is the square's far corner, (1, 1, 0) cm.
    expect(step).toContain("CARTESIAN_POINT('',(10,10,0))");
    expect(step).toContain('.T.,.F.,(2,1,1,1,2)');
  });

  it('splits a closed spline edge that crosses its curve’s seam there', () => {
    const corner: V = [1, 0, 0];
    const solid = firstSolid(
      solidStream([
        {
          surface: { t: 'plane', p: V0, n: [0, 0, 1] },
          loops: [[{ curve: square(), a: corner, b: corner, params: [1, 5] }]],
        },
      ]),
    );
    const { step } = solidStep(solid);
    const edges = (step as string).match(/EDGE_CURVE[^;]*/g) ?? [];
    expect(edges).toHaveLength(2);
    // The seam is the curve's first point, (0, 0, 0); the edge starts at (1, 0, 0).
    expect(step).toContain("CARTESIAN_POINT('',(0,0,0))");
    expect(step).toContain("CARTESIAN_POINT('',(10,0,0))");
  });

  it('refuses an intcurve with no stored B-spline with its own reason', () => {
    const { step, reason } = solidStep(onPlane(splineEdge({ ...cubic(), none: true })));
    expect(step).toBeUndefined();
    expect(reason).toBe('unsupported geometry (an intcurve with no B-spline)');
  });

  it('refuses a crafted knot count instead of reading past the record', () => {
    const edge = firstEdge(onPlane(splineEdge(cubic({ count: 1_000_000_000 }))));
    expect(edge?.curve).toEqual({ kind: 'other', type: 'an intcurve with no B-spline' });
  });

  // A bilinear patch over the unit square, z rising along u (cm).
  const patch = (extra: Partial<Extract<SurfaceIn, { t: 'spline' }>> = {}): SurfaceIn => ({
    t: 'spline',
    uDegree: 1,
    vDegree: 1,
    uKnots: [
      [0, 1],
      [1, 1],
    ],
    vKnots: [
      [0, 1],
      [1, 1],
    ],
    // u fastest: (0,0) (1,0) (0,1) (1,1)
    points: [
      [0, 0, 0],
      [1, 0, 1],
      [0, 1, 0],
      [1, 1, 1],
    ],
    ...extra,
  });
  const onPatch = (surface: SurfaceIn, forward = true) =>
    firstSolid(
      solidStream([
        {
          surface,
          forward,
          loops: [
            [
              line([0, 0, 0], [1, 0, 1]),
              line([1, 0, 1], [1, 1, 1]),
              line([1, 1, 1], [0, 1, 0]),
              line([0, 1, 0], [0, 0, 0]),
            ],
          ],
        },
      ]),
    );

  it('writes a spline surface’s grid with u as the outer list', () => {
    const solid = onPatch(patch());
    expect(solid.faces[0]?.surface.kind).toBe('bspline');
    const { step, reason } = solidStep(solid);
    expect(reason).toBeUndefined();
    const m = (step as string).match(
      /B_SPLINE_SURFACE_WITH_KNOTS\('',1,1,\(\(#(\d+),#(\d+)\),\(#(\d+),#(\d+)\)\),\.UNSPECIFIED\.,\.F\.,\.F\.,\.F\.,\(2,2\),\(2,2\),\(0,1\),\(0,1\),\.UNSPECIFIED\.\)/,
    );
    expect(m).not.toBeNull();
    const point = (ref: string | undefined) =>
      (step as string).match(new RegExp(`#${ref}=CARTESIAN_POINT\\('',\\(([^)]*)\\)\\)`))?.[1];
    // Row u = 0 holds (0,0) and (0,1); row u = 1 holds (1,0) and (1,1), in mm.
    expect([point(m?.[1]), point(m?.[2]), point(m?.[3]), point(m?.[4])]).toEqual([
      '0,0,0',
      '0,10,0',
      '10,0,10',
      '10,10,10',
    ]);
  });

  it('flips the face of a spline surface whose record runs against its B-spline', () => {
    const plain = solidStep(onPatch(patch())).step as string;
    const against = solidStep(onPatch(patch({ reversed: true }))).step as string;
    expect(plain).toMatch(/ADVANCED_FACE\([^;]*,\.T\.\);/);
    expect(against).toMatch(/ADVANCED_FACE\([^;]*,\.F\.\);/);
  });

  it('writes a weighted surface as a rational B-spline surface', () => {
    const { step } = solidStep(onPatch(patch({ weights: [1, 2, 1, 2] })));
    expect(step).toContain('(BOUNDED_SURFACE()B_SPLINE_SURFACE(1,1,');
    expect(step).toContain('RATIONAL_B_SPLINE_SURFACE(((1,1),(2,2)))');
  });

  it('refuses a crafted grid size instead of allocating it', () => {
    const solid = onPatch(patch({ counts: [2, 1_000_000_000] }));
    expect(solid.faces[0]?.surface).toEqual({
      kind: 'other',
      type: 'a spline surface with no B-spline',
    });
  });
});

describe('utf16StreamName', () => {
  const utf16 = (text: string) => Uint8Array.from([...text].flatMap((c) => [c.charCodeAt(0), 0]));

  it('finds a stream name among other bytes', () => {
    const name = 'BREP.0a1b2c3d-0000-4000-8000-00000000abcd.smbh';
    const bytes = new Uint8Array([1, 2, 3, ...utf16(name), 0, 0]);
    expect(utf16StreamName(bytes, 0, bytes.length)).toBe(name);
  });

  it('scans a crafted run of printable UTF-16 in linear time', () => {
    const bytes = utf16('B'.repeat(1 << 20));
    const t0 = performance.now();
    expect(utf16StreamName(bytes, 0, bytes.length)).toBeUndefined();
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe('shared records cost once', () => {
  const count = (step: string | undefined, entity: string) =>
    (step?.match(new RegExp(`${entity}\\(`, 'g')) ?? []).length;
  /** A degree-1 grid of n × n points: one spline surface record. */
  const grid = (n: number): SurfaceIn => ({
    t: 'spline',
    uDegree: 1,
    vDegree: 1,
    uKnots: Array.from({ length: n }, (_, i): [number, number] => [i, 1]),
    vKnots: Array.from({ length: n }, (_, i): [number, number] => [i, 1]),
    points: Array.from({ length: n * n }, (_, i): V => [i % n, Math.floor(i / n), 0]),
  });

  it('writes a spline surface many faces share once, not its points per face', () => {
    // 1,000 faces on one 30 × 30 surface wrote 900,000 points.
    const surface = grid(30);
    const faces = Array.from(
      { length: 1000 },
      (_, i): FaceIn => ({
        surface,
        loops: [squareAt(2 * i)],
      }),
    );
    const solid = firstSolid(solidStream(faces));
    const t = performance.now();
    const { step, reason } = solidStep(solid);
    expect(performance.now() - t).toBeLessThan(1000);
    expect(reason).toBeUndefined();
    expect(count(step, 'B_SPLINE_SURFACE_WITH_KNOTS')).toBe(1);
    expect(count(step, 'ADVANCED_FACE')).toBe(1000);
    // The grid once, a vertex and a line point per edge.
    expect(count(step, 'CARTESIAN_POINT')).toBe(900 + 4000 + 4000 + 1);
  });

  it('reads and writes a B-spline block many curve records name by reference once', () => {
    // The first curve's block holds 1,000 points; 2,000 more curves name it.
    const points = Array.from({ length: 1000 }, (_, i): V => [i, 0, 0]);
    const block: SplineIn = {
      t: 'spline',
      degree: 1,
      knots: points.map((_, i): [number, number] => [i, 1]),
      points,
    };
    const at = (i: number): V => [i, 1, 0];
    const edges: Occurrence[] = [{ curve: block, a: at(0), b: at(1), params: [0, 1] }];
    for (let i = 1; i < 2000; i++)
      edges.push({
        // A distinct record each (the builder shares equal ones), all `{ ref 0 }`.
        curve: { t: 'spline', degree: 1, knots: [], points: [[i, 0, 0]], ref: 0 },
        a: at(i),
        b: at(i + 1),
        params: [0, 1],
      });
    edges.push(line(at(2000), at(0)));
    const bytes = solidStream([{ surface: { t: 'plane', p: V0, n: [0, 0, 1] }, loops: [edges] }]);
    const t = performance.now();
    const solid = firstSolid(bytes);
    const { step, reason } = solidStep(solid);
    expect(performance.now() - t).toBeLessThan(1000);
    expect(reason).toBeUndefined();
    expect(count(step, 'B_SPLINE_CURVE_WITH_KNOTS')).toBe(1);
    expect(count(step, 'EDGE_CURVE')).toBe(2001);
  });

  it('reads an edge many coedges name once', () => {
    // 3,000 coedges on one edge whose curve holds 2,000 points.
    const points = Array.from({ length: 2000 }, (_, i): V => [i, 0, 0]);
    const curve: SplineIn = {
      t: 'spline',
      degree: 1,
      knots: points.map((_, i): [number, number] => [i, 1]),
      points,
    };
    const o: Occurrence = { curve, a: V0, b: V1, params: [0, 1] };
    const bytes = solidStream([
      { surface: { t: 'plane', p: V0, n: [0, 0, 1] }, loops: [new Array(3000).fill(o)] },
    ]);
    const records = readAsm(bytes);
    const t = performance.now();
    const coedges = (asmBodies(records)[0] as AsmBodySolid).faces[0]?.loops[0]?.coedges ?? [];
    expect(performance.now() - t).toBeLessThan(1000);
    expect(coedges).toHaveLength(3000);
    expect(coedges[2999]?.edge).toBe(coedges[0]?.edge);
  });

  it('refuses a body whose STEP text passes the cap, with a reason', () => {
    expect(solidStep(firstSolid(solidStream(boxFaces())), 1000).reason).toBe(
      'unsupported geometry (a body of more than 1000 bytes of STEP)',
    );
  });
});
