/**
 * The ZIP reader against hostile archives (H3, L1) and the preview a single
 * `importF3d` call now returns (M2). The bodies here are hand-built ZIP bytes
 * so an entry's declared size and local header can be lied about the way a
 * crafted file would.
 */
import { deflateSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  MAX_ENTRIES,
  MAX_ENTRY_BYTES,
  MAX_RATIO,
  MAX_TOTAL_BYTES,
  previewBytes,
  unzip,
} from './archive';
import { f3dBodiesStep } from './brep-step';
import { f3dPreview, importF3d } from './index';
import { readF3dEntries } from './model';

const enc = new TextEncoder();
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const DESIGN = 'Asset/Design1';
const META = `${DESIGN}/MetaStream.dat`;
const BULK = `${DESIGN}/BulkStream.dat`;
const PREVIEW = 'Asset/Previews/small.png';

function png(size: number): Uint8Array {
  const out = new Uint8Array(size);
  out.set(PNG, 0);
  return out;
}

/** A minimal design segment that decodes to an empty design. */
function metaStream(): Uint8Array {
  const out: number[] = [];
  const u32 = (v: number) =>
    out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  const str8 = (s: string) => {
    const b = [...enc.encode(s)];
    u32(b.length);
    out.push(...b);
  };
  str8('Design1');
  u32(1); // segment id
  u32(0); // asset GUID (empty)
  u32(0); // serializer magic: not 1234, so four reserved bytes
  u32(0);
  str8(''); // segment type name
  str8(''); // add-in name
  u32(0);
  u32(0); // segment type code + reserved
  u32(0); // type count
  u32(0); // named records
  u32(0); // primary index
  u32(0); // secondary index
  return new Uint8Array(out);
}

/** A whole design: one empty segment plus the given extra entries. */
function designZip(extra: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    [META]: metaStream(),
    [BULK]: new Uint8Array(0),
    ...extra,
  });
}

interface RawEntry {
  name: string;
  data: Uint8Array;
  method?: number;
  declaredSize?: number;
  localName?: string;
  shareLocal?: number;
}

/** A ZIP with full control over each header (for the hostile cases). */
function rawZip(entries: RawEntry[], eocdCount = entries.length): Uint8Array {
  const out: number[] = [];
  const locals: number[] = [];
  for (const e of entries) {
    locals.push(out.length);
    const name = enc.encode(e.localName ?? e.name);
    const size = e.declaredSize ?? e.data.length;
    const local: number[] = [];
    const dv = (v: number, at: number, width: number) => {
      for (let i = 0; i < width; i++) local[at + i] = (v >>> (8 * i)) & 0xff;
    };
    local[0] = 0x50;
    local[1] = 0x4b;
    local[2] = 0x03;
    local[3] = 0x04;
    dv(e.method ?? 8, 8, 2);
    dv(e.data.length, 18, 4);
    dv(size, 22, 4);
    dv(name.length, 26, 2);
    local.length = 30;
    out.push(...local, ...name, ...e.data);
  }
  const cdOffset = out.length;
  entries.forEach((e, i) => {
    const name = enc.encode(e.name);
    const size = e.declaredSize ?? e.data.length;
    const cd: number[] = [];
    const dv = (v: number, at: number, width: number) => {
      for (let k = 0; k < width; k++) cd[at + k] = (v >>> (8 * k)) & 0xff;
    };
    cd[0] = 0x50;
    cd[1] = 0x4b;
    cd[2] = 0x01;
    cd[3] = 0x02;
    dv(e.method ?? 8, 10, 2);
    dv(e.data.length, 20, 4);
    dv(size, 24, 4);
    dv(name.length, 28, 2);
    dv(e.shareLocal ?? locals[i] ?? 0, 42, 4);
    cd.length = 46;
    out.push(...cd, ...name);
  });
  const cdSize = out.length - cdOffset;
  const eocd = new Uint8Array(22);
  const dv2 = new DataView(eocd.buffer);
  dv2.setUint32(0, 0x06054b50, true);
  dv2.setUint16(8, eocdCount, true);
  dv2.setUint16(10, eocdCount, true);
  dv2.setUint32(12, cdSize, true);
  dv2.setUint32(16, cdOffset, true);
  out.push(...eocd);
  return new Uint8Array(out);
}

