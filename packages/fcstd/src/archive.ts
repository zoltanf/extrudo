/**
 * The `.FCStd` container: a plain ZIP archive, its entries stored or deflated.
 *
 * The file is untrusted. The central directory is walked here (not with
 * fflate's `unzipSync`, which allocates each entry's declared size and
 * inflates everything it is given) and every limit below is checked for every
 * entry before any byte is inflated. Entries are inflated only when asked for
 * (`FcEntries.get`), streaming into their declared size, which they must fill
 * exactly. Entry names are keys only, never paths.
 */
import { Inflate } from 'fflate';
import { FcstdFormatError } from './errors';

/**
 * The most entries an archive may hold. The library's largest file has 1,657
 * (a 1.x file: a shape, an element map and colour lists per object).
 */
export const MAX_ENTRIES = 20_000;
/** The most one entry may declare. The library's largest is 6.3 MB (a `Document.xml`). */
export const MAX_ENTRY_BYTES = 128 * 1024 * 1024;
/** The most all entries together may declare. The library's largest file declares 25 MB. */
export const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
/**
 * The most an entry may declare per compressed byte (plus 4 kB, for tiny
 * entries). The library's highest is 145 to 1; deflate itself tops out near
 * 1,032 to 1.
 */
export const MAX_RATIO = 500;
/** Compressed bytes fed to the inflater at a time: a chunk unpacks to at most about 1,000 times its size. */
const CHUNK = 4 * 1024;

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const ZIP64_EXTRA = 0x0001;

const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));

/** One entry as the central directory declares it. */
interface Entry {
  method: number;
  /** Where the compressed bytes start. */
  start: number;
  compressed: number;
  size: number;
  crc: number;
}

/** The archive's entries by name. Only `get` inflates, once per entry. */
export interface FcEntries {
  /** Every file entry's name, in archive order (directories and refused names left out). */
  readonly names: readonly string[];
  has(name: string): boolean;
  /** The declared (inflated) size of an entry. */
  size(name: string): number | undefined;
  /**
   * The entry's bytes, inflated on first use; `undefined` when there is no
   * such entry. Throws `FcstdFormatError` when the entry's data is bad.
   */
  get(name: string): Uint8Array | undefined;
  /** What the archive had that was left out (duplicate names, refused names, other compression methods). */
  readonly problems: readonly string[];
}

/**
 * A name that could escape a folder if anyone ever used it as a path: an
 * absolute path, a drive letter, a backslash, a `..` part, or a control
 * character. FreeCAD writes plain names (`Document.xml`, `Pad.Shape.brp`,
 * `thumbnails/Thumbnail.png`).
 */
function badName(name: string): boolean {
  if (name === '' || name.startsWith('/') || name.includes('\\') || /^[A-Za-z]:/.test(name))
    return true;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is refused.
  if (/[\u0000-\u001f]/.test(name)) return true;
  return name.split('/').some((part) => part === '..' || part === '.');
}

