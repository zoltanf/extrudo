/**
 * The ASM reader against hostile streams: a crafted `.f3d` must throw, not
 * loop forever or run out of memory (the security review's H1 and H2).
 */
import { describe, expect, it } from 'vitest';
import { asmFaces, asmFaceTags, readAsm } from './asm';
import { F3dFormatError } from './bytes';

const enc = new TextEncoder();

function i64(v: bigint | number): number[] {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigInt64(0, BigInt(v), true);
  return [...b];
}
/** tag 0x07: a 1-byte-length ASCII string. */
function str7(s: string): number[] {
  const b = [...enc.encode(s)];
  return [0x07, b.length, ...b];
}
/** tag 0x0d: a class name. */
function className(s: string): number[] {
  const b = [...enc.encode(s)];
  return [0x0d, b.length, ...b];
}
/** tag 0x04: an 8-byte integer. */
function int(v: bigint | number): number[] {
  return [0x04, ...i64(v)];
}
/** tag 0x0c: a record pointer. */
function ptr(v: bigint | number): number[] {
  return [0x0c, ...i64(v)];
}
/** The 15-byte magic, 32 bytes of count/flags and six 0x06 + 8-byte header words. */
function header(): number[] {
  return [
    ...enc.encode('ASM BinaryFile8'),
    ...new Array<number>(32).fill(0),
    ...new Array<number>(6).fill(0).flatMap(() => [0x06, ...new Array<number>(8).fill(0)]),
  ];
}
function stream(...records: number[][]): Uint8Array {
  return new Uint8Array([...header(), ...records.flat()]);
}

describe('readAsm', () => {
  it('rejects a negative string length instead of looping forever', () => {
    // The review's trigger: tag 09 with length -9 walked the cursor back onto
    // the same tag, so the reader never advanced.
    const bytes = stream([0x09, ...i64(-9)], [0x11]);
    expect(() => readAsm(bytes)).toThrow(F3dFormatError);
  });

  it('rejects a string length past the end of the stream', () => {
    const bytes = stream([0x09, ...i64(1000)], [0x11]);
    expect(() => readAsm(bytes)).toThrow(F3dFormatError);
    const bytes12 = stream([0x12, ...i64(0x7fffffff)], [0x11]);
    expect(() => readAsm(bytes12)).toThrow(F3dFormatError);
  });

  it('keeps the class names inside a subtype block as values, in place', () => {
    // intcurve-curve, sense, { exact_int_cur 7 nubs 3 }: the names inside the
    // brackets are the block's layout; the record's own class stays first.
    const bytes = stream([
      ...className('intcurve-curve'),
      0x0b,
      0x0f,
      ...className('exact_int_cur'),
      ...int(7),
      ...className('nubs'),
      ...int(3),
      0x10,
      0x11,
    ]);
    const [r] = readAsm(bytes);
    expect(r?.derived).toBe('intcurve-curve');
    expect(r?.values).toEqual([
      { t: 'bool', v: false },
      { t: 'open' },
      { t: 'name', v: 'exact_int_cur' },
      { t: 'int', v: 7 },
      { t: 'name', v: 'nubs' },
      { t: 'int', v: 3 },
      { t: 'close' },
    ]);
  });

  it('rejects a fixed-width value that runs off the end', () => {
    const bytes = new Uint8Array([...header(), 0x13, 0x00]);
    expect(() => readAsm(bytes)).toThrow(F3dFormatError);
  });
});

describe('asmFaces tags', () => {
  /** A face record (index 0) whose attribute chain points at record 1. */
  const face = [...className('face'), ...ptr(1), 0x11];

  it('refuses a tag count larger than the values that are left', () => {
    // The review's trigger: n = 1e10 pushed NaN entries until the heap died.
    const attrib = [
      ...className('ATTRIB_CUSTOM-attrib'),
      ...str7('generic_tag_attrib_def '),
      ...int(1), // groups
      ...int(0), // selector
      ...str7('tok'),
      ...int(0),
      ...int(10_000_000_000), // references
      0x11,
    ];
    const records = readAsm(stream(face, attrib));
    expect(() => asmFaces(records)).toThrow(F3dFormatError);
  });

  it('still reads a well-formed tag attrib', () => {
    const attrib = [
      ...className('ATTRIB_CUSTOM-attrib'),
      ...str7('generic_tag_attrib_def '),
      ...int(1),
      ...int(0),
      ...str7('tok'),
      ...int(0),
      ...int(1),
      ...int(5),
      0x11,
    ];
    const records = readAsm(stream(face, attrib));
    expect(asmFaces(records)[0]?.tags).toEqual([{ token: 'tok', design: 5 }]);
  });
});