describe('unzip limits (H3)', () => {
  it('refuses an entry whose declared size is over the entry cap', () => {
    for (const method of [0, 8, 93]) {
      const bytes = rawZip([
        { name: META, data: new Uint8Array(4), method, declaredSize: MAX_ENTRY_BYTES + 1 },
      ]);
      expect(() => unzip(bytes)).toThrow(/too large to import/);
    }
  });

  it('refuses a running total over the total cap', () => {
    const each = Math.floor(MAX_TOTAL_BYTES / 2.5); // under the entry cap, over the total in three
    expect(each).toBeLessThanOrEqual(MAX_ENTRY_BYTES);
    const bytes = rawZip([
      { name: 'a/junk1.bin', data: new Uint8Array(0), method: 0, declaredSize: each },
      { name: 'b/junk2.bin', data: new Uint8Array(0), method: 0, declaredSize: each },
      { name: 'c/junk3.bin', data: new Uint8Array(0), method: 0, declaredSize: each },
    ]);
    expect(() => unzip(bytes)).toThrow(/too large to import/);
  });

  it('refuses too many entries', () => {
    expect(() => unzip(rawZip([], MAX_ENTRIES + 1))).toThrow(/too many entries/);
  });

  it('refuses a local header whose name does not match its central entry', () => {
    const bytes = rawZip([
      { name: META, localName: 'other/MetaStream.dat', data: new Uint8Array(0) },
    ]);
    expect(() => unzip(bytes)).toThrow(/does not match its local header/);
  });

  it('refuses two central entries that share one local header', () => {
    const bytes = rawZip([
      { name: 'a/Breps.BlobParts/x.smb', data: new Uint8Array(0) },
      { name: 'b/Breps.BlobParts/y.smb', data: new Uint8Array(0), shareLocal: 0 },
    ]);
    expect(() => unzip(bytes)).toThrow(/share one local header/);
  });

  it('refuses a deflated entry that unpacks past its declared size, without unpacking the rest', () => {
    // 64 MB of zeros (64 KB deflated) that declares 16 bytes: inflating it all
    // into the 16-byte buffer took half a second, about 7 s per compressed MB.
    const payload = deflateSync(new Uint8Array(64 * 1024 * 1024), { level: 9 });
    const t = performance.now();
    expect(() => unzip(rawZip([{ name: META, data: payload, declaredSize: 16 }]))).toThrow(
      /more than its declared 16 bytes/,
    );
    expect(performance.now() - t).toBeLessThan(250);
  });

  it('refuses a deflated entry that unpacks short of its declared size', () => {
    const payload = deflateSync(new Uint8Array(1000).fill(65));
    expect(() => unzip(rawZip([{ name: META, data: payload, declaredSize: 2000 }]))).toThrow(
      /Wrong size/,
    );
    expect(
      unzip(rawZip([{ name: META, data: payload, declaredSize: 1000 }])).get(META)?.[999],
    ).toBe(65);
  });

  it('refuses a declared size far beyond what the compressed bytes can hold, before allocating it', () => {
    const data = deflateSync(new Uint8Array(10));
    const t = performance.now();
    expect(() => unzip(rawZip([{ name: META, data, declaredSize: MAX_ENTRY_BYTES - 1 }]))).toThrow(
      new RegExp(`more than ${MAX_RATIO} to 1`),
    );
    expect(() =>
      unzip(rawZip([{ name: META, data: zstd(1, 10), method: 93, declaredSize: 100_000 }])),
    ).toThrow(new RegExp(`more than ${MAX_RATIO} to 1`));
    expect(performance.now() - t).toBeLessThan(250);
  });

  it('refuses garbage that is not deflate data', () => {
    expect(() =>
      unzip(rawZip([{ name: META, data: new Uint8Array([0xff, 0xff, 0xff]), declaredSize: 10 }])),
    ).toThrow(/Bad compressed data/);
  });

  it('does not decompress an entry the import never reads', () => {
    // Junk under a name no reader asks for, with a compression method whose
    // bytes are not valid: skipping it must mean nothing is inflated.
    const bytes = rawZip([
      { name: META, data: new Uint8Array(0), method: 0 },
      {
        name: 'Asset/Other/junk.bin',
        data: new Uint8Array([1, 2, 3]),
        method: 93,
      },
    ]);
    const entries = unzip(bytes);
    expect([...entries.keys()]).toEqual([META]);
  });
});

/**
 * A hand-built Zstandard frame of run-length blocks (`blocks` of `length`
 * bytes each): a 1 KB window, or a content size when `content` is given.
 */
function zstd(blocks: number, length: number, options: { content?: number; window?: number } = {}) {
  const out = [0x28, 0xb5, 0x2f, 0xfd];
  if (options.content !== undefined) out.push(0x20, options.content);
  else out.push(0x00, options.window ?? 0x00);
  for (let i = 0; i < blocks; i++) {
    const header = (i === blocks - 1 ? 1 : 0) | (1 << 1) | (length << 3);
    out.push(header & 0xff, (header >> 8) & 0xff, (header >> 16) & 0xff, 65 + i);
  }
  return new Uint8Array(out);
}

