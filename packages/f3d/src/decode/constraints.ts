/**
 * Sketch relations: the file's geometric sketch constraints. Every one is a
 * record of the relation type (or a subclass of it, whose own level comes
 * first and whose relation level is the base level): a leading block of
 * `u32 n` loci, each a reference to a sketch point or curve and a u32 role,
 * then the property block, a reference to the sketch, a u32 kind mask, a u32
 * state mask, `u32 n` and the loci again as plain references, and one byte.
 *
 * The kind mask says what the relation is (checked against the solved
 * geometry over the whole corpus): 0x1 coincident (two points, or a point on
 * a curve), 0x2 collinear, 0x4 concentric, 0x10 parallel, 0x20
 * perpendicular, 0x40 horizontal, 0x80 vertical, 0x100 tangent, 0x400
 * symmetric (the line is the axis), 0x800 equal, 0x1000 midpoint. A
 * subclass with kind 0 and a state mask (offsets, sketch patterns) is a
 * construction the file keeps as a relation; it is read but not mapped.
 */
import { F3dFormatError, Reader } from '../bytes';
import { readProps, type Segment } from '../segment';
import type { RecordDecoder } from './common';
import { PARAMETER_OWNER, type ParameterValue } from './parameters';
import { refAhead } from './sketch-geometry';

/** The relation base type: its own records are the plain geometric constraints. */
export const SKETCH_RELATION = '60403D47-0C49-49B0-BDE8-1679608164A2';

export type RelationKind =
  | 'coincident'
  | 'collinear'
  | 'concentric'
  | 'parallel'
  | 'perpendicular'
  | 'horizontal'
  | 'vertical'
  | 'tangent'
  | 'symmetric'
  | 'equal'
  | 'midpoint';

/** The kind mask's values. */
export const RELATION_KINDS: Readonly<Record<number, RelationKind>> = {
  1: 'coincident',
  2: 'collinear',
  4: 'concentric',
  16: 'parallel',
  32: 'perpendicular',
  64: 'horizontal',
  128: 'vertical',
  256: 'tangent',
  1024: 'symmetric',
  2048: 'equal',
  4096: 'midpoint',
};

export interface SketchRelation {
  id: number;
  /** The record's type GUID (the base type, or a subclass of it). */
  type: string;
  /** The points and curves it relates, with the role of each (meaning not read). */
  loci: { id: number; role: number }[];
  sketch: number;
  /** The kind mask (see {@link RELATION_KINDS}). */
  mask: number;
  state: number;
  kind?: RelationKind;
}

export const sketchRelation: RecordDecoder<SketchRelation> = {
  name: 'sketch relation',
  decode: (seg: Segment, id: number) => {
    const type = seg.typeOf(id);
    if (!type) throw new F3dFormatError(`No record ${id}.`);
    const r = type.guid === SKETCH_RELATION ? seg.reader(id) : seg.baseReader(id);
    if (r.u8() !== 1) throw new F3dFormatError(`Relation #${id}: no loci.`);
    const n = r.u32();
    if (n > 4096) throw new F3dFormatError(`Relation #${id}: ${n} loci.`);
    const loci: SketchRelation['loci'] = [];
    for (let k = 0; k < n; k++) {
      const locus = r.localRef();
      loci.push({ id: locus, role: r.u32() });
    }
    readProps(r);
    const sketch = r.localRef();
    const mask = r.u32();
    const state = r.u32();
    const back = r.refList(4096);
    if (back.length !== n)
      throw new F3dFormatError(`Relation #${id}: ${back.length} back references.`);
    const kind = RELATION_KINDS[mask];
    return { id, type: type.guid, loci, sketch, mask, state, ...(kind ? { kind } : {}) };
  },
};

/** The base type of every sketch dimension (linear, diameter, radial, angular). */
export const SKETCH_DIMENSION = '0C3F3829-F0DB-4379-9479-CFEF71087971';
/** A linear dimension (its subclass of {@link SKETCH_DIMENSION}). */
export const LINEAR_DIMENSION = '8C780195-72C0-4A56-A911-E43AB14357F2';

export type DimensionKind = 'linear' | 'diameter' | 'radius' | 'angle';

export interface SketchDimensionRecord {
  id: number;
  kind: DimensionKind;
  /** The points and curves it measures (the null locus left out), with their roles. */
  loci: { id: number; role: number }[];
  /** A linear dimension's measuring direction in the sketch's own axes. */
  orientation?: 'aligned' | 'horizontal' | 'vertical';
  /** The parameter it drives (its value, expression and `dN` name). */
  parameter: ParameterValue;
}

