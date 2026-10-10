/**
 * Sketch geometry: points, lines, and circles and arcs. Coordinates are in the
 * sketch's own frame, in centimetres. A point and every curve end with a
 * reference to the sketch they belong to (the "owner backlink"); a curve names
 * its points directly (a line its end and start, a circle its centre).
 */
import { F3dFormatError, type Reader } from '../bytes';
import type { Segment } from '../segment';
import { decodeLevel, type RecordDecoder, unsupported } from './common';

export const SKETCH_POINT = 'C2CEDAE7-1716-47C1-B7B1-07B70081D0FB';
export const SKETCH_LINE = 'DCA267ED-D615-4934-B64F-AD805E8003E2';
export const SKETCH_CIRCULAR = 'F0130424-8B7E-4092-93C9-1CA807482534';
/** The point ↔ curves companion: which curves end or centre at a point. */
export const POINT_INCIDENCE = '362B7EC3-0F09-47C8-A3BE-DC066715CDAE';

export type Vec3 = [number, number, number];

function vec3(r: Reader): Vec3 {
  return [r.f64(), r.f64(), r.f64()];
}

/** The sketch a point or curve belongs to, read from its last eleven bytes. */
function ownerAtEnd(seg: Segment, r: Reader): number | undefined {
  const save = r.pos;
  try {
    // Eleven bytes, or fifty-one where references carry the target's type GUID.
    for (const width of [11, 51]) {
      if (r.end - width < save) continue;
      r.pos = r.end - width;
      if (r.peekU8() !== 1) continue;
      try {
        const owner = r.ref();
        if (r.pos === r.end && owner && !owner.external && owner.segment === undefined)
          if (seg.typeOf(owner.id)?.guid === SKETCH) return owner.id;
      } catch {
        // not a reference at this width
      }
    }
    return undefined;
  } finally {
    r.pos = save;
  }
}

const SKETCH = '44A64366-4BD3-4B24-881A-F94C206E8F2D';

/**
 * Whether a curve is construction geometry, from the flag bytes after its
 * last point reference. Where the flag sits depends on the record layout,
 * told apart by the tail's length (less 40 where references carry their type
 * GUID): found from the curves Fusion's own profiles use, which are never
 * construction.
 */
function constructionFlag(r: Reader, kind: 'line' | 'circle'): boolean {
  let n = r.end - r.pos;
  if (n > 80) n -= 40;
  const at =
    kind === 'line'
      ? n === 49
        ? 0
        : n === 52 || n === 56
          ? 6
          : -1
      : n === 51
        ? 2
        : n === 54 || n === 58
          ? 8
          : -1;
  return at >= 0 && r.peekU8(at) === 1;
}

export interface SketchPoint {
  id: number;
  /** Persistent point id (`pt_tag`), shared with the B-rep's sketch attributes. */
  tag?: bigint;
  /** Position in the sketch frame, cm. */
  at: Vec3;
  incidence: number;
  owner?: number;
}

export const sketchPoint: RecordDecoder<SketchPoint> = {
  name: 'sketch point',
  decode: (seg, id) =>
    decodeLevel(seg, id, 'sketch point', (r, props, version) => {
      const incidence = r.localRef();
      let at: Vec3;
      if (version === 0) {
        r.u8();
        at = [r.f64(), r.f64(), 0];
        r.skip(20 + 4 + 12 + 8 + 10);
      } else if (version === 8 || version === 10 || version === 11) {
        r.skip(version === 11 ? 8 : 7);
        at = vec3(r);
        r.u64big(); // selector
        r.u8(); // state
        r.zeros(version === 8 ? 8 : 12);
        r.skip(8); // two f32 ones
        r.skip(5);
      } else unsupported('sketch point', version);
      if (r.localRef() !== incidence)
        throw new F3dFormatError(`Point #${id}: repeated reference differs.`);
      if (r.remaining === 15) r.zeros(4);
      const owner = r.remaining > 0 ? r.ref() : null;
      const tag = props.get('pt_tag');
      return {
        id,
        ...(tag !== undefined ? { tag } : {}),
        at,
        incidence,
        ...(owner ? { owner: owner.id } : {}),
      };
    }),
};

export interface SketchLine {
  id: number;
  /** Persistent curve id (`crv_primary_id`). */
  tag?: bigint;
  start: Vec3;
  end: Vec3;
  startPoint: number;
  endPoint: number;
  construction: boolean;
  owner?: number;
}

