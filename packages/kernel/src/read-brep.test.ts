/**
 * `Kernel.readBrep`: OCCT's own B-rep text, read as stored. The text below is a
 * 10 × 20 × 30 mm box written by OCCT's B-rep writer, with the line some
 * programs put before the format line.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, KernelError } from './kernel';
import { loadOcct } from './occt/load';

let kernel: Kernel;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

const BOX = `DBRep_DrawableShape

CASCADE Topology V1, (c) Matra-Datavision
Locations 0
Curve2ds 24
1 0 0 1 0 
1 0 0 1 0 
1 30 0 0 -1 
1 0 0 0 1 
1 0 -20 1 0 
1 0 0 1 0 
1 0 0 0 -1 
1 0 0 0 1 
1 0 0 1 0 
1 0 10 1 0 
1 30 0 0 -1 
1 10 0 0 1 
1 0 -20 1 0 
1 0 10 1 0 
1 0 0 0 -1 
1 10 0 0 1 
1 0 0 0 1 
1 0 0 1 0 
1 30 0 0 1 
1 0 0 1 0 
1 0 0 0 1 
1 0 20 1 0 
1 30 0 0 1 
1 0 20 1 0 
Curves 12
1 0 0 0 0 0 1 
1 0 0 30 -0 1 0 
1 0 20 0 0 0 1 
1 0 0 0 -0 1 0 
1 10 0 0 0 0 1 
1 10 0 30 -0 1 0 
1 10 20 0 0 0 1 
1 10 0 0 -0 1 0 
1 0 0 0 1 0 -0 
1 0 0 30 1 0 -0 
1 0 20 0 1 0 -0 
1 0 20 30 1 0 -0 
Polygon3D 0
PolygonOnTriangulations 0
Surfaces 6
1 0 0 0 1 0 -0 0 0 1 0 -1 0 
1 0 0 0 -0 1 0 0 0 1 1 0 -0 
1 0 0 30 0 0 1 1 0 -0 -0 1 0 
1 0 20 0 -0 1 0 0 0 1 1 0 -0 
1 0 0 0 0 0 1 1 0 -0 -0 1 0 
1 10 0 0 1 0 -0 0 0 1 0 -1 0 
Triangulations 0

TShapes 34
Ve
1e-07
0 0 30
0 0

0101101
*
Ve
1e-07
0 0 0
0 0

0101101
*
Ed
 1e-07 1 1 0
1  1 0 0 30
2  1 1 0 0 30
2  2 2 0 0 30
0

0101000
-34 0 +33 0 *
Ve
1e-07
0 20 30
0 0

0101101
*
Ed
 1e-07 1 1 0
1  2 0 0 20
2  3 1 0 0 20
2  4 3 0 0 20
0

0101000
-31 0 +34 0 *
Ve
1e-07
0 20 0
0 0

0101101
*
Ed
 1e-07 1 1 0
1  3 0 0 30
2  5 1 0 0 30
2  6 4 0 0 30
0

0101000
-31 0 +29 0 *
Ed
 1e-07 1 1 0
1  4 0 0 20
2  7 1 0 0 20
2  8 5 0 0 20
0

0101000
-29 0 +33 0 *
Wi

0101100
-32 0 -30 0 +28 0 +27 0 *
Fa
0  1e-07 1 0

0111000
+26 0 *
Ve
1e-07
10 0 30
0 0

0101101
*
Ve
1e-07
10 0 0
0 0

0101101
*
Ed
 1e-07 1 1 0
1  5 0 0 30
2  9 6 0 0 30
2  10 2 0 0 30
0

0101000
-24 0 +23 0 *
Ve
1e-07
10 20 30
0 0

0101101
*
Ed
 1e-07 1 1 0
1  6 0 0 20
2  11 6 0 0 20
2  12 3 0 0 20
0

0101000
-21 0 +24 0 *
Ve
1e-07
10 20 0
0 0

0101101
*
Ed
 1e-07 1 1 0
1  7 0 0 30
2  13 6 0 0 30
2  14 4 0 0 30
0

0101000
-21 0 +19 0 *
Ed
 1e-07 1 1 0
1  8 0 0 20
2  15 6 0 0 20
2  16 5 0 0 20
0

0101000
-19 0 +23 0 *
Wi

0101100
-22 0 -20 0 +18 0 +17 0 *
Fa
0  1e-07 6 0

0111000
+16 0 *
Ed
 1e-07 1 1 0
1  9 0 0 10
2  17 2 0 0 10
2  18 5 0 0 10
0

0101000
-23 0 +33 0 *
Ed
 1e-07 1 1 0
1  10 0 0 10
2  19 2 0 0 10
2  20 3 0 0 10
0

0101000
-24 0 +34 0 *
Wi

0101100
-14 0 -22 0 +13 0 +32 0 *
Fa
0  1e-07 2 0

0111000
+12 0 *
Ed
 1e-07 1 1 0
1  11 0 0 10
2  21 4 0 0 10
2  22 5 0 0 10
0

0101000
-19 0 +29 0 *
Ed
 1e-07 1 1 0
1  12 0 0 10
2  23 4 0 0 10
2  24 3 0 0 10
0

0101000
-21 0 +31 0 *
Wi

0101100
-10 0 -18 0 +9 0 +28 0 *
Fa
0  1e-07 4 0

0111000
+8 0 *
Wi

0101100
-27 0 -10 0 +17 0 +14 0 *
Fa
0  1e-07 5 0

0111000
+6 0 *
Wi

0101100
-30 0 -9 0 +20 0 +13 0 *
Fa
0  1e-07 3 0

0111000
+4 0 *
Sh

0101100
-25 0 +15 0 -11 0 +7 0 -5 0 +3 0 *
So

1100000
+2 0 *

+1 0 `;

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

  it('reads an unbounded line whose range is written out in full', () => {
    // ±2e100, as old writers print it: a hundred digits and fifteen decimals.
    const far = `${BigInt(2e100)}.000000000000000`;
    expect(far).toHaveLength(117);
    const line = [
      'CASCADE Topology V1, (c) Matra-Datavision',
      'Locations 0',
      'Curve2ds 0',
      'Curves 1',
      '1 0 0 0 0 0 1 ',
      'Polygon3D 0',
      'PolygonOnTriangulations 0',
      'Surfaces 0',
      'Triangulations 0',
      '',
      'TShapes 1',
      'Ed',
      ' 1e-07 1 1 0',
      `1  1 0 -${far} ${far}`,
      '0',
      '',
      '1101000',
      '*',
      '',
      '+1 0',
      '',
    ].join('\n');
    using scope = kernel.scope();
    const shape = scope.track(kernel.readBrep(line));
    const { faces, edges } = kernel.describe(shape);
    expect(faces).toHaveLength(0);
    expect(edges).toHaveLength(1);
  });

  it('refuses text that is not a B-rep, and leaves no shape behind', () => {
    const before = kernel.stats().liveShapes;
    for (const text of ['', 'hello', 'CASCADE Topology V1, (c) Matra-Datavision\nLocations 0\n']) {
      expect(() => kernel.readBrep(text)).toThrow(KernelError);
    }
    expect(kernel.stats().liveShapes).toBe(before);
  });
});
