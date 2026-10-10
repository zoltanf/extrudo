/**
 * The `.f3d` container: a ZIP archive. Entries are stored, deflated or (since
 * 2025) Zstandard-compressed (method 93), which fflate does not read, so the
 * central directory is walked here and each entry inflated by its own method.
 */
import { inflateSync } from 'fflate';
import { decompress as zstd } from 'fzstd';
import { F3dFormatError } from './bytes';

export type Entries = ReadonlyMap<string, Uint8Array>;

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Every file entry of a ZIP archive, decompressed. Directories are skipped. */
export function unzip(bytes: Uint8Array): Entries {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new F3dFormatError('Not a ZIP archive (no end of central directory).');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  const names = new TextDecoder('utf-8');
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== CENTRAL)
      throw new F3dFormatError('Bad ZIP central directory.');
    const method = view.getUint16(p + 10, true);
    const compressed = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = names.decode(bytes.subarray(p + 46, p + 46 + nameLength));
    p += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    if (local + 30 > bytes.length || view.getUint32(local, true) !== LOCAL)
      throw new F3dFormatError(`Bad ZIP local header for ${name}.`);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + compressed);
    let content: Uint8Array;
    if (method === 0) content = data;
    else if (method === 8) content = inflateSync(data, { out: new Uint8Array(size) });
    else if (method === 93) content = zstd(data);
    else throw new F3dFormatError(`Unsupported ZIP compression method ${method} for ${name}.`);
    if (content.length !== size)
      throw new F3dFormatError(`Wrong size after decompressing ${name}.`);
    out.set(name, content);
  }
  return out;
}

/** One design segment: its record stream and the index that describes it. */
export interface SegmentFiles {
  /** The folder the two streams are in, e.g. `FusionAssetName[Active]/Design1`. */
  folder: string;
  meta: Uint8Array;
  bulk: Uint8Array;
}

/**
 * The Design segments of an archive: `Design1/` in older files,
 * `FusionDesignSegmentType1/` since 2025. The component-tree segment
 * (`FusionACTSegmentType1/`) is not a design segment.
 */
export function designSegments(entries: Entries): SegmentFiles[] {
  const out: SegmentFiles[] = [];
  for (const [name, meta] of entries) {
    if (!name.endsWith('/MetaStream.dat')) continue;
    const folder = name.slice(0, -'/MetaStream.dat'.length);
    const leaf = folder.slice(folder.lastIndexOf('/') + 1);
    if (!/^(Design\d+|FusionDesignSegmentType\d+)$/.test(leaf)) continue;
    const bulk = entries.get(`${folder}/BulkStream.dat`);
    if (!bulk) throw new F3dFormatError(`${folder} has no BulkStream.dat.`);
    out.push({ folder, meta, bulk });
  }
  return out.sort((a, b) => a.folder.localeCompare(b.folder));
}