export const sketchLine: RecordDecoder<SketchLine> = {
  name: 'sketch line',
  decode: (seg, id) =>
    decodeLevel(seg, id, 'sketch line', (r, props, version) => {
      if (version !== 1 && version !== 2) unsupported('sketch line', version);
      const owner = ownerAtEnd(seg, r);
      // A referenced analytic wrapper may precede the line.
      if (refAhead(seg, r) !== undefined) r.ref();
      const start = vec3(r);
      const d = vec3(r);
      vec3(r); // unit direction
      // The full form stores a unit normal; the compact planar form goes
      // straight on to the point references.
      if (!isPointRef(seg, r)) vec3(r);
      const endPoint = r.localRef();
      const startPoint = r.localRef();
      const construction = constructionFlag(r, 'line');
      r.pos = r.end; // flags and the owner backlink
      const tag = props.get('crv_primary_id');
      return {
        id,
        ...(tag !== undefined ? { tag } : {}),
        start,
        end: [start[0] + d[0], start[1] + d[1], start[2] + d[2]],
        startPoint,
        endPoint,
        construction,
        ...(owner !== undefined ? { owner } : {}),
      };
    }),
};

function isPointRef(seg: Segment, r: Reader): boolean {
  const id = refAhead(seg, r);
  return id !== undefined && seg.typeOf(id)?.guid === SKETCH_POINT;
}

/**
 * The id of the local reference starting at the reader's position, or
 * undefined when the bytes there are not one: a marker byte, an existing
 * record id, then either the two zero flag bytes or the inline type GUID.
 */
export function refAhead(seg: Segment, r: Reader): number | undefined {
  if (r.peekU8() !== 1) return undefined;
  const lo = r.peekU32(1);
  if (lo === undefined || r.peekU32(5) !== 0 || !seg.has(lo)) return undefined;
  const next = r.peekU32(9);
  if (next === 36) return lo;
  return r.peekU8(9) === 0 && r.peekU8(10) === 0 ? lo : undefined;
}

export interface SketchCircular {
  id: number;
  tag?: bigint;
  center: Vec3;
  /** The plane normal and the zero-angle direction. */
  normal: Vec3;
  xAxis: Vec3;
  radius: number;
  /** Angles from `xAxis` about `normal`; a full circle runs 0 to 2π. */
  startAngle: number;
  endAngle: number;
  centerPoint: number;
  /** An arc's end points (absent for a full circle). */
  startPoint?: number;
  endPoint?: number;
  construction: boolean;
  owner?: number;
}

export const sketchCircular: RecordDecoder<SketchCircular> = {
  name: 'sketch circle/arc',
  decode: (seg, id) =>
    decodeLevel(seg, id, 'sketch circle/arc', (r, props, version) => {
      if (version !== 0) unsupported('sketch circle/arc', version);
      const owner = ownerAtEnd(seg, r);
      if (refAhead(seg, r) !== undefined) r.ref();
      const center = vec3(r);
      const normal = vec3(r);
      const xAxis = vec3(r);
      const radius = r.f64();
      const startAngle = r.f64();
      const endAngle = r.f64();
      const centerPoint = r.localRef();
      const out: SketchCircular = {
        id,
        center,
        normal,
        xAxis,
        radius,
        startAngle,
        endAngle,
        centerPoint,
        construction: false,
      };
      const tag = props.get('crv_primary_id');
      if (tag !== undefined) out.tag = tag;
      // An arc names its end and start points after the centre.
      if (isPointRef(seg, r)) {
        out.endPoint = r.localRef();
        out.startPoint = r.localRef();
        out.construction = constructionFlag(r, 'line');
      } else out.construction = constructionFlag(r, 'circle');
      if (owner !== undefined) out.owner = owner;
      r.pos = r.end;
      return out;
    }),
};

export interface PointIncidence {
  id: number;
  curves: number[];
  point: number;
}

export const pointIncidence: RecordDecoder<PointIncidence> = {
  name: 'point incidence',
  decode: (seg, id) =>
    decodeLevel(seg, id, 'point incidence', (r) => {
      // Version-11 points write `00 00 00 00 01 00 00 00 00` before the count.
      if (r.peekU32() === 0 && r.peekU8(4) === 1) r.skip(9);
      const n = r.u32();
      const curves: number[] = [];
      for (let i = 0; i < n; i++) curves.push(r.localRef());
      r.u8();
      const point = r.localRef();
      return { id, curves, point };
    }),
};