/** The CRC-32 table (IEEE). */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++)
    c = (CRC_TABLE[(c ^ (data[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Inflates one entry into a buffer of its declared size, streaming, so it
 * stops as soon as the data runs past that size, and checks it fills it
 * exactly and matches its CRC.
 */
function inflate(bytes: Uint8Array, entry: Entry, name: string): Uint8Array {
  const data = bytes.subarray(entry.start, entry.start + entry.compressed);
  let out: Uint8Array;
  if (entry.method === 0) out = data;
  else {
    out = new Uint8Array(entry.size);
    let at = 0;
    const take = (chunk: Uint8Array) => {
      if (at + chunk.length > entry.size)
        throw new FcstdFormatError(
          `Bad ZIP: ${name} unpacks to more than its declared ${entry.size} bytes.`,
        );
      out.set(chunk, at);
      at += chunk.length;
    };
    try {
      const stream = new Inflate(take);
      for (let i = 0; i === 0 || i < data.length; i += CHUNK)
        stream.push(data.subarray(i, i + CHUNK), i + CHUNK >= data.length);
    } catch (error) {
      if (error instanceof FcstdFormatError) throw error;
      throw new FcstdFormatError(`Bad compressed data in ${name}: ${(error as Error).message}`);
    }
    if (at !== entry.size)
      throw new FcstdFormatError(
        `Bad ZIP: ${name} unpacks to ${at} bytes, not its declared ${entry.size}.`,
      );
  }
  if (crc32(out) !== entry.crc) throw new FcstdFormatError(`Bad ZIP: ${name} fails its checksum.`);
  return out;
}

/**
 * The archive's central directory, checked: entry count, sizes, ratio,
 * methods, flags and local headers. Throws `FcstdFormatError` with a plain
 * message for a file that isn't a readable `.FCStd` archive.
 */
export function unzipFcstd(bytes: Uint8Array): FcEntries {
  const notZip = () => new FcstdFormatError('This is not an FCStd file (not a ZIP archive).');
  if (bytes.length < 22) throw notZip();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw notZip();
  const count = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directory = view.getUint32(eocd + 16, true);
  if (
    (eocd >= 20 && view.getUint32(eocd - 20, true) === ZIP64_LOCATOR) ||
    count === 0xffff ||
    directory === 0xffffffff ||
    directorySize === 0xffffffff
  )
    throw new FcstdFormatError('This FCStd file is a ZIP64 archive, which is not supported.');
  if (view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0)
    throw new FcstdFormatError('This FCStd file spans several disks, which is not supported.');
  if (count > MAX_ENTRIES)
    throw new FcstdFormatError(
      `This FCStd file has too many entries (${count}; the limit is ${MAX_ENTRIES}).`,
    );
  const entries = new Map<string, Entry>();
  const names: string[] = [];
  const problems: string[] = [];
  const locals = new Set<number>();
  const decoder = new TextDecoder('utf-8');
  let declaredTotal = 0;
  let p = directory;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== CENTRAL)
      throw new FcstdFormatError('Bad ZIP central directory.');
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const compressed = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const next = p + 46 + nameLength + extraLength + commentLength;
    if (next > bytes.length) throw new FcstdFormatError('Bad ZIP central directory.');
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength));
    for (let e = p + 46 + nameLength; e + 4 <= p + 46 + nameLength + extraLength; ) {
      if (view.getUint16(e, true) === ZIP64_EXTRA)
        throw new FcstdFormatError('This FCStd file is a ZIP64 archive, which is not supported.');
      e += 4 + view.getUint16(e + 2, true);
    }
    p = next;
    if (compressed === 0xffffffff || size === 0xffffffff || local === 0xffffffff)
      throw new FcstdFormatError('This FCStd file is a ZIP64 archive, which is not supported.');
    if (flags & 0x41)
      throw new FcstdFormatError(`This FCStd file is encrypted (${name}), which is not supported.`);
    if (name.endsWith('/')) continue;
    if (size > MAX_ENTRY_BYTES)
      throw new FcstdFormatError(
        `This FCStd file is too large to import (${name} unpacks to more than ${mb(MAX_ENTRY_BYTES)} MB).`,
      );
    declaredTotal += size;
    if (declaredTotal > MAX_TOTAL_BYTES)
      throw new FcstdFormatError(
        `This FCStd file is too large to import (its entries unpack to more than ${mb(MAX_TOTAL_BYTES)} MB).`,
      );
    if (badName(name)) {
      problems.push(
        `archive: an entry name that is not a plain name was left out (${JSON.stringify(name.slice(0, 80))}).`,
      );
      continue;
    }
    if (entries.has(name)) {
      problems.push(`archive: a second entry named ${name} was left out (the first is read).`);
      continue;
    }
    if (method !== 0 && method !== 8) {
      problems.push(`archive: ${name} uses ZIP compression method ${method}, which is not read.`);
      continue;
    }
    if (method === 0 ? size !== compressed : size > compressed * MAX_RATIO + 4096)
      throw new FcstdFormatError(
        method === 0
          ? `Bad ZIP: ${name} is stored with ${compressed} bytes but declares ${size}.`
          : `Bad ZIP: ${name} claims to unpack to ${size} bytes from ${compressed} (more than ${MAX_RATIO} to 1).`,
      );
    if (locals.has(local))
      throw new FcstdFormatError(`Bad ZIP: two entries share one local header (${name}).`);
    locals.add(local);
    if (local + 30 > bytes.length || view.getUint32(local, true) !== LOCAL)
      throw new FcstdFormatError(`Bad ZIP local header for ${name}.`);
    const localNameLength = view.getUint16(local + 26, true);
    const start = local + 30 + localNameLength + view.getUint16(local + 28, true);
    if (start + compressed > bytes.length)
      throw new FcstdFormatError(`Bad ZIP: ${name} runs past the end of the file.`);
    if (decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLength)) !== name)
      throw new FcstdFormatError(`Bad ZIP: ${name} does not match its local header.`);
    entries.set(name, { method, start, compressed, size, crc });
    names.push(name);
  }
  const inflated = new Map<string, Uint8Array>();
  return {
    names,
    problems,
    has: (name) => entries.has(name),
    size: (name) => entries.get(name)?.size,
    get(name) {
      const done = inflated.get(name);
      if (done) return done;
      const entry = entries.get(name);
      if (!entry) return undefined;
      const out = inflate(bytes, entry, name);
      inflated.set(name, out);
      return out;
    },
  };
}
