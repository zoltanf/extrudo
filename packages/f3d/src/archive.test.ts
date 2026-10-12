/**
 * The ZIP reader against hostile archives (H3, L1) and the preview a single
 * `importF3d` call now returns (M2). The bodies here are hand-built ZIP bytes
 * so an entry's declared size and local header can be lied about the way a
 * crafted file would.
 */
import { deflateSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { MAX_ENTRIES, MAX_ENTRY_BYTES, MAX_TOTAL_BYTES, previewBytes, unzip } from './archive';
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

  it('bounds a deflated entry to its declared size', () => {
    // A 1000-byte payload that lies and declares 100: the out buffer truncates
    // it, which is what stops a decompression bomb.
    const payload = new Uint8Array(1000).fill(65);
    const bytes = rawZip([{ name: META, data: deflateSync(payload), declaredSize: 100 }]);
    const content = unzip(bytes).get(META);
    expect(content?.length).toBe(100);
    expect(content?.[0]).toBe(65);
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
    const bytes = designZip({ [PREVIEW]: png(1024 * 1024 + 1) });
    expect(f3dPreview(bytes)).toBeUndefined();
    expect(importF3d(bytes, 'Part').preview).toBeUndefined();
  });

  it('previewBytes reads the same entry f3dPreview does', () => {
    const picture = png(32);
    const entries = unzip(designZip({ [PREVIEW]: picture }));
    expect(previewBytes(entries)).toEqual(picture);
  });
});
