/**
 * The ASM reader against hostile streams: a crafted `.f3d` must throw, not
 * loop forever or run out of memory (the security review's H1 and H2).
 */
import { describe, expect, it } from 'vitest';
import { asmFaces, readAsm } from './asm';
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