const KINDS: [RegExp, DimensionKind][] = [
  [/^Linear Dimension/, 'linear'],
  [/^Diameter Dimension/, 'diameter'],
  [/^Radial Dimension|^Radius Dimension/, 'radius'],
  [/^Angular Dimension/, 'angle'],
];

/**
 * A sketch dimension: a leading block of `u32 n` loci as a relation has them
 * (the first is often the null reference), presentation data this does not
 * read, then a reference to the owner record of the parameter it drives. A
 * linear dimension's direction is the byte pair six and seven bytes before
 * that reference: `40 00` aligned, `00 40` horizontal and `00 80` vertical
 * along the sketch's axes (the relation masks' own horizontal and vertical).
 * Undefined when the record has no parameter this reader knows.
 */
export function readSketchDimension(
  seg: Segment,
  id: number,
  parameterOf: (owner: number) => ParameterValue | undefined,
): SketchDimensionRecord | undefined {
  const f = seg.frame(id);
  const r = new Reader(seg.bulk, f.start, f.end);
  if (r.u8() !== 1) throw new F3dFormatError(`Dimension #${id}: no loci.`);
  const n = r.u32();
  if (n > 64) throw new F3dFormatError(`Dimension #${id}: ${n} loci.`);
  const loci: SketchDimensionRecord['loci'] = [];
  for (let k = 0; k < n; k++) {
    const ref = r.ref();
    const role = r.u32();
    if (ref?.id && ref.segment === undefined && !ref.external) loci.push({ id: ref.id, role });
  }
  let owner: number | undefined;
  for (; r.pos < r.end; r.pos++) {
    const at = refAhead(seg, r);
    if (at !== undefined && seg.typeOf(at)?.guid === PARAMETER_OWNER) {
      owner = at;
      break;
    }
  }
  const parameter = owner !== undefined ? parameterOf(owner) : undefined;
  const kind = parameter && KINDS.find(([re]) => re.test(parameter.kind))?.[1];
  if (!parameter || !kind) return undefined;
  const out: SketchDimensionRecord = { id, kind, loci, parameter };
  // The orientation bytes sit before the owner reference, inside this record.
  if (kind === 'linear' && seg.typeOf(id)?.guid === LINEAR_DIMENSION && r.pos - 7 >= f.start) {
    const b = seg.bulk;
    const [x, y] = [b[r.pos - 7], b[r.pos - 6]];
    if (x === 0x40 && y === 0) out.orientation = 'aligned';
    else if (x === 0 && y === 0x40) out.orientation = 'horizontal';
    else if (x === 0 && y === 0x80) out.orientation = 'vertical';
  }
  return out;
}

/**
 * Every sketch's relations and dimensions, keyed by the sketch container
 * (`sketchOf` names the container a point or curve record belongs to).
 */
export function readSketchConstraints(
  seg: Segment,
  parameters: readonly ParameterValue[],
  sketchOf: (record: number) => number | undefined,
  problems: string[],
): Map<number, { relations: SketchRelation[]; dimensions: SketchDimensionRecord[] }> {
  const out = new Map<
    number,
    { relations: SketchRelation[]; dimensions: SketchDimensionRecord[] }
  >();
  const entry = (sketch: number) => {
    let e = out.get(sketch);
    if (!e) {
      e = { relations: [], dimensions: [] };
      out.set(sketch, e);
    }
    return e;
  };
  for (const id of seg.idsOf(SKETCH_RELATION)) {
    try {
      const r = sketchRelation.decode(seg, id);
      const sketch = r.loci.map((l) => sketchOf(l.id)).find((s) => s !== undefined) ?? r.sketch;
      entry(sketch).relations.push(r);
    } catch (error) {
      problems.push(`relation #${id}: ${(error as Error).message}`);
    }
  }
  const byOwner = new Map<number, ParameterValue>();
  for (const p of parameters) if (p.owner !== undefined) byOwner.set(p.owner, p);
  for (const type of seg.types) {
    if (type.base !== SKETCH_DIMENSION) continue;
    for (const id of type.ids) {
      try {
        const d = readSketchDimension(seg, id, (owner) => byOwner.get(owner));
        const sketch = d?.loci.map((l) => sketchOf(l.id)).find((s) => s !== undefined);
        if (d && sketch !== undefined) entry(sketch).dimensions.push(d);
      } catch (error) {
        problems.push(`dimension #${id}: ${(error as Error).message}`);
      }
    }
  }
  return out;
}
