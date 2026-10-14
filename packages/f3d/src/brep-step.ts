/**
 * A body of the file's B-rep streams → AP214 STEP text (mm), for planes,
 * cylinders, cones, spheres, tori and the B-spline surfaces the file stores for
 * its procedural ones, with straight, elliptical (circle) and B-spline edges.
 * A solid with voids is written as `BREP_WITH_VOIDS`, and a torus whose tube is
 * not smaller than its ring (or whose ring radius is negative) as the exact
 * rational B-spline of the part its face uses. Anything else (a helix, which
 * keeps no B-spline) is refused with a reason.
 *
 * The body a design record names is found through its body container
 * (`FORMAT.md`, `CD57BC48…`): a container lists the bodies of its component in
 * order and points at a stream-file record (`74CA4562…` / `40DCC3F4…`), whose
 * payload is the `BREP.<uuid>.smb[h]` entry name. Inside the stream the solids
 * are the `lump` records in order (each lump names its live shell, so the
 * stream's earlier shells are left behind). A body is paired with its solid by
 * the operations on the solid's faces (`brep-lumps.ts`), and by the container's
 * order only where those agree. Only the design's visible bodies are written; a
 * hidden body is left out, as a STEP export of the design leaves it out.
 *
 * This writer does not touch the importer's behaviour (`map.ts`): it is the
 * decoder slice a later change will feed through the `import` feature.
 */
import { designSegments, type Entries, unzip } from './archive';
import { type AsmCurve, type AsmSurface, readAsm } from './asm';
import {
  type AsmBodyEdge,
  type AsmBodyFace,
  type AsmBodySolid,
  asmBodies,
  isApexEdge,
} from './asm-body';
import { type AsmBSplineCurve, type AsmBSplineSurface, splinePoint } from './asm-spline';
import { type LumpClaim, lumpOps, pairLumps } from './brep-lumps';
import { BODY } from './decode/body';
import { activeDesignSegment, type F3dDesign, readF3dEntries, refsIn } from './model';
import { Segment } from './segment';

export interface BodyStep {
  /** The body record. The body's file number is not unique across components. */
  record: number;
  /** `Body<n>`, the body's number in the file. */
  name: string;
  /** The file component record the body is in, when the file says. */
  component?: number;
  /** The STEP text, when the body was written. */
  step?: string;
  /** Why the body was not written. */
  reason?: string;
}

/** A body with a surface or curve this writer does not carry. */
export class UnsupportedGeometry extends Error {
  readonly type: string;
  constructor(type: string) {
    super(`unsupported ${type}`);
    this.name = 'UnsupportedGeometry';
    this.type = type;
  }
}

const CONTAINER = 'CD57BC48-50EC-47DC-975A-FB6DEA72F4DA';
/**
 * The two container members that name a stream file. These are the type table's
 * own 36-character GUID strings, not standard 8-4-4-4-12 ones: the second has
 * ten hex digits before its first dash, as the file writes it, and containers
 * with bodies do use it (both were read from the bulk, not guessed).
 */
const STREAM_RECORDS = [
  '74CA4562-59F8-4C97-8AD1-F8297C21F9AA',
  '40DCC3F41D-E94F-B3B1-3E95-9B6ABE572C',
];

/**
 * The stream file each body of the design names, with its order in the
 * container that names it: `Map<body record, { file, index }>`. Found through the containers;
 * the first container that names the body and a stream file wins.
 */
function bodyStreams(seg: Segment): Map<number, { file: string; index: number }> {
  const out = new Map<number, { file: string; index: number }>();
  // A stream-file record is scanned once, however many containers name it.
  const names = new Map<number, string | undefined>();
  const nameOf = (r: number): string | undefined => {
    if (!names.has(r)) names.set(r, streamName(seg, r));
    return names.get(r);
  };
  for (const id of seg.idsOf(CONTAINER)) {
    let frame: ReturnType<Segment['frame']>;
    try {
      frame = seg.frame(id);
    } catch {
      continue;
    }
    const refs = refsIn(seg, frame.start, frame.end).filter((r) => seg.has(r));
    const bodies = [...new Set(refs.filter((r) => seg.typeOf(r)?.guid.startsWith(BODY)))];
    if (bodies.length === 0) continue;
    const fileRef = refs.find((r) => {
      const guid = seg.typeOf(r)?.guid ?? '';
      return STREAM_RECORDS.some((g) => guid.startsWith(g)) && nameOf(r) !== undefined;
    });
    if (fileRef === undefined) continue;
    const file = nameOf(fileRef) as string;
    bodies.forEach((body, index) => {
      if (!out.has(body)) out.set(body, { file, index });
    });
  }
  return out;
}

