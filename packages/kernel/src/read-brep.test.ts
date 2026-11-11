/**
 * `Kernel.readBrep`: OCCT's own B-rep text, read as stored. `BOX` is a
 * 10 × 20 × 30 mm box written by OCCT's B-rep writer, with the line some
 * programs put before the format line.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, KernelError } from './kernel';
import { loadOcct } from './occt/load';
import { BOX } from './read-brep-test-support';

let kernel: Kernel;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

describe('readBrep', () => {
  it('reads a box, with or without lines before the format line', () => {
    const bare = BOX.slice(BOX.indexOf('CASCADE Topology'));
    for (const text of [BOX, bare]) {
      using scope = kernel.scope();
      const shape = scope.track(kernel.readBrep(text));
      expect(kernel.isValid(shape)).toBe(true);
      const { volume, bbox } = kernel.measure(shape);
      expect(volume).toBeCloseTo(6000, 6);
      const { faces, edges } = kernel.describe(shape);
      expect(faces).toHaveLength(6);
      expect(edges).toHaveLength(12);
      [0, 0, 0, 10, 20, 30].forEach((v, i) => {
        expect([...bbox.min, ...bbox.max][i]).toBeCloseTo(v, 6);
      });
    }
  });

  it('keeps the order the text lists the faces in', () => {
    using scope = kernel.scope();
    const shape = scope.track(kernel.readBrep(BOX));
    // OCCT's box maker lists its faces as x min, x max, y min, y max, z min, z max.
    const centres = kernel.describe(shape).faces.map((f) => f.centroid.map((v) => Math.round(v)));
    expect(centres).toEqual([
      [0, 10, 15],
      [10, 10, 15],
      [5, 0, 15],
      [5, 20, 15],
      [5, 10, 0],
      [5, 10, 30],
    ]);
  });

  it('writes what it read as STEP', () => {
    using scope = kernel.scope();
    const shape = scope.track(kernel.readBrep(BOX));
    const back = scope.track(kernel.readStep(kernel.writeStep([{ shape, name: 'Box' }])));
    expect(kernel.measure(back).volume).toBeCloseTo(6000, 6);
  });

  /** One edge on the line through (`x`, 0, 0) along z, from `first` to `last`. */
  const lineEdge = (x: string, first: string, last: string) =>
    [
      'CASCADE Topology V1, (c) Matra-Datavision',
      'Locations 0',
      'Curve2ds 0',
      'Curves 1',
      `1 ${x} 0 0 0 0 1 `,
      'Polygon3D 0',
      'PolygonOnTriangulations 0',
      'Surfaces 0',
      'Triangulations 0',
      '',
      'TShapes 1',
      'Ed',
      ' 1e-07 1 1 0',
      `1  1 0 ${first} ${last}`,
      '0',
      '',
      '1101000',
      '*',
      '',
      '+1 0',
      '',
    ].join('\n');

  it('reads an unbounded line whose range is written out in full', () => {
    // ±2e100, as old writers print it: a hundred digits and fifteen decimals.
    const far = `${BigInt(2e100)}.000000000000000`;
    expect(far).toHaveLength(117);
    using scope = kernel.scope();
    const shape = scope.track(kernel.readBrep(lineEdge('0', `-${far}`, far)));
    const { faces, edges } = kernel.describe(shape);
    expect(faces).toHaveLength(0);
    expect(edges).toHaveLength(1);
  });

  it('leaves long runs of digits after a decimal point as they are', () => {
    // Eighteen decimals with a leading zero, as old writers print a coordinate
    // (read as an integer part it would lose that zero), and a length with
    // more digits than a double holds.
    using scope = kernel.scope();
    const shape = scope.track(
      kernel.readBrep(lineEdge('0.053768262192804533', '0', '3.000000000000000000001')),
    );
    const edge = kernel.describe(shape).edges[0];
    expect(edge?.midpoint[0]).toBeCloseTo(0.053768262192804533, 12);
    expect(edge?.midpoint[2]).toBeCloseTo(1.5, 12);
    expect(edge?.length).toBeCloseTo(3, 12);
  });

  it('refuses text that is not a B-rep, and leaves no shape behind', () => {
    const before = kernel.stats().liveShapes;
    for (const text of ['', 'hello', 'CASCADE Topology V1, (c) Matra-Datavision\nLocations 0\n']) {
      expect(() => kernel.readBrep(text)).toThrow(KernelError);
    }
    expect(kernel.stats().liveShapes).toBe(before);
  });
});