describe('unzip of Zstandard entries', () => {
  const entry = (data: Uint8Array, declaredSize: number) =>
    rawZip([{ name: META, data, method: 93, declaredSize }]);

  it('reads a frame that fills its declared size exactly', () => {
    expect([...(unzip(entry(zstd(2, 3), 6)).get(META) ?? [])]).toEqual([65, 65, 65, 66, 66, 66]);
    expect(unzip(entry(zstd(1, 5, { content: 5 }), 5)).get(META)?.length).toBe(5);
  });

  it('refuses a frame that unpacks past or short of its declared size', () => {
    expect(() => unzip(entry(zstd(2, 300), 400))).toThrow(/more than its declared 400 bytes/);
    // The padded buffer used to come back as if full.
    expect(() => unzip(entry(zstd(1, 300), 400))).toThrow(/Wrong size/);
    expect(() => unzip(entry(zstd(1, 5, { content: 5 }), 6))).toThrow(/holds 5 bytes, not 6/);
  });

  it('refuses a second frame, a huge window or a truncated frame before decoding', () => {
    const two = new Uint8Array([...zstd(1, 3), ...zstd(1, 3)]);
    expect(() => unzip(entry(two, 6))).toThrow(/more than one frame/);
    // Window descriptor 0xa8: a 1 GB window, allocated from these few bytes.
    expect(() => unzip(entry(zstd(1, 3, { window: 0xa8 }), 3))).toThrow(/window/);
    expect(() => unzip(entry(zstd(1, 3).subarray(0, 8), 3))).toThrow(/ends early/);
  });
});

describe('active design segment', () => {
  it('reads the [Active] design, not an Animation segment', () => {
    const entries = new Map<string, Uint8Array>([
      // The Animation asset's own segment sorts first; its stream is not a
      // design, so reading it would throw.
      ['Animation/Design1/MetaStream.dat', new Uint8Array([1, 2, 3])],
      ['Animation/Design1/BulkStream.dat', new Uint8Array(0)],
      ['Asset[Active]/Design1/MetaStream.dat', metaStream()],
      ['Asset[Active]/Design1/BulkStream.dat', new Uint8Array(0)],
    ]);
    expect(readF3dEntries(entries).features).toEqual([]);
  });

  it('reads the only segment when no folder is marked active', () => {
    const entries = new Map<string, Uint8Array>([
      ['Asset/Design1/MetaStream.dat', metaStream()],
      ['Asset/Design1/BulkStream.dat', new Uint8Array(0)],
    ]);
    expect(readF3dEntries(entries).features).toEqual([]);
  });
});

describe('preview (L1, M2)', () => {
  it('returns a valid PNG preview from importF3d in one pass', () => {
    const picture = png(64);
    const result = importF3d(designZip({ [PREVIEW]: picture }), 'Part');
    expect(result.preview).toEqual(picture);
    expect(result.design.toJSON().features).toEqual([]);
  });

  it('ignores a preview that is not a PNG', () => {
    const bytes = designZip({ [PREVIEW]: new Uint8Array([1, 2, 3, 4]) });
    expect(f3dPreview(bytes)).toBeUndefined();
    expect(importF3d(bytes, 'Part').preview).toBeUndefined();
  });

  it('ignores a preview larger than 1 MB', () => {
    // Not all zeros: those compress past the ratio a real entry can have.
    const big = png(1024 * 1024 + 1);
    let x = 1;
    for (let i = PNG.length; i < big.length; i++) {
      x = (x * 1103515245 + 12345) >>> 0;
      big[i] = x >>> 24;
    }
    const bytes = designZip({ [PREVIEW]: big });
    expect(f3dPreview(bytes)).toBeUndefined();
    expect(importF3d(bytes, 'Part').preview).toBeUndefined();
  });

  it('previewBytes reads the same entry f3dPreview does', () => {
    const picture = png(32);
    const entries = unzip(designZip({ [PREVIEW]: picture }));
    expect(previewBytes(entries)).toEqual(picture);
  });
});

describe('the importer shares its decode with the B-rep writer', () => {
  it('gives the same steps from the entries it already unzipped', () => {
    const bytes = designZip();
    const imported = importF3d(bytes, 'Part', { bodies: true });
    expect(imported.steps).toEqual(f3dBodiesStep(bytes));
    expect(imported.bodies).toEqual([]);
  });

  it('adds nothing without { bodies: true }', () => {
    const imported = importF3d(designZip(), 'Part');
    expect(imported.bodies).toBeUndefined();
    expect(imported.steps).toBeUndefined();
  });
});
