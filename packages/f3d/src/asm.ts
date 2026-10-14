/**
 * The ASM B-rep streams (`BREP.<uuid>.smb` / `.smbh`): the
 * binary form of ACIS SAT with 8-byte integers and pointers ("ASM
 * BinaryFile8"). Only what the importer needs is read: the faces, their
 * surfaces, and the tags the file attaches to them (`generic_tag_attrib_def`:
 * a token and the design record the face was made by), which is how a
 * fillet's or chamfer's edges name the faces they lie between.
 *
 * Every record is a sequence of tagged values ending in 0x11. Tags:
 * 02 char, 03 short, 04 int (8 bytes here), 05 float, 06 double, 07/08/09 a
 * string with a 1/2/8-byte length, 0A/0B true/false, 0C pointer (record
 * index, −1 for none), 0D a record's class name, 0E a base-class name in
 * front of it, 0F/10 subtype brackets, 12 literal string (8-byte length),
 * 13 position and 14 vector (three doubles), 15 enum (8 bytes), 16 uv (two
 * doubles), 17 int64. Lengths are in centimetres.
 */
import { F3dFormatError } from './bytes';

export type AsmValue =
  | { t: 'int'; v: number }
  | { t: 'ptr'; v: number }
  | { t: 'dbl'; v: number }
  | { t: 'vec'; v: [number, number, number] }
  | { t: 'uv'; v: [number, number] }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'open' }
  | { t: 'close' };

export interface AsmRecord {
  /** `face`, `plane-surface`, `cone-surface`, `ATTRIB_CUSTOM-attrib`, … */
  type: string;
  /** The record's own class, before its base classes (`intcurve-curve` for a curve whose last name is a base like `nullbs`). */
  derived?: string;
  values: AsmValue[];
}

const latin1 = new TextDecoder('latin1');

