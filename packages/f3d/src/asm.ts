/**
 * Autodesk ShapeManager B-rep streams (`BREP.<uuid>.smb` / `.smbh`): the
 * binary form of ACIS SAT with 8-byte integers and pointers ("ASM
 * BinaryFile8"). Only what the importer needs is read: the faces, their
 * surfaces, and the tags Fusion attaches to them (`generic_tag_attrib_def`:
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
  // Header: product, kernel and date strings, then three doubles.
  for (let n = 0; n < 6; n++) {
    const t = bytes[p++];
    if (t === 0x07) p += 1 + (bytes[p] as number);
    else if (t === 0x06) p += 8;
    else throw new F3dFormatError(`ASM header: tag ${t} at ${p - 1}.`);
  }
  const records: AsmRecord[] = [];
  let values: AsmValue[] = [];
  let names: string[] = [];
  let type = '';
  const str = (len: number, at: number) => latin1.decode(bytes.subarray(at, at + len));
  while (p < bytes.length) {
    const t = bytes[p++] as number;
    switch (t) {
      case 0x0d:
      case 0x0e: {
        const n = bytes[p] as number;
        names.push(str(n, p + 1));
        p += 1 + n;
        if (t === 0x0d) {
          type = names.join('-');
          names = [];
        }
        break;
      }
      case 0x11:
        records.push({ type, values });
        if (type === 'End-of-ASM-data') return records;
        values = [];
        type = '';
        break;
      case 0x04:
      case 0x15:
      case 0x17:
        values.push({ t: 'int', v: i64(p) });
        p += 8;
        break;
      case 0x0c:
        values.push({ t: 'ptr', v: i64(p) });
        p += 8;
        break;
      case 0x06:
        values.push({ t: 'dbl', v: view.getFloat64(p, true) });
        p += 8;
        break;
      case 0x13:
      case 0x14:
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
        values.push({ t: 'uv', v: [view.getFloat64(p, true), view.getFloat64(p + 8, true)] });
        p += 16;
        break;
      case 0x07: {
        const n = bytes[p] as number;
        values.push({ t: 'str', v: str(n, p + 1) });
        p += 1 + n;
        break;
      }
      case 0x08: {
        const n = view.getUint16(p, true);
        values.push({ t: 'str', v: str(n, p + 2) });
        p += 2 + n;
        break;
      }
      case 0x09:
      case 0x12: {
        const n = i64(p);
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
        values.push({ t: 'dbl', v: view.getFloat32(p, true) });
        p += 4;
        break;
      case 0x03:
        values.push({ t: 'int', v: view.getInt16(p, true) });
        p += 2;
        break;
      case 0x02:
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
    }
  | { kind: 'other'; type: string };

/** A face with the tags Fusion gave it. */
export interface AsmFace {
  index: number;
  surface: AsmSurface;
  /** (token, design record) pairs from `generic_tag_attrib_def`. */
  tags: { token: string; design: number }[];
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
    // ratio, sine and cosine of the half-angle follow the three vectors.
    const sine = ds[1] ?? 0;
    return {
      kind: 'cone',
      center: vs[0],
      axis: vs[1],
      radius: Math.hypot(major[0], major[1], major[2]),
      cylinder: Math.abs(sine) < 1e-12,
    };
  }
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
    for (let k = 0; k < n; k++) out.push({ token: tok.v, design: int() });
    if (v[i]?.t === 'int' && (v[i] as { v: number }).v === 0 && v[i + 1]?.t !== 'str') i++;
  }
  return out;
}

/** The faces of an ASM stream with their surfaces and Fusion tags. */
export function asmFaces(records: AsmRecord[]): AsmFace[] {
  const faces: AsmFace[] = [];
  records.forEach((r, index) => {
    if (r.type !== 'face') return;
    const ptrs = r.values.filter((v) => v.t === 'ptr').map((v) => (v as { v: number }).v);
    // face: attribute, (history id), next face, loop, shell, subshell, surface
    const surfacePtr = ptrs[ptrs.length - 1] ?? -1;
    const tags: { token: string; design: number }[] = [];
    let a = ptrs[0] ?? -1;
    for (let guard = 0; a >= 0 && guard < 64; guard++) {
      const ar = records[a];
      if (!ar) break;
      if (ar.type.startsWith('ATTRIB_CUSTOM')) tags.push(...tagsOf(ar));
      // attrib: owner-side pointers come after the attribute and history slots;
      // the next attribute is the second pointer.
      const ap = ar.values.filter((v) => v.t === 'ptr').map((v) => (v as { v: number }).v);
      a = ap[1] ?? -1;
    }
    faces.push({ index, surface: surfaceOf(records[surfacePtr]), tags });
  });
  return faces;
}

export { vec as asmVec };
