/**
 * Shape history of one kernel operation: what became of each face, edge and
 * vertex of the inputs. The topological-naming service (P2-04) builds on it.
 */

export type SubShapeKind = 'face' | 'edge' | 'vertex';

/** Kinds in the facade's numeric order (0 = face, 1 = edge, 2 = vertex). */
export const SUB_SHAPE_KINDS: readonly SubShapeKind[] = ['face', 'edge', 'vertex'];

/** A sub-shape by kind and 0-based index in that kind's map of its shape. */
export interface SubShapeRef {
  kind: SubShapeKind;
  index: number;
}

/**
 * - `modified`: the sub-shape became `to` (for example a face trimmed by a fillet).
 * - `generated`: the sub-shape gave rise to `to` (an edge → its fillet face).
 * - `deleted`: it is gone; `to` is empty.
 * - `kept`: unchanged and present in the result as `to[0]`.
 * A sub-shape can have both a `modified` (or `kept`) and a `generated` record.
 */
export type HistoryRelation = 'modified' | 'generated' | 'deleted' | 'kept';

const RELATIONS: readonly HistoryRelation[] = ['modified', 'generated', 'deleted', 'kept'];

export interface HistoryRecord {
  /** Which operation input: 0 for the target, 1 for the tool of a boolean. */
  input: number;
  from: SubShapeRef;
  relation: HistoryRelation;
  to: SubShapeRef[];
}

/**
 * Decodes the facade's flat history array:
 * `[input, kind, index, relation, n, (resultKind, resultIndex) × n]` per record.
 */
export function decodeHistory(data: Int32Array): HistoryRecord[] {
  const records: HistoryRecord[] = [];
  let i = 0;
  const next = (): number => {
    const value = data[i++];
    if (value === undefined) throw new Error('Truncated history record');
    return value;
  };
  const kind = (code: number): SubShapeKind => {
    const k = SUB_SHAPE_KINDS[code];
    if (k === undefined) throw new Error(`Unknown sub-shape kind ${code}`);
    return k;
  };
  while (i < data.length) {
    const input = next();
    const from = { kind: kind(next()), index: next() };
    const relation = RELATIONS[next()];
    if (relation === undefined) throw new Error('Unknown history relation');
    const count = next();
    const to: SubShapeRef[] = [];
    for (let j = 0; j < count; j++) to.push({ kind: kind(next()), index: next() });
    records.push({ input, from, relation, to });
  }
  return records;
}
