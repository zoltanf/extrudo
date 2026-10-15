/**
 * The `.f3d` container: a ZIP archive. Entries are stored, deflated or (since
 * 2025) Zstandard-compressed (method 93), which fflate does not read, so the
 * central directory is walked here and each entry inflated by its own method.
 *
 * The file is untrusted: a crafted archive can declare a huge size, hold a
 * decompression bomb or point two entries at one local header. Every limit
 * below is enforced before the bytes are inflated, and only the entries the
 * importer actually reads are decompressed at all.
 */
import { Inflate } from 'fflate';
import { Decompress as ZstdDecompress } from 'fzstd';
import { F3dFormatError } from './bytes';

export type Entries = ReadonlyMap<string, Uint8Array>;

/** The most one entry may declare, and inflate to. */
export const MAX_ENTRY_BYTES = 256 * 1024 * 1024;
/** The most all entries together may declare, and inflate to. */
export const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
/** The most entries an archive may hold. */
export const MAX_ENTRIES = 4096;
/**
 * The most an entry may declare per compressed byte. The files' entries
 * unpack to at most 16 times their compressed size (MetaStream/BulkStream
 * 15.8, B-rep streams 10.8); a bomb gets far past this.
 */
export const MAX_RATIO = 200;
/** The largest Zstandard window a frame may ask for (the files use 2 MB). */
export const MAX_ZSTD_WINDOW = 32 * 1024 * 1024;
/** Compressed bytes fed to the inflater at a time: a deflate chunk unpacks to at most about 1,000 times its size. */
const CHUNK = 4 * 1024;
/** A thumbnail larger than this, or not a PNG, is ignored. */
const MAX_PREVIEW_BYTES = 1024 * 1024;

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/**
 * The entries the import reads: the design streams, the B-rep streams and the
 * preview. Everything else is skipped rather than decompressed (H3).
 */
const READ_ENTRY = /(?:^|\/)(?:MetaStream\.dat|BulkStream\.dat|small\.png)$|\.smbh?$/;

const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));

/**
 * Decompresses one entry into a buffer of its declared size, streaming, so it
 * stops as soon as the data runs past that size, and checks it fills it
 * exactly. Nothing is allocated before the declared size is plausible for the
 * compressed bytes.
 */
function inflate(data: Uint8Array, method: number, size: number, name: string): Uint8Array {
  if (method === 0) return data;
  if (method !== 8 && method !== 93)
    throw new F3dFormatError(`Unsupported ZIP compression method ${method} for ${name}.`);
  if (size > data.length * MAX_RATIO + 4096)
    throw new F3dFormatError(
      `Bad ZIP: ${name} claims to unpack to ${size} bytes from ${data.length} (more than ${MAX_RATIO} to 1).`,
    );
  if (method === 93) zstdFrame(data, size, name);
  const out = new Uint8Array(size);
  let at = 0;
  const take = (chunk: Uint8Array) => {
    if (at + chunk.length > size)
      throw new F3dFormatError(`Bad ZIP: ${name} unpacks to more than its declared ${size} bytes.`);
    out.set(chunk, at);
    at += chunk.length;
  };
  try {
    if (method === 8) {
      const stream = new Inflate(take);
      for (let i = 0; i === 0 || i < data.length; i += CHUNK)
        stream.push(data.subarray(i, i + CHUNK), i + CHUNK >= data.length);
    } else new ZstdDecompress(take).push(data, true);
  } catch (error) {
    if (error instanceof F3dFormatError) throw error;
    throw new F3dFormatError(`Bad compressed data in ${name}: ${(error as Error).message}`);
  }
  if (at !== size) throw new F3dFormatError(`Wrong size after decompressing ${name}.`);
  return out;
}

/**
 * Checks a Zstandard entry is one frame, without a dictionary, whose window is
 * at most `MAX_ZSTD_WINDOW` and whose content size (when given) is the declared
 * one: the decoder allocates the window from the header's few bytes, and a
 * further frame would allocate another unchecked. Walks the block headers.
 */
function zstdFrame(data: Uint8Array, size: number, name: string): void {
  const bad = (why: string) => new F3dFormatError(`Bad Zstandard data in ${name}: ${why}.`);
  const u = (at: number, n: number) => {
    if (at + n > data.length) throw bad('it ends early');
    let v = 0;
    for (let i = 0; i < n; i++) v += (data[at + i] as number) * 2 ** (8 * i);
    return v;
  };
  if (u(0, 4) !== 0xfd2fb528) throw bad('not a Zstandard frame');
  const flags = u(4, 1);
  const single = (flags >> 5) & 1;
  const sizeBytes = flags >> 6 ? 1 << (flags >> 6) : single;
  if (flags & 0x0b) throw bad('a dictionary or a reserved bit');
  let p = 5;
  let window = 0;
  if (!single) {
    const descriptor = u(p++, 1);
    const base = 2 ** (10 + (descriptor >> 3));
    window = base + (base / 8) * (descriptor & 7);
  }
  if (sizeBytes) {
    const content = u(p, sizeBytes) + (sizeBytes === 2 ? 256 : 0);
    if (content !== size) throw bad(`it holds ${content} bytes, not ${size}`);
    if (single) window = content;
    p += sizeBytes;
  }
  if (window > MAX_ZSTD_WINDOW) throw bad(`a ${window}-byte window`);
  for (let last = 0; !last; ) {
    const header = u(p, 3);
    last = header & 1;
    const type = (header >> 1) & 3;
    if (type === 3) throw bad('a reserved block type');
    p += 3 + (type === 1 ? 1 : header >> 3);
  }
  if (flags & 4) p += 4; // the checksum
  if (p !== data.length) throw bad('more than one frame');
}