/** The `BREP.<uuid>.smb[h]` name a stream-file record carries, if any. */
function streamName(seg: Segment, id: number): string | undefined {
  let frame: ReturnType<Segment['frame']>;
  try {
    frame = seg.frame(id);
  } catch {
    return undefined;
  }
  return utf16StreamName(seg.bulk, frame.start, frame.end);
}

/** The longest name: `BREP.` + a 36-character uuid + `.smbh`. */
const MAX_NAME = 46;

/**
 * The first UTF-16LE `BREP.<uuid>.smb[h]` name in `bytes[start, end)`. Each
 * candidate is read for at most `MAX_NAME` characters, so the scan is linear in
 * the range however the bytes are crafted.
 */
export function utf16StreamName(bytes: Uint8Array, start: number, end: number): string | undefined {
  for (let i = start; i + 10 <= end; i++) {
    if (bytes[i] !== 0x42 || bytes[i + 1] !== 0x00) continue;
    let s = '';
    for (let k = i; k + 1 < end && s.length <= MAX_NAME; k += 2) {
      const c = (bytes[k] as number) | ((bytes[k + 1] as number) << 8);
      if (c < 0x20 || c > 0x7e) break;
      s += String.fromCharCode(c);
    }
    if (/^BREP\.[0-9a-f-]+\.smbh?$/i.test(s)) return s;
  }
  return undefined;
}

/** The `BREP.*.smb[h]` entry with this name, wherever the design's asset folder is. */
function entryFor(entries: Entries, file: string): Uint8Array | undefined {
  for (const [name, bytes] of entries) if (name.endsWith(`/${file}`)) return bytes;
  return undefined;
}