describe('asmFaces edges', () => {
  /** tag 0x13: a position (three doubles). */
  const pos = (x: number, y: number, z: number): number[] => {
    const b = new Uint8Array(24);
    const v = new DataView(b.buffer);
    for (const [i, c] of [x, y, z].entries()) v.setFloat64(i * 8, c, true);
    return [0x13, ...b];
  };
  const record = (type: string, ...values: number[][]) => [
    ...className(type),
    ...values.flat(),
    0x11,
  ];
  const tag = (token: string, design: number) =>
    record(
      'ATTRIB_CUSTOM-attrib',
      ptr(-1),
      ptr(-1),
      str7('generic_tag_attrib_def '),
      int(1),
      int(0),
      str7(token),
      int(0),
      int(1),
      int(design),
    );
  /**
   * Two faces sharing one straight edge: 0, 1 faces; 2, 3 loops; 4, 5
   * coedges (each its own next and previous, the other's partner); 6 the
   * edge; 7, 8 vertices; 9, 10 points; 11 the curve; 12, 13 tags; 14 a surface.
   */
  const twoFaces = (coedgeB = ptr(5)) =>
    readAsm(
      stream(
        record('face', ptr(12), int(0), ptr(-1), ptr(-1), ptr(2), ptr(-1), ptr(-1), ptr(14)),
        record('face', ptr(13), int(0), ptr(-1), ptr(-1), ptr(3), ptr(-1), ptr(-1), ptr(14)),
        record('loop', ptr(-1), int(-1), ptr(-1), ptr(-1), ptr(4), ptr(0)),
        record('loop', ptr(-1), int(-1), ptr(-1), ptr(-1), coedgeB, ptr(1)),
        record('coedge', ptr(-1), int(-1), ptr(-1), ptr(4), ptr(4), ptr(5), ptr(6), ptr(2)),
        record('coedge', ptr(-1), int(-1), ptr(-1), ptr(5), ptr(5), ptr(4), ptr(6), ptr(3)),
        record('edge', ptr(-1), int(-1), ptr(-1), ptr(7), ptr(8), ptr(4), ptr(11)),
        record('vertex', ptr(-1), int(-1), ptr(-1), ptr(6), ptr(9)),
        record('vertex', ptr(-1), int(-1), ptr(-1), ptr(6), ptr(10)),
        record('point', ptr(-1), int(-1), ptr(-1), pos(0, 0, 0)),
        record('point', ptr(-1), int(-1), ptr(-1), pos(4, 0, 0)),
        record('straight-curve', ptr(-1), int(-1), ptr(-1), pos(0, 0, 0), pos(1, 0, 0)),
        tag('a', 7),
        tag('b', 8),
        record('plane-surface', ptr(-1), int(-1), ptr(-1), pos(0, 0, 0), pos(0, 0, 1)),
      ),
    );

  it('reads each edge with its curve, its vertices and the tags across it', () => {
    const [a, b] = asmFaces(twoFaces());
    expect(a?.edges).toEqual([
      {
        curve: { kind: 'line', point: [0, 0, 0], direction: [1, 0, 0] },
        points: [
          [0, 0, 0],
          [4, 0, 0],
        ],
        across: [{ token: 'b', design: 8 }],
      },
    ]);
    expect(b?.edges[0]?.across).toEqual([{ token: 'a', design: 7 }]);
  });

  it('walks a coedge cycle that never comes back to its start once', () => {
    // Loop 3 starts at coedge 4, whose next (itself) never returns to 5... walked once each.
    const faces = asmFaces(twoFaces(ptr(4)));
    expect(faces[1]?.edges).toHaveLength(1);
  });
});

