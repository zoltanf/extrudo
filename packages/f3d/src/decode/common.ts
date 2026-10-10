/** Shared pieces of the record decoders. */
import { F3dFormatError, type Reader } from '../bytes';
import { readPrologue, type Segment } from '../segment';

/** A decoder for one record type: reads a record's most-derived level exactly. */
export interface RecordDecoder<T> {
  /** A short name for reports. */
  name: string;
  decode(seg: Segment, id: number): T;
}

/** Fails when a decoder left bytes unread. */
export function expectEnd(r: Reader, what: string): void {
  if (!r.done) throw new F3dFormatError(`${what}: ${r.remaining} bytes left at ${r.pos}.`);
}

/**
 * Runs `read` over a record's most-derived level after the two-byte prologue
 * (no leading block, the property block read into `props`) and checks it read
 * the level to its end.
 */
export function decodeLevel<T>(
  seg: Segment,
  id: number,
  what: string,
  read: (r: Reader, props: Map<string, bigint>, version: number) => T,
): T {
  const r = seg.reader(id);
  const p = readPrologue(r);
  if (p.leading) throw new F3dFormatError(`${what} #${id}: unexpected leading block.`);
  const type = seg.typeOf(id);
  const out = read(r, p.props, type?.version ?? -1);
  expectEnd(r, `${what} #${id}`);
  return out;
}

export function unsupported(what: string, version: number): never {
  throw new F3dFormatError(`${what}: version ${version} is not supported.`);
}
