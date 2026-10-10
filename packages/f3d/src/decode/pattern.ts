/**
 * Circular patterns (`11F1A5CE…`). The total angle is a parameter the
 * feature owns ("TotalAngle"); the count is a parameter value its count
 * record (`A085449A…`) refers to ("countU"). What it repeats sits in an
 * operand group: geometry operands (`5A1BF548…`) that each name a feature by
 * its record (`90055C05…`: two bytes, u64 record) and the body it acted on
 * (a body link, `D26351F0…`: the body's GUID, then references to the body
 * record and the feature that made the body) — or face and feature-face
 * operands. The axis is the geometry operand holding a model line, as a
 * revolve's.
 */
import type { Segment } from '../segment';

export const CIRCULAR_PATTERN = '11F1A5CE-2B57-4476-8480-6994621493C9';
export const PATTERN_COUNT = 'A085449A-5144-4B2B-B455-7F7035A40559';
export const BODY_LINK = 'D26351F0-5940-4D23-AA20-2C35475A6D9E';
/** A record named by its number: an origin axis, a feature. */
export const RECORD_REF = '90055C05-546C-4EE7-B3C9-3DD922AD0C9C';
/** An operand naming faces of a feature for a pattern to repeat. */
export const FEATURE_FACES_OPERAND = '9716F783-676D-42E0-93F9-EBF273E7C035';

/** `90055C05…`: two zero bytes, then the u64 record it names. */
export function readRecordRef(seg: Segment, id: number): number {
  const r = seg.reader(id);
  r.zeros(2);
  return r.u64();
}
