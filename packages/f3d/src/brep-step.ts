/**
 * A body of the file's B-rep streams → AP214 STEP text (mm), for planes,
 * cylinders, cones, spheres and tori with straight and elliptical (circle)
 * edges. Anything
 * else is refused with a reason: the importer needs only the bodies whose
 * analytic geometry a kernel can rebuild exactly.
 *
 * The body a design record names is found through its body container
 * (`FORMAT.md`, `CD57BC48…`): a container lists the bodies of its component in
 * order and points at a stream-file record (`74CA4562…` / `40DCC3F4…`), whose
 * payload is the `BREP.<uuid>.smb[h]` entry name. Inside the stream the solids
 * are the `lump` records in order (each lump names its live shell, so the
 * stream's earlier shells are left behind), so the container's body list pairs
 * with the stream's lumps. Only the design's visible bodies are written; a
 * hidden body is left out, as a STEP export of the design leaves it out.
 *
 * This writer does not touch the importer's behaviour (`map.ts`): it is the
 * decoder slice a later change will feed through the `import` feature.
 */
import { designSegments, type Entries, unzip } from './archive';
import { type AsmCurve, type AsmSurface, readAsm } from './asm';
import { type AsmBodyFace, type AsmBodySolid, asmBodies } from './asm-body';
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
  /**
   * The written body has a sphere or torus face whose surface the file signed
   * inward (a negative radius). The body is still written, but the writer does
   * not yet rebuild such bodies reliably, so it does not vouch for the solid (the
   * body check leaves it unchecked).
   */
  inward?: boolean;
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
 * The stream file each body of the design names, with its order inside the
 * stream: `Map<body record, { file, index }>`. Found through the containers;
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
   * edge, and the reference exports split them too. Any other edge is one.
   */
  const edge = (e: AsmBodyFace['loops'][number]['coedges'][number]['edge']): number[] => {
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
    const refs: number[] = [];
    if (start === end && e.curve.kind === 'ellipse') {
      const c = e.curve.center;
      const mid = vertex([2 * c[0] - e.start[0], 2 * c[1] - e.start[1], 2 * c[2] - e.start[2]]);
      refs.push(w.add("EDGE_CURVE('',#{},#{},#{},.{}.)", [start, mid, curve, same]));
      refs.push(w.add("EDGE_CURVE('',#{},#{},#{},.{}.)", [mid, end, curve, same]));
    } else {
      refs.push(w.add("EDGE_CURVE('',#{},#{},#{},.{}.)", [start, end, curve, same]));
    }
    edgeAt.set(e.id, refs);
    return refs;
  };
  const faceRefs: number[] = [];
  for (const face of solid.faces) {
    const bounds: number[] = [];
    for (const loop of face.loops) {
      const oriented: { ref: number; forward: boolean }[] = [];
      for (const coedge of loop.coedges)
        for (const ref of edge(coedge.edge)) oriented.push({ ref, forward: coedge.forward });
      // A not-reversed face is written with its loop reversed and same-sense
      // true; a reversed face keeps the file's loop and same-sense false. The
      // pair is what a kernel rebuilds the body with (the loop still winds the
      // way STEP wants after the reversal). A surface the file wrote with a
      // negative radius has its face already marked reversed by the reader.
      if (!face.reversed) {
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
    const surface = w.surface(face.surface);
    faceRefs.push(
      w.add("ADVANCED_FACE('',({}),#{},.{}.)", [
        bounds.map((x) => `#${x}`).join(','),
        surface,
        face.reversed ? 'F' : 'T',
      ]),
    );
  }
  if (faceRefs.length === 0) throw new UnsupportedGeometry('a body with no writable face');
  const shell = w.add("CLOSED_SHELL('',({}))", [faceRefs.map((x) => `#${x}`).join(',')]);
  const solidRef = w.add("MANIFOLD_SOLID_BREP('body',#{})", [shell]);
  const axis = w.add("AXIS2_PLACEMENT_3D('',#{},#{},#{})", [
    w.point([0, 0, 0]),
    w.direction([0, 0, 1]),
    w.direction([1, 0, 0]),
  ]);
  const rep = w.add("ADVANCED_BREP_SHAPE_REPRESENTATION('',(#{},#{}),#{})", [solidRef, axis, ctx]);
  w.add('SHAPE_DEFINITION_REPRESENTATION(#{},#{})', [w.productDefinitionShape, rep]);
  return w.text();
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
      // A negative major radius is not a torus a kernel can rebuild (the file
      // uses the sign of the minor one to point the normal, not the major).
      if (s.major < 0) throw new UnsupportedGeometry('a torus with a negative ring radius');
      // A degenerate torus (a spindle or a horn torus) is not a solid STEP can
      // hold; refuse it rather than write a surface the kernel cannot rebuild.
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
    throw new UnsupportedGeometry(s.type);
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
 * only when its stream is named, its stream has as many solids as the bodies
 * that name it, and every surface and curve is a plane, cylinder, cone,
 * sphere, torus, line or circle/ellipse; otherwise the body comes back with a
 * reason. This is the bytes wrapper: it unzips and decodes the design itself.
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
  const solidsCache = new Map<string, AsmBodySolid[] | { error: string }>();
  const linkedCount = new Map<string, number>();
  for (const link of streams.values())
    linkedCount.set(link.file, (linkedCount.get(link.file) ?? 0) + 1);
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
    let cached = solidsCache.get(link.file);
    if (!cached) {
      try {
        cached = asmBodies(readAsm(data));
      } catch (error) {
        cached = { error: (error as Error).message };
      }
      solidsCache.set(link.file, cached);
    }
    if (!Array.isArray(cached)) {
      out.push(at({ reason: `stream could not be read (${cached.error})` }));
      continue;
    }
    const siblings = linkedCount.get(link.file) ?? 0;
    // The container lists the component's visible bodies in creation order and
    // the stream's lumps are its solids in creation order, so they pair only
    // when the counts agree. A stream can also hold a hidden body's or a
    // construction body's solid (the container does not list it), and a stream
    // that holds more than the bodies that name it cannot be aligned: the
    // component's bodies by index line up with the lumps on only some of the
    // corpus, so the extra solids stay unwritten rather than guessed.
    if (cached.length !== siblings) {
      out.push(
        at({ reason: `stream holds ${cached.length} bodies for ${siblings} design bodies` }),
      );
      continue;
    }
    const solid = cached[link.index];
    if (!solid) {
      out.push(at({ reason: 'the body is not in its stream' }));
      continue;
    }
    // Only a written body is flagged: a body the writer refused keeps its own
    // reason, and the inward sign is what the body check later acts on.
    const written = solidStep(solid);
    out.push(
      at({
        ...written,
        ...(written.step !== undefined && hasInwardFace(solid) ? { inward: true } : {}),
      }),
    );
  }
  return out;
}

/** True when any face's sphere/torus surface carries the file's inward sign (a negative radius). */
export function hasInwardFace(solid: AsmBodySolid): boolean {
  return solid.faces.some(
    (f) => (f.surface.kind === 'sphere' || f.surface.kind === 'torus') && f.surface.inward,
  );
}
