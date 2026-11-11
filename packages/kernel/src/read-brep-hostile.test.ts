/**
 * `Kernel.readBrep` on text nobody checked (P6-25 S1, ADR-0144 decision 5 and
 * its S1 amendment): the box of `read-brep.test.ts` damaged in the ways a
 * third-party file could be. Each must end in a shape or a `KernelError`
 * within a few seconds, leave no shape behind and leave the kernel able to
 * read the good box next.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, KernelError, MAX_BREP_BYTES, type ShapeHandle } from './kernel';
import { loadOcct } from './occt/load';
import { BOX, hostileBrepCases } from './read-brep-test-support';

let kernel: Kernel;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

/**
 * The cases nothing short of a second B-rep parser stops: OCCT sizes a
 * B-spline's pole array from the count in its record before it reads a pole,
 * and the poles it then reads go past the array (probably because the byte
 * size wraps in 32 bits; not verified). Only a reader of every curve and surface record knows which number
 * is such a count. The import's throwaway kernel and its time budget
 * (ADR-0144) are what bound them. (A knot count of 10^9 is stopped: the first
 * read past the text throws before the array is written.)
 */
const UNSTOPPED = new Set(['a B-spline pole count of 10^9', 'a B-spline pole count of -1']);

/** Reads `text`; a shape comes back after a check and a count, released. */
function readOrRefuse(text: string): 'shape' | 'refused' {
  let shape: ShapeHandle | undefined;
  try {
    shape = kernel.readBrep(text);
  } catch (error) {
    expect(error).toBeInstanceOf(KernelError);
    return 'refused';
  }
  try {
    kernel.isValid(shape);
    kernel.count(shape, 'face');
  } finally {
    kernel.release(shape);
  }
  return 'shape';
}

describe('readBrep on damaged text', () => {
  for (const { name, text } of hostileBrepCases()) {
    (UNSTOPPED.has(name) ? it.skip : it)(name, () => {
      const before = kernel.stats().liveShapes;
      const start = performance.now();
      readOrRefuse(text);
      expect(performance.now() - start).toBeLessThan(5000);
      expect(kernel.stats().liveShapes).toBe(before);
      expect(readOrRefuse(BOX)).toBe('shape');
      expect(kernel.stats().liveShapes).toBe(before);
    });
  }

  it('refuses text over the size limit before reading it', () => {
    for (const text of [
      `${BOX}${' '.repeat(MAX_BREP_BYTES)}`,
      // Fewer characters than the limit, more UTF-8 bytes.
      `${BOX}${'é'.repeat(MAX_BREP_BYTES / 2)}`,
    ]) {
      const start = performance.now();
      expect(() => kernel.readBrep(text)).toThrow(/too large/);
      expect(performance.now() - start).toBeLessThan(2000);
    }
    expect(readOrRefuse(BOX)).toBe('shape');
  });

  it('refuses what the scan finds before OCCT sees it', () => {
    const refusal = (text: string) => {
      try {
        kernel.release(kernel.readBrep(text));
      } catch (error) {
        return (error as Error).message;
      }
      return 'read';
    };
    expect(refusal(BOX.replace('\nCurves 12\n', '\nCurves 1000000000\n'))).toMatch(
      /Curves table's count/,
    );
    expect(refusal(BOX.replace('\nVe\n1e-07\n0 0 30\n', '\nVe\n1e-07\nNaN 0 30\n'))).toMatch(
      /not finite/,
    );
    expect(refusal(BOX.replace('\nVe\n1e-07\n0 0 30\n', '\nVe\n1e-07\n1e999 0 30\n'))).toMatch(
      /not finite/,
    );
    expect(refusal(BOX.replace('\n+4 0 *\nSh\n', `\n+4 0 ${'x'.repeat(300)} *\nSh\n`))).toMatch(
      /over 200 characters/,
    );
    // Big but finite numbers and the format line's own words pass the scan.
    expect(refusal(BOX.replace('\nVe\n1e-07\n0 0 30\n', '\nVe\n1e-07\n0 0 30.000e+0\n'))).toBe(
      'read',
    );
  });
});