/** Every record of an ASM binary stream, in order (a pointer is an index into it). */
export function readAsm(bytes: Uint8Array): AsmRecord[] {
  const magic = latin1.decode(bytes.subarray(0, 15));
  if (magic !== 'ASM BinaryFile8')
    throw new F3dFormatError(`Not an ASM BinaryFile8 stream (${magic}).`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 15 + 32; // version, record count, entity count, flags
  const i64 = (at: number) => Number(view.getBigInt64(at, true));
  // Every read below goes through this: a crafted stream must not read past
  // its own end (the ASM reader is given untrusted file bytes).
  const need = (n: number): void => {
    if (n < 0 || p + n > bytes.length)
      throw new F3dFormatError(`ASM: read past the end at ${p} (+${n}, end ${bytes.length}).`);
  };
  // Header: product, kernel and date strings, then three doubles.
  for (let n = 0; n < 6; n++) {
    need(1);
    const t = bytes[p++];
    if (t === 0x07) {
      need(1);
      const len = bytes[p] as number;
      need(1 + len);
      p += 1 + len;
    } else if (t === 0x06) {
      need(8);
      p += 8;
    } else throw new F3dFormatError(`ASM header: tag ${t} at ${p - 1}.`);
  }
  const records: AsmRecord[] = [];
  let values: AsmValue[] = [];
  let names: string[] = [];
  let type = '';
  let derived = '';
  const str = (len: number, at: number) => latin1.decode(bytes.subarray(at, at + len));
  while (p < bytes.length) {
    const t = bytes[p++] as number;
    switch (t) {
      case 0x0d:
      case 0x0e: {
        need(1);
        const n = bytes[p] as number;
        need(1 + n);
        names.push(str(n, p + 1));
        p += 1 + n;
        if (t === 0x0d) {
          type = names.join('-');
          // The first class name is the record's own type; later names are its
          // base classes (`intcurve`, `curve`, `spring_int_cur`, … `nullbs`).
          if (derived === '') derived = type;
          names = [];
        }
        break;
      }
      case 0x11:
        records.push({ type, derived: derived || type, values });
        if (type === 'End-of-ASM-data') return records;
        values = [];
        type = '';
        derived = '';
        break;
      case 0x04:
      case 0x15:
      case 0x17:
        need(8);
        values.push({ t: 'int', v: i64(p) });
        p += 8;
        break;
      case 0x0c:
        need(8);
        values.push({ t: 'ptr', v: i64(p) });
        p += 8;
        break;
      case 0x06:
        need(8);
        values.push({ t: 'dbl', v: view.getFloat64(p, true) });
        p += 8;
        break;
      case 0x13:
      case 0x14:
        need(24);
        values.push({
          t: 'vec',
          v: [
            view.getFloat64(p, true),
            view.getFloat64(p + 8, true),
            view.getFloat64(p + 16, true),
          ],
        });
        p += 24;
        break;
      case 0x16:
        need(16);
        values.push({ t: 'uv', v: [view.getFloat64(p, true), view.getFloat64(p + 8, true)] });
        p += 16;
        break;
      case 0x07: {
        need(1);
        const n = bytes[p] as number;
        need(1 + n);
        values.push({ t: 'str', v: str(n, p + 1) });
        p += 1 + n;
        break;
      }
      case 0x08: {
        need(2);
        const n = view.getUint16(p, true);
        need(2 + n);
        values.push({ t: 'str', v: str(n, p + 2) });
        p += 2 + n;
        break;
      }
      case 0x09:
      case 0x12: {
        need(8);
        const n = i64(p);
        // A negative length would walk the cursor backwards and loop forever
        // on the same tag; a length past the end reads junk.
        if (n < 0 || 8 + n > bytes.length - p)
          throw new F3dFormatError(`ASM: string length ${n} at ${p} is out of bounds.`);
        values.push({ t: 'str', v: str(n, p + 8) });
        p += 8 + n;
        break;
      }
      case 0x0a:
        values.push({ t: 'bool', v: true });
        break;
      case 0x0b:
        values.push({ t: 'bool', v: false });
        break;
      case 0x0f:
        values.push({ t: 'open' });
        break;
      case 0x10:
        values.push({ t: 'close' });
        break;
      case 0x05:
        need(4);
        values.push({ t: 'dbl', v: view.getFloat32(p, true) });
        p += 4;
        break;
      case 0x03:
        need(2);
        values.push({ t: 'int', v: view.getInt16(p, true) });
        p += 2;
        break;
      case 0x02:
        need(1);
        values.push({ t: 'int', v: bytes[p] as number });
        p += 1;
        break;
      default:
        throw new F3dFormatError(`ASM: unknown tag ${t} at ${p - 1}.`);
    }
  }
  return records;
}

/** A face's surface, in model space (cm). */
export type AsmSurface =
  | { kind: 'plane'; point: [number, number, number]; normal: [number, number, number] }
  | {
      kind: 'cone';
      center: [number, number, number];
      axis: [number, number, number];
      /** Radius at the centre (cylinder: everywhere). */
      radius: number;
      /** A cylinder: no half-angle. */
      cylinder: boolean;
      /** How much the radius grows per cm along `axis` (tan of the half-angle; 0: a cylinder). */
      slope: number;
    }
  | {
      kind: 'sphere';
      center: [number, number, number];
      /** The pole axis (the sphere's u/v origin is arbitrary around it). */
      axis: [number, number, number];
      radius: number;
      /** The file wrote a negative radius: the surface normal points inward. */
      inward: boolean;
    }
  | {
      kind: 'torus';
      center: [number, number, number];
      /** The torus axis (the placement's Z). */
      axis: [number, number, number];
      /** The direction of the tube centre (the placement's X). */
      ref: [number, number, number];
      /** Centre-to-tube-centre radius (as the file writes it, so it can be negative). */
      major: number;
      /** Tube radius, made positive. */
      minor: number;
      /** The file wrote a negative minor radius: the surface normal points inward. */
      inward: boolean;
    }
  | { kind: 'other'; type: string };

/** An edge's curve, in model space (cm). */
export type AsmCurve =
  | { kind: 'line'; point: [number, number, number]; direction: [number, number, number] }
  | {
      kind: 'ellipse';
      center: [number, number, number];
      normal: [number, number, number];
      /** The major axis, as long as the major radius. */
      major: [number, number, number];
      /** Minor over major radius (1: a circle). */
      ratio: number;
    }
  | { kind: 'other'; type: string };

/** One edge around a face: its curve, its vertices (cm) and the tags of the face across it. */
export interface AsmEdge {
  curve: AsmCurve;
  points: [number, number, number][];
  across: { token: string; design: number }[];
}

/** A face with the tags the file gave it. */
export interface AsmFace {
  index: number;
  surface: AsmSurface;
  /** (token, design record) pairs from `generic_tag_attrib_def`. */
  tags: { token: string; design: number }[];
  /** The edges of all its loops. */
  edges: AsmEdge[];
}

const vec = (v: AsmValue | undefined): [number, number, number] | undefined =>
  v?.t === 'vec' ? v.v : undefined;

function surfaceOf(r: AsmRecord | undefined): AsmSurface {
  if (!r) return { kind: 'other', type: 'none' };
  const vs = r.values
    .filter((v) => v.t === 'vec')
    .map((v) => (v as { v: [number, number, number] }).v);
  const ds = r.values.filter((v) => v.t === 'dbl').map((v) => (v as { v: number }).v);
  if (r.type.endsWith('plane-surface') && vs[0] && vs[1])
    return { kind: 'plane', point: vs[0], normal: vs[1] };
  if (r.type.endsWith('cone-surface') && vs[0] && vs[1] && vs[2]) {
    const major = vs[2];
    // ratio, sine and cosine of the half-angle follow the three vectors; a
    // negative sine narrows the cone along its axis.
    const sine = ds[1] ?? 0;
    const cosine = ds[2] ?? 1;
    const cylinder = Math.abs(sine) < 1e-12;
    return {
      kind: 'cone',
      center: vs[0],
      axis: vs[1],
      radius: Math.hypot(major[0], major[1], major[2]),
      cylinder,
      slope: cylinder || Math.abs(cosine) < 1e-12 ? 0 : sine / cosine,
    };
  }
  // sphere: centre, radius, then the pole axis and the reference direction.
  if (r.type.endsWith('sphere-surface') && vs[0] && ds[0] !== undefined)
    return {
      kind: 'sphere',
      center: vs[0],
      axis: vs[1] ?? [0, 0, 1],
      radius: Math.abs(ds[0]),
      // A negative radius is the file's way of pointing the normal inward.
      inward: ds[0] < 0,
    };
  // torus: centre, axis, major radius, minor radius, then the tube direction.
  if (r.type.endsWith('torus-surface') && vs[0] && vs[1] && ds[0] !== undefined)
    return {
      kind: 'torus',
      center: vs[0],
      axis: vs[1],
      ref: vs[2] ?? [1, 0, 0],
      major: ds[0],
      // A negative minor radius points the tube's normal inward; STEP wants the
      // radius positive, so the sign is carried separately.
      minor: Math.abs(ds[1] ?? 0),
      inward: (ds[1] ?? 0) < 0,
    };
  return { kind: 'other', type: r.type };
}

function curveOf(r: AsmRecord | undefined): AsmCurve {
  if (!r) return { kind: 'other', type: 'none' };
  const vs = r.values
    .filter((v) => v.t === 'vec')
    .map((v) => (v as { v: [number, number, number] }).v);
  const ds = r.values.filter((v) => v.t === 'dbl').map((v) => (v as { v: number }).v);
  if (r.type.endsWith('straight-curve') && vs[0] && vs[1])
    return { kind: 'line', point: vs[0], direction: vs[1] };
  if (r.type.endsWith('ellipse-curve') && vs[0] && vs[1] && vs[2] && ds[0] !== undefined)
    return { kind: 'ellipse', center: vs[0], normal: vs[1], major: vs[2], ratio: ds[0] };
  return { kind: 'other', type: r.type };
}

/**
 * The tags of one `generic_tag_attrib_def` attribute: after the marker
 * string, a group count; each group a selector, a token, 0, a reference count
 * and that many design references (version 3 adds a 0 after each group).
 */
function tagsOf(r: AsmRecord): { token: string; design: number }[] {
  const out: { token: string; design: number }[] = [];
  const v = r.values;
  const at = v.findIndex((x) => x.t === 'str' && x.v === 'generic_tag_attrib_def ');
  if (at < 0) return out;
  let i = at + 1;
  const int = () => {
    const x = v[i++];
    return x?.t === 'int' ? x.v : Number.NaN;
  };
  const groups = int();
  for (let g = 0; g < groups && i < v.length; g++) {
    int(); // selector
    const tok = v[i++];
    if (tok?.t !== 'str') break;
    int(); // 0
    const n = int();
    // The count is untrusted: each reference is one value, so more than the
    // values that are left would push NaN entries past the end (H2).
    if (!Number.isFinite(n) || n < 0 || n > v.length - i)
      throw new F3dFormatError(`ASM tag: ${n} references at ${i} of ${v.length}.`);
    for (let k = 0; k < n; k++) out.push({ token: tok.v, design: int() });
    if (v[i]?.t === 'int' && (v[i] as { v: number }).v === 0 && v[i + 1]?.t !== 'str') i++;
  }
  return out;
}

const pointers = (r: AsmRecord | undefined): number[] =>
  r ? r.values.filter((v) => v.t === 'ptr').map((v) => (v as { v: number }).v) : [];

/**
 * A face's edges: its loops (a loop points at the next loop and its first
 * coedge), each loop's coedges (the coedge pointers are next, previous and
 * partner, in that order), each coedge's edge with its curve and its
 * vertices' points, and the face across (the partner's loop's face). The
 * pointers are followed by the type they point at, and no loop or coedge is
 * walked twice, so a crafted stream can't loop.
 */
function faceEdges(
  records: AsmRecord[],
  face: number[],
  tagsOfFace: (index: number) => { token: string; design: number }[],
): AsmEdge[] {
  // A type or a subtype of it (`tedge-edge`, `tvertex-vertex`).
  const is = (p: number, type: string) => {
    const t = p >= 0 ? records[p]?.type : undefined;
    return t === type || t?.endsWith(`-${type}`) === true;
  };
  const of = (ptrs: number[], type: string) => ptrs.find((p) => is(p, type)) ?? -1;
  const out: AsmEdge[] = [];
  // Each loop and coedge once: a crafted stream's cycles end there.
  const seen = new Set<number>();
  let loop = of(face, 'loop');
  while (loop >= 0 && !seen.has(loop)) {
    seen.add(loop);
    const lp = pointers(records[loop]);
    let coedge = of(lp, 'coedge');
    while (coedge >= 0 && !seen.has(coedge)) {
      seen.add(coedge);
      const cp = pointers(records[coedge]);
      const coedges = cp.filter((p) => is(p, 'coedge'));
      const edge = of(cp, 'edge');
      if (edge >= 0) {
        const ep = pointers(records[edge]);
        const points: [number, number, number][] = [];
        for (const v of ep) {
          if (!is(v, 'vertex')) continue;
          const at = vec(
            records[of(pointers(records[v]), 'point')]?.values.find((x) => x.t === 'vec'),
          );
          if (at) points.push(at);
        }
        const curve = ep.find((p) => p >= 0 && records[p]?.type.endsWith('curve') === true) ?? -1;
        const partner = coedges[2];
        const across =
          partner === undefined
            ? -1
            : of(pointers(records[of(pointers(records[partner]), 'loop')]), 'face');
        out.push({
          curve: curveOf(records[curve]),
          points,
          across: across >= 0 ? tagsOfFace(across) : [],
        });
      }
      coedge = coedges[0] ?? -1;
    }
    loop = lp.find((p) => p !== loop && is(p, 'loop')) ?? -1;
  }
  return out;
}

/**
 * The (token, design record) tags of one face record, from its attribute
 * chain (at most 64 attributes are followed).
 */
export function asmFaceTags(
  records: AsmRecord[],
  face: number,
): { token: string; design: number }[] {
  const tags: { token: string; design: number }[] = [];
  let a = pointers(records[face])[0] ?? -1;
  for (let guard = 0; a >= 0 && guard < 64; guard++) {
    const ar = records[a];
    if (!ar) break;
    if (ar.type.startsWith('ATTRIB_CUSTOM')) tags.push(...tagsOf(ar));
    // attrib: owner-side pointers come after the attribute and history slots;
    // the next attribute is the second pointer.
    const ap = ar.values.filter((v) => v.t === 'ptr').map((v) => (v as { v: number }).v);
    a = ap[1] ?? -1;
  }
  return tags;
}

/** The faces of an ASM stream with their surfaces, tags and edges. */
export function asmFaces(records: AsmRecord[]): AsmFace[] {
  const faces: AsmFace[] = [];
  const tagsAt = new Map<number, { token: string; design: number }[]>();
  records.forEach((r, index) => {
    if (r.type !== 'face') return;
    const ptrs = pointers(r);
    // face: attribute, (history id), next face, loop, shell, subshell, surface
    const surfacePtr = ptrs[ptrs.length - 1] ?? -1;
    const tags = asmFaceTags(records, index);
    faces.push({ index, surface: surfaceOf(records[surfacePtr]), tags, edges: [] });
    tagsAt.set(index, tags);
  });
  for (const face of faces)
    face.edges = faceEdges(records, pointers(records[face.index]), (i) => tagsAt.get(i) ?? []);
  return faces;
}

export { curveOf as asmCurveOf, surfaceOf as asmSurfaceOf, vec as asmVec };
