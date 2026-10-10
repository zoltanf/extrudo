/**
 * Bodies (`D3937028…`) and the links that say which feature made each
 * (`D26351F0…`).
 *
 * A body record holds, after its GUID and appearance strings in newer files,
 * u32 index (its number, as in "Body3"), u32 n and n bytes, a u32, u8 1 and
 * the light bulb: 1 shown, 0 hidden. Newer files put a −1.0 double just in
 * front of the index; older ones (class version 16) start it at payload
 * offset 10. Found by that shape. Fusion's STEP export leaves hidden bodies
 * out.
 *
 * A body link holds the body's GUID, then references to the body record and
 * to the feature that made the body.
 */
import type { Segment } from '../segment';

export const BODY = 'D3937028-C20C-4E65-B010-94AD418A5C20';

export interface BodyFlags {
  /** Fusion's number for it ("Body3"). */
  index: number;
  visible: boolean;
}

export function readBody(seg: Segment, id: number): BodyFlags | undefined {
  const f = seg.frame(id);
  const b = seg.bulk;
  const u32 = (p: number) =>
    ((b[p] as number) |
      ((b[p + 1] as number) << 8) |
      ((b[p + 2] as number) << 16) |
      ((b[p + 3] as number) << 24)) >>>
    0;
  for (let p = f.start; p + 14 <= f.end; p++) {
    const afterDouble = b[p - 2] === 0xf0 && b[p - 1] === 0xbf;
    if (!afterDouble && p - f.start !== 10) continue;
    const index = u32(p);
    if (index < 1 || index > 4096) continue;
    const n = u32(p + 4);
    if (n > 8) continue;
    const q = p + 8 + n;
    if (q + 6 > f.end || b[q + 3] !== 0 || b[q + 4] !== 1) continue;
    const bulb = b[q + 5];
    if (bulb === 0 || bulb === 1) return { index, visible: bulb === 1 };
  }
  return undefined;
}