describe('readAsm memory', () => {
  const MB = 1024 * 1024;
  /** A stream of one record whose body is `n` copies of `value`. */
  const flood = (value: number[], n: number) => {
    const head = [...header(), ...className('a')];
    const out = new Uint8Array(head.length + value.length * n + 1);
    out.set(head);
    for (let i = 0, at = head.length; i < n; i++, at += value.length) out.set(value, at);
    out[out.length - 1] = 0x11;
    return out;
  };

  it('refuses a flood of one-byte values quickly, before it builds an array per byte', () => {
    // 16 MB of `true` became 0.8 GB of heap before the cap.
    const t = performance.now();
    expect(() => readAsm(flood([0x0a], 8 * MB))).toThrow(/more than .* values/);
    expect(performance.now() - t).toBeLessThan(1000);
  });

  it('refuses records that carry no class, or more records than the bytes allow', () => {
    expect(() => readAsm(stream([0x0a, 0x11]))).toThrow(/without a class/);
    const tiny = [...className('a'), 0x11];
    expect(() => readAsm(stream(...new Array<number[]>(1000).fill(tiny)))).toThrow(
      /more than .* records/,
    );
  });

  it('keeps a stream of small values within a small multiple of its size', () => {
    // Under the cap the dearest values are short strings and floats, an
    // object each (the files' streams cost about 6.5 times their size).
    for (const value of [
      [0x07, 2, 0x41, 0x42],
      [0x05, 0, 0, 0x80, 0x3f],
    ]) {
      const bytes = flood(value, Math.floor((4 * MB) / value.length));
      const t = performance.now();
      const before = process.memoryUsage().heapUsed;
      const records = readAsm(bytes);
      const grown = process.memoryUsage().heapUsed - before;
      expect(records[0]?.values.length).toBeGreaterThan(MB / 2);
      // About 18 measured after a collection; without one the figure includes
      // the values array's discarded growth steps.
      expect(grown / bytes.length).toBeLessThan(40);
      expect(performance.now() - t).toBeLessThan(3000);
    }
  });

  it('shares one object for each one-byte value', () => {
    const values = readAsm(stream([...className('a'), 0x0a, 0x0b, 0x02, 3, 0x0a, 0x02, 3, 0x11]))[0]
      ?.values;
    expect(values?.[0]).toBe(values?.[3]);
    expect(values?.[2]).toBe(values?.[4]);
    expect(values).toEqual([
      { t: 'bool', v: true },
      { t: 'bool', v: false },
      { t: 'int', v: 3 },
      { t: 'bool', v: true },
      { t: 'int', v: 3 },
    ]);
  });
});

describe('asmFaces on shared records', () => {
  const rec = (type: string, ...values: number[][]) => [...className(type), ...values.flat(), 0x11];
  /**
   * `faces` faces, each with its own attribute that leads to one shared tag
   * attribute of `tags` references whose next attribute is itself.
   */
  const sharedTags = (faces: number, tags: number, sameStart = false) => {
    const shared = 2 * faces;
    const out: number[][] = [];
    for (let i = 0; i < faces; i++) out.push(rec('face', ptr(sameStart ? faces : faces + i)));
    for (let i = 0; i < faces; i++) out.push(rec('attrib', ptr(-1), ptr(shared)));
    out.push(
      rec(
        'ATTRIB_CUSTOM-attrib',
        ptr(-1),
        ptr(shared),
        str7('generic_tag_attrib_def '),
        int(1),
        int(0),
        str7('tok'),
        int(0),
        int(tags),
        ...Array.from({ length: tags }, (_, k) => int(k)),
      ),
    );
    return readAsm(stream(...out));
  };

  it('follows a looping attribute chain once per attribute', () => {
    // 500 faces × 63 hops round a 2,000-tag attribute copied 63 million tags.
    const t = performance.now();
    const faces = asmFaces(sharedTags(500, 2000));
    expect(performance.now() - t).toBeLessThan(1000);
    expect(faces).toHaveLength(500);
    expect(faces[499]?.tags).toHaveLength(2000);
  });

  it('shares the tags of faces whose chains start at one attribute', () => {
    const records = sharedTags(3, 5, true);
    expect(asmFaceTags(records, 2)).toBe(asmFaceTags(records, 0));
  });

  it('refuses a stream whose faces would copy far more tags than it holds', () => {
    const t = performance.now();
    expect(() => asmFaces(sharedTags(2000, 4000))).toThrow(/share more tags/);
    expect(performance.now() - t).toBeLessThan(1000);
  });

  it('refuses a stream whose faces would walk one long loop each', () => {
    // 3,000 faces on one loop of 3,000 coedges: 9 million steps.
    const n = 3000;
    const LOOP = n;
    const out: number[][] = [];
    for (let i = 0; i < n; i++)
      out.push(rec('face', ptr(-1), int(0), ptr(-1), ptr(-1), ptr(LOOP), ptr(-1), ptr(-1)));
    out.push(rec('loop', ptr(-1), int(-1), ptr(-1), ptr(-1), ptr(LOOP + 1), ptr(0)));
    for (let k = 0; k < n; k++)
      out.push(
        rec(
          'coedge',
          ptr(-1),
          int(-1),
          ptr(-1),
          ptr(LOOP + 1 + ((k + 1) % n)),
          ptr(LOOP + 1 + ((k + n - 1) % n)),
          ptr(-1),
          ptr(-1),
          ptr(LOOP),
        ),
      );
    const records = readAsm(stream(...out));
    const t = performance.now();
    expect(() => asmFaces(records)).toThrow(/share more loops/);
    expect(performance.now() - t).toBeLessThan(1000);
  });
});