/** The solid as AP214 STEP text (mm). Throws `UnsupportedGeometry` on a surface or curve it does not carry. */
export function solidToStep(solid: AsmBodySolid): string {
  // A lump with several shells whose outside is not known would come out wrong.
  if (solid.unknownOuter)
    throw new UnsupportedGeometry('a solid with voids whose outer shell is not known');
  const w = new StepWriter();
  const ctx = header(w);
  const vertexAt = new Map<string, number>();
  const edgeAt = new Map<number, number[]>();
  const vertex = (p: [number, number, number]): number => {
    const key = p.map((x) => x.toFixed(7)).join(',');
    const cached = vertexAt.get(key);
    if (cached !== undefined) return cached;
    const at = w.add("VERTEX_POINT('',#{})", [w.point(p)]);
    vertexAt.set(key, at);
    return at;
  };
  /**
   * The STEP edges of one file edge, in order. A closed edge (a full circle
   * whose two vertices are the same point) is split at its antipode into two
   * half edges: a kernel reads a start-equals-end `EDGE_CURVE` as a degenerate
   * edge, and the reference exports split them too. A B-spline edge is split
   * where it crosses its closed curve's seam, and a closed one that does not
   * cross it at the middle of its stretch. Any other edge is one.
   */
  const edge = (e: AsmBodyEdge): number[] => {
    const cached = edgeAt.get(e.id);
    if (cached !== undefined) return cached;
    if (e.start === undefined) throw new UnsupportedGeometry('an edge with no vertex');
    // A closed edge (a full circle) may name one vertex; both ends are that point.
    const start = vertex(e.start);
    const end = vertex(e.end ?? e.start);
    const curve = w.curve(e.curve);
    // The edge runs against its curve when the edge record's sense is true, so
    // `EDGE_CURVE`'s same-sense is the opposite of the edge's own sense.
    const same = e.reversed ? 'F' : 'T';
    // The points the edge passes through, in the edge's own direction.
    let via: [number, number, number][] = [];
    if (start === end && e.curve.kind === 'ellipse') {
      const c = e.curve.center;
      via = [[2 * c[0] - e.start[0], 2 * c[1] - e.start[1], 2 * c[2] - e.start[2]]];
    } else if (e.curve.kind === 'bspline') {
      via = splineBreaks(e.curve.spline, e.range, start === end);
      if (e.reversed) via.reverse();
    }
    const chain = [start, ...via.map(vertex), end];
    const refs: number[] = [];
    for (let k = 0; k + 1 < chain.length; k++)
      refs.push(
        w.add("EDGE_CURVE('',#{},#{},#{},.{}.)", [
          chain[k] as number,
          chain[k + 1] as number,
          curve,
          same,
        ]),
      );
    edgeAt.set(e.id, refs);
    return refs;
  };
  /** One shell's faces as a `CLOSED_SHELL`. */
  const closedShell = (faces: AsmBodyFace[]): number => {
    const faceRefs: number[] = [];
    for (const face of faces) {
      const bounds: number[] = [];
      for (const loop of face.loops) {
        // A cone's apex loop (one curveless edge at a point) is left out: a
        // kernel closes the face at the apex itself.
        if (loop.coedges.length > 0 && loop.coedges.every((c) => isApexEdge(c.edge))) continue;
        const oriented: { ref: number; forward: boolean }[] = [];
        for (const coedge of loop.coedges)
          for (const ref of edge(coedge.edge)) oriented.push({ ref, forward: coedge.forward });
        // The file winds a loop against its own surface's normal: a face the
        // file marks forward is written with its loop reversed (and same-sense
        // true), a face it marks reversed keeps the file's loop (same-sense
        // false). A surface the file wrote with a negative radius points the
        // other way than the one written, so the reader has its face marked
        // reversed for the same-sense, but its loop still follows the file's flag.
        if (!face.reversed !== inwardSurface(face.surface)) {
          oriented.reverse();
          for (const o of oriented) o.forward = !o.forward;
        }
        const refs = oriented.map((o) =>
          w.add("ORIENTED_EDGE('',*,*,#{}, .{}.)", [o.ref, o.forward ? 'T' : 'F']),
        );
        if (refs.length === 0) throw new UnsupportedGeometry('a loop with no edge');
        const el = w.add("EDGE_LOOP('',({}))", [refs.map((x) => `#${x}`).join(',')]);
        const cls = loop.outer ? 'FACE_OUTER_BOUND' : 'FACE_BOUND';
        bounds.push(w.add(`${cls}('',#{},.T.)`, [el]));
      }
      if (bounds.length === 0) throw new UnsupportedGeometry('a face with no boundary');
      // A torus no `TOROIDAL_SURFACE` holds is written as the rational B-spline
      // of its part the file uses, as the file's own STEP export writes it.
      const surface =
        face.surface.kind === 'torus' && degenerateTorus(face.surface)
          ? w.bsplineSurface(torusSpline(face.surface, seamAngle(face)))
          : w.surface(face.surface);
      faceRefs.push(
        w.add("ADVANCED_FACE('',({}),#{},.{}.)", [
          bounds.map((x) => `#${x}`).join(','),
          surface,
          face.reversed ? 'F' : 'T',
        ]),
      );
    }
    if (faceRefs.length === 0) throw new UnsupportedGeometry('a body with no writable face');
    return w.add("CLOSED_SHELL('',({}))", [faceRefs.map((x) => `#${x}`).join(',')]);
  };
  const shell = closedShell(solid.faces);
  // A void's shell is written with the file's own face senses (each face's
  // normal points out of the material, into the cavity) and named reversed by
  // an `ORIENTED_CLOSED_SHELL`, as the file's own STEP export writes it.
  const voids = (solid.voids ?? []).map((faces) =>
    w.add("ORIENTED_CLOSED_SHELL('',*,#{},.F.)", [closedShell(faces)]),
  );
  const solidRef =
    voids.length > 0
      ? w.add("BREP_WITH_VOIDS('body',#{},({}))", [shell, voids.map((x) => `#${x}`).join(',')])
      : w.add("MANIFOLD_SOLID_BREP('body',#{})", [shell]);
  const axis = w.add("AXIS2_PLACEMENT_3D('',#{},#{},#{})", [
    w.point([0, 0, 0]),
    w.direction([0, 0, 1]),
    w.direction([1, 0, 0]),
  ]);
  const rep = w.add("ADVANCED_BREP_SHAPE_REPRESENTATION('',(#{},#{}),#{})", [solidRef, axis, ctx]);
  w.add('SHAPE_DEFINITION_REPRESENTATION(#{},#{})', [w.productDefinitionShape, rep]);
  return w.text();
}

