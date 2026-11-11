/**
 * The STEP writer keeps the solid of a shape whose root carries a location
 * (ADR-0034's fourth amendment, P6-25 S1). The three texts are B-rep shapes
 * we made with our own FreeCAD scripts: a disc extruded 100 mm (its face
 * located, its cylinder on an indirect frame with a seam), the same kind of
 * prism with an identity location on the solid, and one placed by a
 * translation and a quarter turn. Before the fix the last two came back from
 * STEP as faces with no solid.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type ShapeHandle } from './kernel';
import { loadOcct } from './occt/load';
import { badEdgeUses } from './step-test-support';

let kernel: Kernel;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

const LOCATED_FACE = `DBRep_DrawableShape

CASCADE Topology V1, (c) Matra-Datavision
Locations 7
1
             -1 -1.22464679914735e-16               0          -59.16 
1.22464679914735e-16              -1               0           59.16 
              0               0               1               0 
1
              1               0               0               0 
              0               1               0               0 
              0               0               1             100 
2  1 1 2 1 0
2  1 -1 0
2  2 -1 1 -1 0
1
              1               0               0               0 
              0               1               0               0 
              0               0               1             100 
2  6 -1 1 -1 0
Curve2ds 6
1 0 0 0 -1 
1 6.2831853071795862 0 0 -1 
1 0 0 1 0 
1 0 -100 1 0 
1 0 0 1 0 
1 0 -100 1 0 
Curves 2
1 -69.159999999999997 59.159999999999997 0 0 0 1 
2 0 0 0 0 0 1 1 0 -0 -0 1 0 10
Polygon3D 0
PolygonOnTriangulations 0
Surfaces 3
2 -59.159999999999997 59.159999999999997 0 -0 -0 -1 -1 1.2246467991473532e-16 0 -1.2246467991473532e-16 -1 0 10
2 -59.159999999999997 59.159999999999997 0 -0 -0 -1 -1 1.2246467991473532e-16 0 -1.2246467991473532e-16 -1 0 10
1 -5.4697605301576938e-16 6.8573650631575423e-16 0 0 0 1 1 0 -0 -0 1 0 
Triangulations 0

TShapes 9
Ve
1e-07
10 0 0
0 0

0101101
*
Ed
 1e-07 1 1 0
1  1 0 0 100
3  1 2CN 1 0 0 100
0

0101000
+9 1 -9 3 *
Ed
 1e-07 1 1 0
1  2 0 0 6.28318530717959
2  3 1 4 0 6.28318530717959
2  4 1 5 0 6.28318530717959
2  5 2 4 0 6.28318530717959
2  6 2 7 0 6.28318530717959
0

0101100
+9 0 -9 0 *
Wi

0101100
+8 0 -8 0 -7 1 +7 3 *
Fa
0  1e-07 1 0

0101000
+6 0 *
Wi

0101100
+7 0 *
Fa
0  1e-07 3 0

0101000
+4 0 *
Sh

0101100
+5 0 +3 1 -3 3 *
So

1100000
-2 0 *

+1 0 `;

const IDENTITY_MOVED = `DBRep_DrawableShape

CASCADE Topology V1, (c) Matra-Datavision
Locations 6
1
              1               0               0               0 
              0               1               0               0 
              0               0               1               0 
1
             -1 -1.22464679914735e-16               0          -59.16 
1.22464679914735e-16              -1               0           59.16 
              0               0               1               0 
2  2 -1 0
1
              1               0               0               0 
              0               1               0               0 
              0               0               1             100 
2  2 1 4 1 0
2  4 -1 2 -1 0
Curve2ds 6
1 0 0 0 -1 
1 6.2831853071795862 0 0 -1 
1 0 0 1 0 
2 -1.4210854715202004e-14 1.4210854715202004e-14 -1 1.2246467991473532e-16 -1.2246467991473532e-16 -1 10
1 0 -100 1 0 
2 -1.4210854715202004e-14 1.4210854715202004e-14 -1 1.2246467991473532e-16 -1.2246467991473532e-16 -1 10
Curves 3
1 -69.159999999999997 59.159999999999997 0 0 0 1 
2 0 0 0 0 0 1 1 0 -0 -0 1 0 10
2 0 0 0 0 0 1 1 0 -0 -0 1 0 10
Polygon3D 0
PolygonOnTriangulations 0
Surfaces 3
2 -59.159999999999997 59.159999999999997 0 -0 -0 -1 -1 1.2246467991473532e-16 0 -1.2246467991473532e-16 -1 0 10
1 -59.159999999999982 59.159999999999982 0 0 0 1 1 0 -0 -0 1 0 
1 -59.159999999999982 59.159999999999982 0 0 0 1 1 0 -0 -0 1 0 
Triangulations 0

TShapes 13
Ve
1e-07
-69.16 59.16 0
0 0

0101101
*
Ve
1e-07
-69.16 59.16 100
0 0

0101101
*
Ed
 1e-07 1 1 0
1  1 0 0 100
3  1 2CN 1 0 0 100
0

0101000
+13 0 -12 0 *
Ed
 1e-07 1 1 0
1  2 0 0 6.28318530717959
2  3 1 3 0 6.28318530717959
2  4 2 3 0 6.28318530717959
0

0101100
+13 3 -13 3 *
Ed
 1e-07 1 1 0
1  3 0 0 6.28318530717959
2  5 1 6 0 6.28318530717959
2  6 3 3 0 6.28318530717959
0

0101100
+12 6 -12 6 *
Wi

0101100
+11 0 -11 0 -10 2 +9 5 *
Fa
0  1e-07 1 0

0101000
+8 0 *
Wi

0101100
+10 2 *
Fa
0  1e-07 2 0

0101000
+6 0 *
Wi

0101100
+9 2 *
Fa
0  1e-07 3 0

0101000
+4 0 *
Sh

0101100
+7 0 +5 0 -3 4 *
So

1100000
-2 0 *

+1 1 `;

const LOCATED_FACE_PLACED = `DBRep_DrawableShape

CASCADE Topology V1, (c) Matra-Datavision
Locations 8
1
2.22044604925031e-16              -1               0               0 
              1 2.22044604925031e-16               0           59.16 
              0               0               1               0 
1
             -1 -1.22464679914735e-16               0          -59.16 
1.22464679914735e-16              -1               0           59.16 
              0               0               1               0 
1
              1               0               0               0 
              0               1               0               0 
              0               0               1             100 
2  2 1 3 1 0
2  2 -1 0
1
              1               0               0               0 
              0               1               0               0 
              0               0               1             100 
2  6 -1 2 -1 0
2  3 -1 2 -1 0
Curve2ds 6
1 0 0 0 -1 
1 6.2831853071795862 0 0 -1 
1 0 0 1 0 
1 0 -100 1 0 
1 0 0 1 0 
1 0 -100 1 0 
Curves 2
1 -69.159999999999997 59.159999999999997 0 0 0 1 
2 0 0 0 0 0 1 1 0 -0 -0 1 0 10
Polygon3D 0
PolygonOnTriangulations 0
Surfaces 3
2 -59.159999999999997 59.159999999999997 0 -0 -0 -1 -1 1.2246467991473532e-16 0 -1.2246467991473532e-16 -1 0 10
2 -59.159999999999997 59.159999999999997 0 -0 -0 -1 -1 1.2246467991473532e-16 0 -1.2246467991473532e-16 -1 0 10
1 -5.4697605301576938e-16 6.8573650631575423e-16 0 0 0 1 1 0 -0 -0 1 0 
Triangulations 0

TShapes 9
Ve
1e-07
10 0 0
0 0

0101101
*
Ed
 1e-07 1 1 0
1  1 0 0 100
3  1 2CN 1 0 0 100
0

0101000
+9 2 -9 4 *
Ed
 1e-07 1 1 0
1  2 0 0 6.28318530717959
2  3 2 5 0 6.28318530717959
2  4 2 7 0 6.28318530717959
2  5 1 5 0 6.28318530717959
2  6 1 8 0 6.28318530717959
0

0101100
+9 0 -9 0 *
Wi

0101100
+8 0 -8 0 -7 2 +7 4 *
Fa
0  1e-07 1 0

0101000
+6 0 *
Wi

0101100
+7 0 *
Fa
0  1e-07 3 0

0101000
+4 0 *
Sh

0101100
+5 0 +3 2 -3 4 *
So

1100000
-2 0 *

+1 1 `;

const SHAPES = {
  'a disc prism with a located face': LOCATED_FACE,
  'a prism whose solid carries an identity location': IDENTITY_MOVED,
  'a prism of a located face, the solid placed': LOCATED_FACE_PLACED,
};

/** Writes `shape` as STEP (plain, with a colour, and as an assembly part) and checks each file. */
function expectSameThroughStep(shape: ShapeHandle): void {
  using scope = kernel.scope();
  const volume = kernel.measure(shape).volume;
  const faces = kernel.describe(shape).faces.map((f) => f.centroid);
  const files = [
    kernel.writeStep([{ shape, name: 'Body' }]),
    kernel.writeStep([{ shape, name: 'Body', color: '#1080ff' }]),
    kernel.writeStep([{ shape, name: 'Body', group: 0 }], ['Group']),
  ];
  for (const text of files) {
    expect(badEdgeUses(text)).toEqual([]);
    const back = scope.track(kernel.readStep(text));
    const solids = kernel.solids(back);
    for (const s of solids) scope.track(s);
    expect(solids).toHaveLength(1);
    expect(kernel.isValid(back)).toBe(true);
    expect(Math.abs(kernel.measure(back).volume - volume)).toBeLessThan(1e-6 * volume);
    const after = kernel.describe(back).faces.map((f) => f.centroid);
    expect(after).toHaveLength(faces.length);
    after.forEach((c, i) => {
      c.forEach((v, j) => {
        expect(v).toBeCloseTo(faces[i]?.[j] as number, 6);
      });
    });
  }
}

describe('writeStep of located shapes', () => {
  for (const [what, text] of Object.entries(SHAPES)) {
    it(`keeps the solid of ${what}`, () => {
      using scope = kernel.scope();
      const shape = scope.track(kernel.readBrep(text));
      expect(kernel.solids(shape).map((s) => scope.track(s))).toHaveLength(1);
      expectSameThroughStep(shape);
    });
  }
});
