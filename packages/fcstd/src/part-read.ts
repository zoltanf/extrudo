/**
 * What S11 reads of the Part workbench's objects beyond the typed properties
 * (ADR-0144 S11, FORMAT.md): a Part fillet's or chamfer's edge list, a binary
 * archive entry, read with its limits.
 */
import type { FcDocument, FcObject } from './model';

/** The most edges a Part fillet or chamfer may list (S6's `MAX_DRESSUP_ELEMENTS`). */
export const MAX_PART_DRESSUP_EDGES = 1_000;
/** One edge of the list: 4 bytes of index, two 8-byte sizes. */
const EDGE_BYTES = 20;

export interface PartDressUpEdge {
  /** As the file numbers it: `EdgeN` of the base's stored shape, from 1. */
  readonly index: number;
  /** The radius (a fillet: at the edge's start) or the first size (a chamfer). */
  readonly first: number;
  /** A fillet's radius at the edge's end, a chamfer's second size. */
  readonly second: number;
}

/**
 * A Part fillet's or chamfer's `Edges` (`Part::PropertyFilletEdges`): a
 * little-endian 32-bit count, then per edge a 32-bit index and two doubles.
 * Refused with a reason: no entry, a count past `MAX_PART_DRESSUP_EDGES` or
 * past what the entry holds, an entry of another length. The numbers are
 * returned as stored; the importer checks indices and sizes.
 */
export function readPartDressUpEdges(
  doc: FcDocument,
  o: FcObject,
): { readonly edges: readonly PartDressUpEdge[] } | { readonly problem: string } {
  const v = o.properties.Edges?.value;
  if (v?.kind !== 'file' || v.entry === '') return { problem: 'it stores no edge list' };
  const size = doc.entries.size(v.entry);
  if (size === undefined) return { problem: 'its edge list is missing from the file' };
  // Checked by the archive's size before anything is inflated.
  if (size < 4 || size > 4 + EDGE_BYTES * MAX_PART_DRESSUP_EDGES)
    return {
      problem: `its edge list is ${size} bytes, not a list of at most ${MAX_PART_DRESSUP_EDGES} edges`,
    };
  let bytes: Uint8Array | undefined;
  try {
    bytes = doc.entries.get(v.entry);
  } catch (error) {
    return { problem: `its edge list can't be read: ${(error as Error).message}` };
  }
  if (!bytes) return { problem: 'its edge list is missing from the file' };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(0, true);
  if (count > MAX_PART_DRESSUP_EDGES)
    return { problem: `it lists ${count} edges, more than ${MAX_PART_DRESSUP_EDGES}` };
  if (bytes.byteLength !== 4 + EDGE_BYTES * count)
    return {
      problem: `its edge list says ${count} edges but holds ${bytes.byteLength} bytes`,
    };
  const edges: PartDressUpEdge[] = [];
  for (let k = 0; k < count; k++) {
    const at = 4 + EDGE_BYTES * k;
    edges.push({
      index: view.getInt32(at, true),
      first: view.getFloat64(at + 4, true),
      second: view.getFloat64(at + 12, true),
    });
  }
  return { edges };
}
