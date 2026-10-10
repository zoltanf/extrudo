/**
 * Extrude features and their profile operands.
 *
 * An extrude's own members open with the result operation (1 join, 2 cut,
 * 3 intersect, 4 new body), the travel direction (1 one side, 2 two sides,
 * 3 symmetric), a face-extend option, then three bytes: direction reversed,
 * solid (0 = surface), and the start (0 profile plane, 1 offset plane,
 * 2 selected face). Where that block starts moved between file versions, so
 * it is found by the shape of its values at the known offsets.
 *
 * Distances and tapers are not stored here: they are parameters owned by the
 * feature, told apart by their kind ("AlongDistance", "AgainstDistance",
 * "TaperAngle", "Side2TaperAngle", …).
 *
 * The profile is a sketch-profile operand (N) in the reference table. It names
 * the sketch by its record number, as decimal text. Record N + 3, when it is a
 * region selection, lists the selected regions, each as the sketch curves
 * (persistent `crv_primary_id`s) that bound it; without it the whole sketch is
 * selected.
 */
import { F3dFormatError, Reader } from '../bytes';
import type { Segment } from '../segment';
import type { Scope } from './scope';

export const SKETCH_PROFILE_OPERAND = '4BD53E5A-0B3E-45E5-AE8B-02044306485A';
export const PROFILE_REGIONS = '0D57BD2F-D09B-43FC-AD57-1E89A118C453';

export type BodyOperation = 'join' | 'cut' | 'intersect' | 'new-body';
export type ExtrudeDirection = 'one-side' | 'two-sides' | 'symmetric';

export interface ExtrudeHead {
  operation: BodyOperation;
  direction: ExtrudeDirection;
  reversed: boolean;
  solid: boolean;
  start: 'profile-plane' | 'offset-plane' | 'face';
}

const OPERATIONS: Record<number, BodyOperation> = {
  1: 'join',
  2: 'cut',
  3: 'intersect',
  4: 'new-body',
};
const DIRECTIONS: Record<number, ExtrudeDirection> = {
  1: 'one-side',
  2: 'two-sides',
  3: 'symmetric',
};
const STARTS = ['profile-plane', 'offset-plane', 'face'] as const;

/** Payload offsets the operation block has been seen at, most common first. */
const HEAD_OFFSETS = [9, 8, 7, 19, 18, 17, 20];

export function readExtrudeHead(seg: Segment, scope: Scope): ExtrudeHead {
  for (const at of HEAD_OFFSETS) {
    const r = new Reader(seg.bulk, scope.start + at, scope.end);
    if (r.remaining < 15) continue;
    const op = r.u32();
    const dir = r.u32();
    const extend = r.u32();
    const reversed = r.u8();
    const solid = r.u8();
    const start = r.u8();
    if (!OPERATIONS[op] || !DIRECTIONS[dir] || extend > 3 || reversed > 1 || solid > 1 || start > 2)
      continue;
    return {
      operation: OPERATIONS[op] as BodyOperation,
      direction: DIRECTIONS[dir] as ExtrudeDirection,
      reversed: reversed === 1,
      solid: solid === 1,
      start: STARTS[start] as ExtrudeHead['start'],
    };
  }
  throw new F3dFormatError(`Extrude #${scope.id}: operation block not found.`);
}

/** One selected region of a sketch: its boundary loops as curve tags. */
export interface ProfileRegion {
  outer: bigint[][];
  inner: bigint[][];
}

export interface ProfileOperand {
  id: number;
  /** The sketch container (record number) the profile is in. */
  sketch: number;
  /** Selected regions; absent: the whole sketch. */
  regions?: ProfileRegion[];
  /** A text-profile operand's text record: the profile is that text's ink. */
  text?: number;
}

export function readProfileOperand(seg: Segment, id: number): ProfileOperand {
  // The sketch is named by its record number as decimal UTF-16 text, after
  // the asset GUID: find the last short all-digit wide string.
  const f = seg.frame(id);
  const b = seg.bulk;
  let sketch: number | undefined;
  for (let p = f.start; p + 6 <= f.end; p++) {
    const n =
      (b[p] as number) |
      ((b[p + 1] as number) << 8) |
      ((b[p + 2] as number) << 16) |
      ((b[p + 3] as number) << 24);
    if (n < 1 || n > 10 || p + 4 + 2 * n > f.end) continue;
    let digits = '';
    for (let i = 0; i < n; i++) {
      const lo = b[p + 4 + 2 * i] as number;
      if (b[p + 5 + 2 * i] !== 0 || lo < 0x30 || lo > 0x39) {
        digits = '';
        break;
      }
      digits += String.fromCharCode(lo);
    }
    if (digits) sketch = Number(digits);
  }
  if (sketch === undefined || !seg.has(sketch))
    throw new F3dFormatError(`Profile operand #${id}: no sketch.`);
  const out: ProfileOperand = { id, sketch };
  const sel = id + 3;
  if (seg.has(sel) && seg.typeOf(sel)?.guid === PROFILE_REGIONS) {
    const regions = readRegions(seg, sel, id);
    if (regions) out.regions = regions;
  }
  return out;
}

/**
 * The region selection: u32 group count; per group a first region, u32 X and X
 * further regions. A region is u32 loop count and its loops; a loop is u32
 * member count, that many 40-byte curve members (u32 kind 2 or 3, u64 curve tag, then
 * zeros and incidence words) and a flag byte, 1 for the outer loop — except
 * that the record's very last loop ends without its flag.
 */
function readRegions(seg: Segment, id: number, operand: number): ProfileRegion[] | undefined {
  const r = seg.reader(id);
  r.zeros(2); // prologue
  const back = r.ref();
  if (!back || back.id !== operand) return undefined;
  const region = (): ProfileRegion => {
    const loops = r.u32();
    if (loops === 0 || loops > 1000)
      throw new F3dFormatError(`Profile regions #${id}: ${loops} loops.`);
    const out: ProfileRegion = { outer: [], inner: [] };
    const unflagged: bigint[][] = [];
    for (let i = 0; i < loops; i++) {
      const n = r.u32();
      if (n === 0 || n * 40 > r.remaining)
        throw new F3dFormatError(`Profile regions #${id}: bad loop.`);
      const curves: bigint[] = [];
      for (let k = 0; k < n; k++) {
        const kind = r.u32();
        if (kind !== 2 && kind !== 3)
          throw new F3dFormatError(`Profile regions #${id}: member kind ${kind}.`);
        curves.push(r.u64big());
        r.skip(28);
      }
      if (r.done) unflagged.push(curves);
      else if (r.bool()) out.outer.push(curves);
      else out.inner.push(curves);
    }
    // The last loop of the record carries no flag: it is the outer one when
    // the region has no other.
    for (const c of unflagged) (out.outer.length === 0 ? out.outer : out.inner).push(c);
    return out;
  };
  const regions: ProfileRegion[] = [];
  const groups = r.u32();
  for (let g = 0; g < groups && !r.done; g++) {
    regions.push(region());
    if (r.done) break;
    const more = r.u32();
    for (let k = 0; k < more && !r.done; k++) regions.push(region());
  }
  return regions;
}
