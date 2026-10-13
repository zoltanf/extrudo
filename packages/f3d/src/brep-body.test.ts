/**
 * The B-rep body reader (`asmBodies`) and the STEP writer (`solidToStep`) on
 * hand-built streams: a box, a cylinder, a reversed face, a face with a hole,
 * an unsupported surface, and hostile cycles. Bytes are synthetic, built like
 * `asm.test.ts` does; no real file is used.
 */
import { describe, expect, it } from 'vitest';
import { readAsm } from './asm';
import { type AsmBodySolid, asmBodies } from './asm-body';
import { solidStep } from './brep-step';
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
type CurveIn = LineIn | EllipseIn;
interface Occurrence {
  curve: CurveIn;
  a?: V;
  b?: V;
  forward?: boolean;
}
type SurfaceIn =
  | { t: 'plane'; p: V; n: V }
  | { t: 'cone'; c: V; axis: V; major: V; sine: number; cosine: number }
  | { t: 'torus' };
interface FaceIn {
  surface: SurfaceIn;
  reversed?: boolean;
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
    : `e:${keyV(c.c)}:${keyV(c.n)}:${keyV(c.major)}:${c.ratio}`;

/** A stream with one lump holding `faces`, laid out as the reader expects. */
function solidStream(
  faces: FaceIn[],
  opts: { faceCycle?: boolean; lumps?: number } = {},
): Uint8Array {
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
      o.a && o.b ? `line:${[keyV(o.a), keyV(o.b)].sort().join('|')}` : `curve:${keyCurve(o.curve)}`;
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
        curve(o.curve);
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
  const FACE = SHELL + 1;
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
  records[SHELL] = rec('shell', ptr(-1), int(-1), ptr(-1), ptr(-1), ptr(FACE), ptr(-1), ptr(LUMP));

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
    const next = opts.faceCycle
      ? fi + 1 < faces.length
        ? FACE + fi + 1
        : FACE
      : fi + 1 < faces.length
        ? FACE + fi + 1
        : -1;
    records[FACE + fi] = rec(
      'face',
      ptr(-1),
      int(-1),
      ptr(next),
      ptr(loopIds[fi]?.[0] ?? -1),
      ptr(SHELL),
      ptr(-1),
      ptr(SURFACE + (surfaceAt.get(JSON.stringify(faces[fi]?.surface)) as number)),
      boolean(faces[fi]?.reversed ?? false),
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
      ptr(o.b ? VERTEX + (vertexAt.get(keyV(o.b)) as number) : -1),
      ptr(coedgeForEdge(ei)),
      ptr(CURVE + (curveAt.get(keyCurve(o.curve)) as number)),
      boolean(false),
      str('unknown'),
    );
  }
  for (let vi = 0; vi < vertices.length; vi++) {
    const v = vertices[vi] as V;
    records[VERTEX + vi] = rec('vertex', ptr(-1), int(-1), ptr(-1), ptr(POINT + vi));
    records[POINT + vi] = rec('point', ptr(-1), int(-1), ptr(-1), vec(...v));
  }
  for (let ci = 0; ci < curves.length; ci++) {
    const c = curves[ci] as CurveIn;
    records[CURVE + ci] =
      c.t === 'line'
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
    else
      records[SURFACE + si] = rec(
        'torus-surface',
        ptr(-1),
        int(-1),
        ptr(-1),
        vec(0, 0, 0),
        vec(0, 0, 1),
      );
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

  it('keeps a reversed face as a false same-sense', () => {
    const { step } = solidStep(firstSolid(solidStream(boxFaces(true))));
    expect(step).toContain(',.F.);');
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
      firstSolid(solidStream([{ surface: { t: 'torus' }, loops: [squareAt(0)] }])),
    );
    expect(step).toBeUndefined();
    expect(reason).toBe('unsupported geometry (torus-surface)');
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