/** Every file entry the import reads, decompressed. Directories are skipped. */
export function unzip(bytes: Uint8Array): Entries {
  if (bytes.length < 22)
    throw new F3dFormatError('Not a ZIP archive (no end of central directory).');
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
  if (count > MAX_ENTRIES)
    throw new F3dFormatError(
      `This .f3d file has too many entries (${count}; the limit is ${MAX_ENTRIES}).`,
    );
  let p = view.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  const names = new TextDecoder('utf-8');
  const locals = new Set<number>();
  let declaredTotal = 0;
  let realTotal = 0;
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
    if (p + 46 + nameLength > bytes.length) throw new F3dFormatError('Bad ZIP central directory.');
    const name = names.decode(bytes.subarray(p + 46, p + 46 + nameLength));
    p += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    if (size > MAX_ENTRY_BYTES)
      throw new F3dFormatError(
        `This .f3d file is too large to import (${name} unpacks to more than ${mb(MAX_ENTRY_BYTES)} MB).`,
      );
    declaredTotal += size;
    if (declaredTotal > MAX_TOTAL_BYTES)
      throw new F3dFormatError(
        `This .f3d file is too large to import (its entries unpack to more than ${mb(MAX_TOTAL_BYTES)} MB).`,
      );
    if (!READ_ENTRY.test(name)) continue;
    if (locals.has(local))
      throw new F3dFormatError(`Bad ZIP: two entries share one local header (${name}).`);
    locals.add(local);
    if (local + 30 > bytes.length || view.getUint32(local, true) !== LOCAL)
      throw new F3dFormatError(`Bad ZIP local header for ${name}.`);
    const localNameLength = view.getUint16(local + 26, true);
    if (local + 30 + localNameLength > bytes.length)
      throw new F3dFormatError(`Bad ZIP local header for ${name}.`);
    const localName = names.decode(bytes.subarray(local + 30, local + 30 + localNameLength));
    if (localName !== name)
      throw new F3dFormatError(`Bad ZIP: ${name} does not match its local header.`);
    const start = local + 30 + localNameLength + view.getUint16(local + 28, true);
    if (start + compressed > bytes.length)
      throw new F3dFormatError(`Bad ZIP local header for ${name}.`);
    const content = inflate(bytes.subarray(start, start + compressed), method, size, name);
    if (content.length !== size)
      throw new F3dFormatError(`Wrong size after decompressing ${name}.`);
    realTotal += content.length;
    if (realTotal > MAX_TOTAL_BYTES)
      throw new F3dFormatError(
        `This .f3d file is too large to import (its entries unpack to more than ${mb(MAX_TOTAL_BYTES)} MB).`,
      );
    out.set(name, content);
  }
  return out;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(content: Uint8Array): boolean {
  return PNG_SIGNATURE.every((b, i) => content[i] === b);
}

/** The design's preview PNG, when the archive holds a usable one (L1). */
export function previewBytes(entries: Entries): Uint8Array | undefined {
  for (const [name, content] of entries) {
    if (!name.endsWith('/Previews/small.png') && name !== 'Previews/small.png') continue;
    if (content.length > MAX_PREVIEW_BYTES || !isPng(content)) continue;
    return content;
  }
  return undefined;
}

/** One design segment: its record stream and the index that describes it. */
export interface SegmentFiles {
  /** The folder the two streams are in, e.g. `…AssetName[Active]/Design1`. */
  folder: string;
  meta: Uint8Array;
  bulk: Uint8Array;
}

/**
 * The Design segments of an archive: `Design1/` in older files,
 * `…DesignSegmentType1/` since 2025. The component-tree segment
 * (`…ACTSegmentType1/`) is not a design segment.
 */
export function designSegments(entries: Entries): SegmentFiles[] {
  const out: SegmentFiles[] = [];
  for (const [name, meta] of entries) {
    if (!name.endsWith('/MetaStream.dat')) continue;
    const folder = name.slice(0, -'/MetaStream.dat'.length);
    const leaf = folder.slice(folder.lastIndexOf('/') + 1);
    if (!/^(Design\d+|[A-Za-z]*DesignSegmentType\d+)$/.test(leaf)) continue;
    const bulk = entries.get(`${folder}/BulkStream.dat`);
    if (!bulk) throw new F3dFormatError(`${folder} has no BulkStream.dat.`);
    out.push({ folder, meta, bulk });
  }
  return out.sort((a, b) => a.folder.localeCompare(b.folder));
}