/**
 * The points a B-spline edge is split at, in the B-spline's parameter order:
 * its closed curve's seam when the edge's stretch crosses it, else the middle
 * of a closed edge's stretch (a start-equals-end `EDGE_CURVE` is degenerate to
 * a kernel). An edge with no stretch, or a stretch longer than the closed
 * curve, is refused.
 */
function splineBreaks(
  c: AsmBSplineCurve,
  range: [number, number] | undefined,
  closedEdge: boolean,
): [number, number, number][] {
  if (!range) return [];
  const lo = c.knots[0] as number;
  const hi = c.knots[c.knots.length - 1] as number;
  const tol = (hi - lo) * 1e-9;
  let [a, b] = range;
  if (c.closed) {
    // A closed curve's parameter wraps: bring the stretch's start into the
    // knot range; a stretch that then runs past the end crosses the seam.
    const period = hi - lo;
    const turns = Math.floor((a - lo + tol) / period);
    a -= turns * period;
    b -= turns * period;
    if (b - a > period + tol) throw new UnsupportedGeometry('a spline edge longer than its curve');
    if (b > hi + tol) return [splinePoint(c, lo)];
  }
  return closedEdge ? [splinePoint(c, (a + b) / 2)] : [];
}

type Torus = Extract<AsmSurface, { kind: 'torus' }>;
type Vec = [number, number, number];
const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scaled = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec): Vec => scaled(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));

/**
 * A torus `TOROIDAL_SURFACE` cannot hold: the file's tube is not smaller than
 * its ring (an apple, or a horn when they are equal), or its ring radius is
 * negative (a lemon). The file's torus is the tube circle swept round the
 * axis with its centre at the signed ring radius, and a face uses the part of
 * it on its own side of the axis (every vertex of the corpus's 115 such faces
 * sits there).
 */
function degenerateTorus(s: Torus): boolean {
  if (s.major > 0 && s.minor < s.major) return false;
  if (!(s.minor > 0)) throw new UnsupportedGeometry('a torus with no tube');
  // A lemon whose tube does not reach the axis has no part on its side of it.
  if (s.major < 0 && -s.major >= s.minor)
    throw new UnsupportedGeometry('a torus with a negative ring radius');
  return true;
}

