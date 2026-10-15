/**
 * A feature's records in several components (`12D00AC0…`). A feature that
 * acts on bodies of more than one component (an extrude cutting through two
 * components' bodies, a hole drilled through both) keeps one record per
 * component: the timeline names the first, the others are not on it, but
 * their operations tag the faces they made in the other components' bodies,
 * and their body operands name those bodies. After the prologue: u32 n and
 * n × (wstr GUID, reference: the feature's first record); u32 n and n × (wstr
 * GUID, u32 m, m references: every record of that feature, the first among
 * them); a closing reference (not read).
 */
import { F3dFormatError } from '../bytes';
import { readPrologue, type Segment } from '../segment';

export const FEATURE_RECORDS = '12D00AC0-B828-48C8-9740-80C4D992DB65';

/** The most records one feature is read with (a file's lists are untrusted). */
const MAX_RECORDS = 64;

/** Every further record of a feature → the feature's first record. */
export function readFeatureRecords(seg: Segment, id: number): Map<number, number> {
  const r = seg.reader(id);
  if (readPrologue(r).leading) throw new F3dFormatError(`Feature records #${id}: leading block.`);
  const firsts = new Map<string, number>();
  const n = r.u32();
  // Each entry takes at least a GUID's length prefix and a reference.
  if (n > r.remaining / 15) throw new F3dFormatError(`Feature records #${id}: ${n} features.`);
  for (let i = 0; i < n; i++) {
    const guid = r.wstr(64);
    firsts.set(guid, r.localRef());
  }
  const out = new Map<number, number>();
  const k = r.u32();
  if (k > r.remaining / 8) throw new F3dFormatError(`Feature records #${id}: ${k} lists.`);
  for (let i = 0; i < k; i++) {
    const first = firsts.get(r.wstr(64));
    const m = r.u32();
    if (m > MAX_RECORDS) throw new F3dFormatError(`Feature records #${id}: ${m} records.`);
    for (let j = 0; j < m; j++) {
      const record = r.localRef();
      if (first !== undefined && record !== first) out.set(record, first);
    }
  }
  return out;
}

/**
 * Of the records an operation tags faces with, the timeline feature that made
 * them: one on the timeline, else the timeline feature one of them is a
 * further record of, else the first record.
 */
export function timelineFeature(
  records: readonly number[] | undefined,
  onTimeline: ReadonlySet<number>,
  firstRecord: ReadonlyMap<number, number>,
): number | undefined {
  if (!records) return undefined;
  const further = records
    .map((r) => firstRecord.get(r))
    .find((r) => r !== undefined && onTimeline.has(r));
  return records.find((r) => onTimeline.has(r)) ?? further ?? records[0];
}

/**
 * A feature's bodies with those its further records name. None named stays
 * none: the feature acts on every body it meets, in any component.
 */
export function allParticipants(own: number[], further: number[][]): number[] {
  if (own.length === 0) return own;
  const out = [...own];
  for (const list of further) for (const body of list) if (!out.includes(body)) out.push(body);
  return out;
}
