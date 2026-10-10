/**
 * A design segment: `MetaStream.dat` (the type table and the record indexes)
 * over `BulkStream.dat` (the records).
 *
 * MetaStream: a header, a type table (type GUID, base type GUID, type version,
 * module, the ids of that type's records), the named-record ids, the primary
 * index (record id → offset) and the secondary index (record id → offset of a
 * nested header inside that record, where its base-class level starts).
 *
 * A record in BulkStream: LP-ASCII class tag (256 + the type's index in the
 * table, so local to the segment: the type GUID is the only stable identity),
 * u64 record id, LP-ASCII record name, then the members. Members are untagged,
 * written one class level at a time, most-derived first.
 */
import { F3dFormatError, Reader } from './bytes';

export interface TypeEntry {
  index: number;
  /** Upper-case type GUID (36 or 37 characters; compared as an opaque string). */
  guid: string;
  base: string;
  version: number;
  module: string;
  ids: number[];
}

/** Where one record's bytes are, split into its class levels. */
export interface RecordFrame {
  id: number;
  type: TypeEntry;
  name: string;
  /** Byte range of the most-derived level's members. */
  start: number;
  end: number;
  /** The base-class level, when the record carries a nested header for one. */
  base?: { tag: number; start: number; end: number };
}

export class Segment {
  readonly types: TypeEntry[] = [];
  readonly #typeOf = new Map<number, TypeEntry>();
  readonly #byGuid = new Map<string, TypeEntry>();
  /** Record id → BulkStream offset of the record. */
  readonly primary = new Map<number, number>();
  /** Record id → offset of the nested (base level) header inside the record. */
  readonly secondary = new Map<number, number>();
  readonly #ends = new Map<number, number>();
  readonly #frames = new Map<number, RecordFrame>();
  readonly name: string;
  readonly serializerMagic: number;
  readonly bulk: Uint8Array;

  constructor(meta: Uint8Array, bulk: Uint8Array) {
    this.bulk = bulk;
    const r = new Reader(meta);
    this.name = r.str8(256);
    r.u32(); // segment id
    r.wstr(256); // asset GUID
    this.serializerMagic = r.u32();
    r.skip(this.serializerMagic === 1234 ? 12 : 4);
    r.str8(256); // full segment type name
    r.str8(256); // add-in name
    r.skip(8); // segment type code, reserved
    const count = r.u32();
    for (let i = 0; i < count; i++) {
      const guid = r.str8(64).toUpperCase();
      const base = r.str8(64).toUpperCase();
      const version = r.u32();
      const module = r.str8(256);
      const n = r.u32();
      if (n > r.remaining / 8) throw new F3dFormatError('Bad type table.');
      const ids: number[] = [];
      for (let k = 0; k < n; k++) ids.push(r.u64());
      const entry: TypeEntry = { index: i, guid, base, version, module, ids };
      this.types.push(entry);
      this.#byGuid.set(guid, entry);
      for (const id of ids) this.#typeOf.set(id, entry);
    }
    const named = r.u32();
    r.skip(8 * named);
    for (const index of [this.primary, this.secondary]) {
      const n = r.u32();
      if (n > r.remaining / 16) throw new F3dFormatError('Bad record index.');
      for (let k = 0; k < n; k++) {
        const id = r.u64();
        index.set(id, r.u64());
      }
    }
    // Each record ends where the next one (or the end of the stream) starts.
    const starts = [...this.primary.values()].sort((a, b) => a - b);
    starts.push(bulk.length);
    const next = new Map<number, number>();
    for (let k = 0; k + 1 < starts.length; k++)
      next.set(starts[k] as number, starts[k + 1] as number);
    for (const [id, at] of this.primary) this.#ends.set(id, next.get(at) ?? bulk.length);
  }

  typeOf(id: number): TypeEntry | undefined {
    return this.#typeOf.get(id);
  }

  type(guid: string): TypeEntry | undefined {
    return this.#byGuid.get(guid.toUpperCase());
  }

  /** Ids of every record of a type (in the table's order, which is creation order). */
  idsOf(guid: string): number[] {
    return this.#byGuid.get(guid.toUpperCase())?.ids ?? [];
  }

  has(id: number): boolean {
    return this.primary.has(id);
  }

  /** The framing of one record. */
  frame(id: number): RecordFrame {
    const cached = this.#frames.get(id);
    if (cached) return cached;
    const at = this.primary.get(id);
    const type = this.#typeOf.get(id);
    if (at === undefined || !type) throw new F3dFormatError(`No record ${id}.`);
    const end = this.#ends.get(id) as number;
    const r = new Reader(this.bulk, at, end);
    const tag = Number(r.str8(8));
    if (tag !== 256 + type.index) throw new F3dFormatError(`Record ${id} has class tag ${tag}.`);
    if (r.u64() !== id) throw new F3dFormatError(`Record ${id} repeats another id.`);
    const name = r.str8(4096);
    const frame: RecordFrame = { id, type, name, start: r.pos, end };
    const nested = this.secondary.get(id);
    if (nested !== undefined) {
      if (nested <= r.pos || nested >= end)
        throw new F3dFormatError(`Record ${id}: bad nested header.`);
      const b = new Reader(this.bulk, nested, end);
      const baseTag = Number(b.str8(8));
      if (b.u64() !== id) throw new F3dFormatError(`Record ${id}: nested header names another id.`);
      b.str8(4096); // the base level's (empty) name
      frame.end = nested;
      frame.base = { tag: baseTag, start: b.pos, end };
    }
    this.#frames.set(id, frame);
    return frame;
  }

  /** A reader over a record's most-derived level. */
  reader(id: number): Reader {
    const f = this.frame(id);
    return new Reader(this.bulk, f.start, f.end);
  }

  /** A reader over a record's base level (empty when it has none). */
  baseReader(id: number): Reader {
    const f = this.frame(id);
    return f.base
      ? new Reader(this.bulk, f.base.start, f.base.end)
      : new Reader(this.bulk, f.end, f.end);
  }
}

/** The leading part every record payload opens with. */
export interface Prologue {
  /** True when the class wrote its leading block (the caller reads it). */
  leading: boolean;
  /** The property block: `pt_tag`, `crv_primary_id`, `EntityGenesis`, … */
  props: Map<string, bigint>;
}

/**
 * Reads the payload prologue: a leading-block presence byte and, when there is
 * no leading block, the property-block presence byte and the block. A record
 * with a leading block reads it and then calls {@link readProps}.
 */
export function readPrologue(r: Reader): Prologue {
  const leading = r.bool();
  if (leading) return { leading, props: new Map() };
  return { leading, props: readProps(r) };
}

/** The property-block presence byte and, when present, the block. */
export function readProps(r: Reader): Map<string, bigint> {
  const props = new Map<string, bigint>();
  if (!r.bool()) return props;
  const n = r.u32();
  if (n > 64) throw new F3dFormatError(`Property block of ${n} entries at ${r.pos}.`);
  for (let i = 0; i < n; i++) {
    const key = r.str8(256);
    const type = r.str8(256);
    if (type !== 'IntrinsicMetaTypeuint64')
      throw new F3dFormatError(`Unknown property type ${type} at ${r.pos}.`);
    props.set(key, r.u64big());
  }
  return props;
}