/** The torus's axes: its reference direction (made square to the axis), Z × X, and the axis. */
function torusFrame(s: Torus): [Vec, Vec, Vec] {
  const Z = unit(s.axis);
  let X = sub(s.ref, scaled(Z, dot(s.ref, Z)));
  if (Math.hypot(X[0], X[1], X[2]) < 1e-9)
    X = cross(Z, Math.abs(Z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
  X = unit(X);
  return [X, cross(Z, X), Z];
}

/**
 * A rational quadratic arc of the unit circle from angle `a` to `b`, in
 * pieces of at most a quarter turn: its control points (a corner sits
 * 1 / cos(half the piece) out), weights, and knots (the angles) with STEP's
 * multiplicities.
 */
function unitArc(a: number, b: number) {
  const n = Math.max(1, Math.ceil((b - a) / (Math.PI / 2) - 1e-9));
  const step = (b - a) / n;
  const corner = Math.cos(step / 2);
  const points: [number, number][] = [];
  const weights: number[] = [];
  for (let k = 0; k < n; k++) {
    const t = a + k * step;
    points.push([Math.cos(t), Math.sin(t)]);
    weights.push(1);
    points.push([Math.cos(t + step / 2) / corner, Math.sin(t + step / 2) / corner]);
    weights.push(corner);
  }
  points.push([Math.cos(b), Math.sin(b)]);
  weights.push(1);
  const knots = Array.from({ length: n + 1 }, (_, k) => a + k * step);
  const mults = knots.map((_, k) => (k === 0 || k === n ? 3 : 2));
  return { points, weights, knots, mults };
}

/**
 * The part of a degenerate torus on its face's side of the axis as an exact
 * rational B-spline: the tube circle's arc from axis to axis (the angles where
 * ring + tube · cos v ≥ 0), swept a whole turn round the axis from `seam`.
 * Its normal (u × v) points out of the tube, as the file's torus's does with
 * a positive tube radius, so the face keeps its sense.
 */
export function torusSpline(s: Torus, seam: number): AsmBSplineSurface {
  const [X, Y, Z] = torusFrame(s);
  const reach = Math.acos(Math.min(1, Math.max(-1, -s.major / s.minor)));
  const u = unitArc(seam, seam + 2 * Math.PI);
  const v = unitArc(-reach, reach);
  const points = u.points.map(([c, d]) =>
    v.points.map(([x, z]): Vec => {
      const radial = s.major + s.minor * x;
      return [0, 1, 2].map(
        (k) =>
          (s.center[k] as number) +
          radial * (c * (X[k] as number) + d * (Y[k] as number)) +
          s.minor * z * (Z[k] as number),
      ) as Vec;
    }),
  );
  return {
    uDegree: 2,
    vDegree: 2,
    uKnots: u.knots,
    uMults: u.mults,
    vKnots: v.knots,
    vMults: v.mults,
    points,
    weights: u.weights.map((a) => v.weights.map((b) => a * b)),
    uClosed: true,
    vClosed: reach > Math.PI - 1e-12,
  };
}

/**
 * Where a degenerate torus face's B-spline starts round the axis: in the
 * middle of the widest angle its boundary leaves free, so the seam stays off
 * the face when it does not go all the way round.
 */
function seamAngle(face: AsmBodyFace): number {
  const s = face.surface as Torus;
  const [X, Y] = torusFrame(s);
  const angles: number[] = [];
  for (const loop of face.loops)
    for (const { edge } of loop.coedges)
      for (const p of edgeSamples(edge)) {
        const q = sub(p, s.center);
        const x = dot(q, X);
        const y = dot(q, Y);
        if (Math.hypot(x, y) > 1e-9) angles.push(Math.atan2(y, x));
      }
  if (angles.length === 0) return 0;
  angles.sort((a, b) => a - b);
  let at = (angles[angles.length - 1] as number) - 2 * Math.PI;
  let widest = -1;
  let seam = 0;
  for (const a of angles) {
    if (a - at > widest) {
      widest = a - at;
      seam = at + widest / 2;
    }
    at = a;
  }
  return seam;
}

/** Points along an edge: its vertices, and samples of an arc or a B-spline stretch. */
function edgeSamples(e: AsmBodyEdge): Vec[] {
  const out: Vec[] = [];
  if (e.start) out.push(e.start);
  if (e.end) out.push(e.end);
  const c = e.curve;
  const N = 32;
  if (c.kind === 'ellipse' && e.start) {
    const a = Math.hypot(c.major[0], c.major[1], c.major[2]);
    const b = a * Math.abs(c.ratio);
    if (!(a > 0 && b > 0)) return out;
    const X = unit(c.major);
    const Y = unit(cross(c.normal, X));
    const angle = (p: Vec): number => {
      const q = sub(p, c.center);
      return Math.atan2(dot(q, Y) / b, dot(q, X) / a);
    };
    const t0 = angle(e.start);
    const t1 = e.end ? angle(e.end) : t0;
    // The edge runs with the curve's angle unless it runs against its curve.
    const dir = e.reversed ? -1 : 1;
    let sweep = (dir * (t1 - t0)) % (2 * Math.PI);
    if (sweep <= 1e-9) sweep += 2 * Math.PI;
    for (let k = 1; k < N; k++) {
      const t = t0 + (dir * sweep * k) / N;
      out.push(
        [0, 1, 2].map(
          (i) =>
            (c.center[i] as number) +
            a * Math.cos(t) * (X[i] as number) +
            b * Math.sin(t) * (Y[i] as number),
        ) as Vec,
      );
    }
  } else if (c.kind === 'bspline' && e.range) {
    const [lo, hi] = e.range;
    const k0 = c.spline.knots[0] as number;
    const period = (c.spline.knots[c.spline.knots.length - 1] as number) - k0;
    for (let k = 1; k < N; k++) {
      let t = lo + ((hi - lo) * k) / N;
      if (c.spline.closed && period > 0) t = k0 + ((((t - k0) % period) + period) % period);
      out.push(splinePoint(c.spline, t));
    }
  }
  return out;
}

/** The STEP boilerplate's product/context entities; returns the representation context. */
function header(w: StepWriter): number {
  const ac = w.add("APPLICATION_CONTEXT('automotive design')");
  w.add("APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#{})", [
    ac,
  ]);
  const pc = w.add("PRODUCT_CONTEXT('',#{},'mechanical')", [ac]);
  const prod = w.add("PRODUCT('body','body','',(#{},))", [pc]);
  const pdf = w.add("PRODUCT_DEFINITION_FORMATION('','',#{})", [prod]);
  const pdc = w.add("PRODUCT_DEFINITION_CONTEXT('part definition',#{},'design')", [ac]);
  const pd = w.add("PRODUCT_DEFINITION('design','',#{},#{})", [pdf, pdc]);
  w.productDefinitionShape = w.add("PRODUCT_DEFINITION_SHAPE('','',#{})", [pd]);
  const length = w.add('(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))');
  const angle = w.add('(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))');
  const unc = w.add(
    "UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),#{},'distance_accuracy_value','')",
    [length],
  );
  return w.add(
    '(GEOMETRIC_REPRESENTATION_CONTEXT(3)' +
      'GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#{}))' +
      'GLOBAL_UNIT_ASSIGNED_CONTEXT((#{},#{})))',
    [unc, length, angle],
  );
}

/** A double in a compact STEP lexical form. */
function g(v: number): string {
  return Number.isFinite(v) ? Number.parseFloat(v.toPrecision(9)).toString() : '0';
}

/** Emits AP214 STEP entities, numbering them as `#n=…;` (lengths: cm in, mm out). */
class StepWriter {
  #lines: string[] = [];
  #n = 0;
  productDefinitionShape = 0;

  add(text: string, refs: (number | string)[] = []): number {
    this.#n += 1;
    let i = 0;
    this.#lines.push(
      `#${this.#n}=${
        refs.length
          ? text.replace(/\{\}/g, () => {
              const v = refs[i++];
              return typeof v === 'number' ? g(v) : String(v);
            })
          : text
      };`,
    );
    return this.#n;
  }

  point(p: [number, number, number]): number {
    const [x, y, z] = p.map((v) => v * 10) as [number, number, number];
    return this.add(`CARTESIAN_POINT('',(${g(x)},${g(y)},${g(z)}))`);
  }

  direction(d: [number, number, number]): number {
    const n = Math.hypot(d[0], d[1], d[2]) || 1;
    return this.add(`DIRECTION('',(${g(d[0] / n)},${g(d[1] / n)},${g(d[2] / n)}))`);
  }

  /** An axis placement from an origin, a z and an x direction (x orthogonalized to z). */
  axis2(
    origin: [number, number, number],
    z: [number, number, number],
    x: [number, number, number],
  ): number {
    const zn = Math.hypot(z[0], z[1], z[2]) || 1;
    const uz = z.map((v) => v / zn) as [number, number, number];
    const dot = x[0] * uz[0] + x[1] * uz[1] + x[2] * uz[2];
    let ux = x.map((v, i) => v - dot * (uz[i] as number)) as [number, number, number];
    if (Math.hypot(ux[0], ux[1], ux[2]) < 1e-9) {
      const seed: [number, number, number] = Math.abs(uz[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const d2 = seed[0] * uz[0] + seed[1] * uz[1] + seed[2] * uz[2];
      ux = seed.map((v, i) => v - d2 * (uz[i] as number)) as [number, number, number];
    }
    return this.add("AXIS2_PLACEMENT_3D('',#{},#{},#{})", [
      this.point(origin),
      this.direction(uz),
      this.direction(ux),
    ]);
  }

  surface(s: AsmSurface): number {
    if (s.kind === 'plane')
      return this.add("PLANE('',#{})", [this.axis2(s.point, s.normal, s.normal)]);
    if (s.kind === 'sphere') {
      // A sphere is symmetric about its pole axis; any X reference does.
      return this.add("SPHERICAL_SURFACE('',#{},{})", [
        this.axis2(s.center, s.axis, s.axis),
        s.radius * 10,
      ]);
    }
    if (s.kind === 'torus') {
      // A degenerate torus is written as a B-spline by the face (see
      // `torusSpline`); this is only reached by a caller with the surface alone.
      if (s.major < 0) throw new UnsupportedGeometry('a torus with a negative ring radius');
      if (!(s.minor < s.major))
        throw new UnsupportedGeometry('a torus whose tube is not smaller than its ring');
      return this.add("TOROIDAL_SURFACE('',#{},{},{})", [
        this.axis2(s.center, s.axis, s.ref),
        s.major * 10,
        s.minor * 10,
      ]);
    }
    if (s.kind === 'cone') {
      // A narrowing cone (negative file slope) widens along −axis; STEP's
      // semi-angle is positive and the cone widens along the placement's +Z, so
      // flip the axis (the radius is at the centre, which stays put).
      const narrowing = s.slope < -1e-12;
      const axis = (narrowing ? s.axis.map((v) => -v) : s.axis) as [number, number, number];
      const place = this.axis2(s.center, axis, axis);
      if (s.cylinder || Math.abs(s.slope) < 1e-9)
        return this.add("CYLINDRICAL_SURFACE('',#{},{})", [place, s.radius * 10]);
      return this.add("CONICAL_SURFACE('',#{},{},{})", [
        place,
        s.radius * 10,
        Math.atan(Math.abs(s.slope)),
      ]);
    }
    if (s.kind === 'bspline') return this.bsplineSurface(s.spline);
    throw new UnsupportedGeometry(s.type);
  }

  /** A list of numbers or references, `(a,b,…)`. */
  static list(xs: (number | string)[]): string {
    return `(${xs.map((x) => (typeof x === 'number' ? g(x) : x)).join(',')})`;
  }

  bsplineCurve(c: AsmBSplineCurve): number {
    const points = StepWriter.list(c.points.map((p) => `#${this.point(p)}`));
    const closed = c.closed ? 'T' : 'F';
    const knots = `${StepWriter.list(c.mults)},${StepWriter.list(c.knots)},.UNSPECIFIED.`;
    if (!c.weights)
      return this.add(
        `B_SPLINE_CURVE_WITH_KNOTS('',${c.degree},${points},.UNSPECIFIED.,.${closed}.,.F.,${knots})`,
      );
    return this.add(
      `(BOUNDED_CURVE()B_SPLINE_CURVE(${c.degree},${points},.UNSPECIFIED.,.${closed}.,.F.)` +
        `B_SPLINE_CURVE_WITH_KNOTS(${knots})CURVE()GEOMETRIC_REPRESENTATION_ITEM()` +
        `RATIONAL_B_SPLINE_CURVE(${StepWriter.list(c.weights)})REPRESENTATION_ITEM(''))`,
    );
  }

  bsplineSurface(s: AsmBSplineSurface): number {
    const grid = `(${s.points.map((row) => StepWriter.list(row.map((p) => `#${this.point(p)}`))).join(',')})`;
    const flags = `.UNSPECIFIED.,.${s.uClosed ? 'T' : 'F'}.,.${s.vClosed ? 'T' : 'F'}.,.F.`;
    const knots =
      `${StepWriter.list(s.uMults)},${StepWriter.list(s.vMults)},` +
      `${StepWriter.list(s.uKnots)},${StepWriter.list(s.vKnots)},.UNSPECIFIED.`;
    if (!s.weights)
      return this.add(
        `B_SPLINE_SURFACE_WITH_KNOTS('',${s.uDegree},${s.vDegree},${grid},${flags},${knots})`,
      );
    const weights = `(${s.weights.map((row) => StepWriter.list(row)).join(',')})`;
    return this.add(
      `(BOUNDED_SURFACE()B_SPLINE_SURFACE(${s.uDegree},${s.vDegree},${grid},${flags})` +
        `B_SPLINE_SURFACE_WITH_KNOTS(${knots})GEOMETRIC_REPRESENTATION_ITEM()` +
        `RATIONAL_B_SPLINE_SURFACE(${weights})REPRESENTATION_ITEM('')SURFACE())`,
    );
  }

  curve(c: AsmCurve): number {
    if (c.kind === 'line') {
      const vector = this.add("VECTOR('',#{},1.)", [this.direction(c.direction)]);
      return this.add("LINE('',#{},#{})", [this.point(c.point), vector]);
    }
    if (c.kind === 'ellipse') {
      const radius = Math.hypot(c.major[0], c.major[1], c.major[2]);
      const axis = this.axis2(c.center, c.normal, c.major);
      if (Math.abs(c.ratio - 1) < 1e-9) return this.add("CIRCLE('',#{},{})", [axis, radius * 10]);
      return this.add("ELLIPSE('',#{},{},{})", [
        axis,
        radius * 10,
        radius * Math.abs(c.ratio) * 10,
      ]);
    }
    if (c.kind === 'bspline') return this.bsplineCurve(c.spline);
    throw new UnsupportedGeometry(c.type);
  }

  text(): string {
    return (
      'ISO-10303-21;\nHEADER;\n' +
      "FILE_DESCRIPTION((''),'2;1');\n" +
      "FILE_NAME('','',(''),(''),'','','');\n" +
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\n" +
      'ENDSEC;\nDATA;\n' +
      this.#lines.join('\n') +
      '\nENDSEC;\nEND-ISO-10303-21;\n'
    );
  }
}

/** The solid as STEP, or the reason it cannot be written. */
export function solidStep(solid: AsmBodySolid): { step?: string; reason?: string } {
  try {
    return { step: solidToStep(solid) };
  } catch (error) {
    return {
      reason:
        error instanceof UnsupportedGeometry
          ? `unsupported geometry (${error.type})`
          : (error as Error).message,
    };
  }
}

/**
 * The design's visible bodies as STEP, one entry per body. A body is written
 * only when its stream is named, one of the stream's solids is paired with it
 * ({@link pairLumps}), and every surface and curve is a plane, cylinder, cone,
 * sphere, torus, line, circle/ellipse or stored B-spline; otherwise the body
 * comes back with a reason. This is the bytes wrapper: it unzips and decodes the design itself.
 * A caller that already has both (the importer) uses {@link bodiesStep}
 * instead, so a 100 MB file is not unzipped and decoded twice.
 */
export function f3dBodiesStep(bytes: Uint8Array): BodyStep[] {
  let entries: Entries;
  let design: F3dDesign;
  try {
    entries = unzip(bytes);
    design = readF3dEntries(entries);
  } catch {
    return [];
  }
  return bodiesStep(entries, design);
}

/** {@link f3dBodiesStep} on an archive and a design that are already decoded. */
export function bodiesStep(entries: Entries, design: F3dDesign): BodyStep[] {
  const first = activeDesignSegment(designSegments(entries));
  const streams = first
    ? bodyStreams(new Segment(first.meta, first.bulk))
    : new Map<number, { file: string; index: number }>();
  // The bodies that name each stream, hidden ones and ones the design could not
  // decode too: they all claim solids.
  const known = new Map(design.bodies.map((b) => [b.id, b]));
  const claims = new Map<string, LumpClaim[]>();
  for (const [id, link] of streams) {
    const body = known.get(id);
    const list = claims.get(link.file) ?? [];
    list.push({
      id,
      index: link.index,
      visible: body?.visible === true,
      ...(body?.ops ? { ops: body.ops } : {}),
    });
    claims.set(link.file, list);
  }
  const cache = new Map<
    string,
    { solids: AsmBodySolid[]; paired: Map<number, number | string> } | { error: string }
  >();
  const out: BodyStep[] = [];
  for (const body of design.bodies) {
    if (!body.visible) continue;
    const name = `Body${body.index}`;
    const at = (extra: { step?: string; reason?: string }): BodyStep => ({
      record: body.id,
      name,
      ...(body.component !== undefined ? { component: body.component } : {}),
      ...extra,
    });
    const link = streams.get(body.id);
    if (!link) {
      out.push(at({ reason: 'no B-rep stream for this body' }));
      continue;
    }
    const data = entryFor(entries, link.file);
    if (!data) {
      out.push(at({ reason: `stream ${link.file} is missing from the archive` }));
      continue;
    }
    let read = cache.get(link.file);
    if (!read) {
      try {
        const records = readAsm(data);
        const solids = asmBodies(records);
        // The container lists the component's bodies, the stream's lumps are
        // its solids, and the two do not always line up by position (a hidden
        // body's or a construction solid beside them, another order): each
        // body is paired with its solid by the operations on the solid's faces.
        read = { solids, paired: pairLumps(claims.get(link.file) ?? [], lumpOps(records)) };
      } catch (error) {
        read = { error: (error as Error).message };
      }
      cache.set(link.file, read);
    }
    if ('error' in read) {
      out.push(at({ reason: `stream could not be read (${read.error})` }));
      continue;
    }
    const paired = read.paired.get(body.id);
    const solid = typeof paired === 'number' ? read.solids[paired] : undefined;
    if (!solid) {
      out.push(
        at({ reason: typeof paired === 'string' ? paired : 'the body is not in its stream' }),
      );
      continue;
    }
    out.push(at(solidStep(solid)));
  }
  return out;
}

/** A sphere or torus the file signs inward (a negative radius). */
const inwardSurface = (s: AsmSurface): boolean =>
  ((s.kind === 'sphere' || s.kind === 'torus') && s.inward) || (s.kind === 'bspline' && s.reversed);
