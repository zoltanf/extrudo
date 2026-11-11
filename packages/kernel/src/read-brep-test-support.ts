// Test support (no production code): B-rep text for the readBrep tests.

/**
 * A 10 × 20 × 30 mm box written by OCCT's B-rep writer, with the line some
 * programs put before the format line.
 */
export const BOX = `DBRep_DrawableShape

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

/** `BOX` with its first `from` replaced by `to` (which must be there). */
function damaged(from: string | RegExp, to: string): string {
  if (!(typeof from === 'string' ? BOX.includes(from) : from.test(BOX))) {
    throw new Error(`not in the box: ${from}`);
  }
  return BOX.replace(from, to);
}

/** A point in `count` compounds, each holding the one before. */
function nested(count: number): string {
  const total = count + 1;
  const lines = [
    'CASCADE Topology V1, (c) Matra-Datavision',
    'Locations 0',
    'Curve2ds 0',
    'Curves 0',
    'Polygon3D 0',
    'PolygonOnTriangulations 0',
    'Surfaces 0',
    'Triangulations 0',
    '',
    `TShapes ${total}`,
    'Ve',
    '1e-07',
    '0 0 0',
    '0 0',
    '',
    '0101101',
    '*',
  ];
  // A reference counts from the end of the table: the shape at position p
  // (from 1) is total - p + 1, so compound p holds total - p + 2.
  for (let p = 2; p <= total; p++) lines.push('Co', '', '1100000', `+${total - p + 2} 0 *`);
  lines.push('', '+1 0 ', '');
  return lines.join('\n');
}

/**
 * The box text damaged in the ways a third-party file could be (P6-25 S1,
 * ADR-0144 decision 5): each must end in a shape or a KernelError, quickly,
 * with nothing left behind.
 */
export function hostileBrepCases(): { name: string; text: string }[] {
  const cases: { name: string; text: string }[] = [];
  const sections = [
    'Locations',
    'Curve2ds',
    'Curves',
    'Polygon3D',
    'PolygonOnTriangulations',
    'Surfaces',
    'Triangulations',
    'TShapes',
  ];
  for (const section of sections) {
    cases.push({
      name: `cut off at ${section}`,
      text: BOX.slice(0, BOX.indexOf(`\n${section} `) + 1),
    });
    cases.push({
      name: `cut off after the ${section} header`,
      text: BOX.slice(0, BOX.indexOf(`\n${section} `) + section.length + 3),
    });
  }
  const tshapes = BOX.indexOf('TShapes 34');
  cases.push({
    name: 'cut off in the middle of TShapes',
    text: BOX.slice(0, Math.round((tshapes + BOX.length) / 2)),
  });
  cases.push({
    name: 'cut off before the root shape',
    text: BOX.slice(0, BOX.lastIndexOf('+1 0')),
  });
  for (const [section, count] of [
    ['Curve2ds', 24],
    ['Curves', 12],
    ['Surfaces', 6],
    ['TShapes', 34],
  ] as const) {
    for (const bad of ['-1', '-2147483648', '0', '2147483648', '1000000000']) {
      cases.push({
        name: `${section} count ${bad}`,
        text: damaged(`\n${section} ${count}\n`, `\n${section} ${bad}\n`),
      });
    }
  }
  cases.push({
    name: 'Locations count 2147483648',
    text: damaged('\nLocations 0\n', '\nLocations 2147483648\n'),
  });
  cases.push({ name: 'Locations count -1', text: damaged('\nLocations 0\n', '\nLocations -1\n') });
  // Indexes into the tables. The first edge is "1  1 0 0 30" (curve 1),
  // "2  1 1 0 0 30" (pcurve 1 on surface 1), the first face "0  1e-07 6 0"
  // (surface 6, location 0), the shell "+4 0" (shape 4, location 0).
  // Location 0 is "none", so its 0 is no damage.
  for (const [what, count] of [
    ['curve', 12],
    ['pcurve', 24],
    ['surface', 6],
    ['location', 0],
    ['sub-shape', 34],
  ] as const) {
    for (const index of ['0', String(count + 1), '1000000000', '-1']) {
      if (what === 'location' && index === '0') continue;
      const text =
        what === 'curve'
          ? damaged('\n1  1 0 0 30\n', `\n1  ${index} 0 0 30\n`)
          : what === 'pcurve'
            ? damaged('\n2  1 1 0 0 30\n', `\n2  ${index} 1 0 0 30\n`)
            : what === 'surface'
              ? damaged('\nFa\n0  1e-07 6 0\n', `\nFa\n0  1e-07 ${index} 0\n`)
              : what === 'location'
                ? damaged('\n+4 0 *\nSh\n', `\n+4 ${index} *\nSh\n`)
                : damaged('\n+4 0 *\nSh\n', `\n+${index} 0 *\nSh\n`);
      cases.push({ name: `${what} index ${index}`, text });
    }
  }
  cases.push({ name: 'root shape index 0', text: damaged(/\+1 0 $/, '+0 0 ') });
  cases.push({ name: 'root shape index 1000000000', text: damaged(/\+1 0 $/, '+1000000000 0 ') });
  cases.push({
    name: 'an unknown curve type',
    text: damaged('\nCurves 12\n1 ', '\nCurves 12\n99 '),
  });
  cases.push({
    name: 'an unknown pcurve type',
    text: damaged('\nCurve2ds 24\n1 ', '\nCurve2ds 24\n99 '),
  });
  cases.push({
    name: 'an unknown surface type',
    text: damaged('\nSurfaces 6\n1 ', '\nSurfaces 6\n99 '),
  });
  cases.push({
    name: 'an unknown shape type',
    text: damaged('\nTShapes 34\nVe\n', '\nTShapes 34\nXx\n'),
  });
  // The first curve as a B-spline: degree 1, two poles, two knots.
  const spline = (degree: string, poles: string, knots = '2') =>
    damaged(
      '\nCurves 12\n1 0 0 0 0 0 1 \n',
      `\nCurves 12\n7 0 0 ${degree} ${poles} ${knots} 0 0 0 0 0 30 0 2 30 2 \n`,
    );
  cases.push({ name: 'a valid B-spline curve', text: spline('1', '2') });
  cases.push({ name: 'a B-spline degree of 10^9', text: spline('1000000000', '2') });
  cases.push({ name: 'a B-spline pole count of 10^9', text: spline('1', '1000000000') });
  cases.push({ name: 'a B-spline knot count of 10^9', text: spline('1', '2', '1000000000') });
  cases.push({ name: 'a B-spline pole count of -1', text: spline('1', '-1') });
  for (const number of ['NaN', 'nan', 'inf', '-inf', '1e999', '-1e999']) {
    cases.push({
      name: `a vertex at ${number}`,
      text: damaged('\nVe\n1e-07\n0 0 30\n', `\nVe\n1e-07\n${number} 0 30\n`),
    });
    cases.push({
      name: `a curve through ${number}`,
      text: damaged('\nCurves 12\n1 0 0 0 ', `\nCurves 12\n1 ${number} 0 0 `),
    });
    cases.push({
      name: `a tolerance of ${number}`,
      text: damaged('\nFa\n0  1e-07 6 0\n', `\nFa\n0  ${number} 6 0\n`),
    });
  }
  const located = (locations: string) =>
    damaged('\nLocations 0\n', `\nLocations ${locations}`).replace(
      '\n+4 0 *\nSh\n',
      '\n+4 1 *\nSh\n',
    );
  cases.push({ name: 'a location that refers to itself', text: located('1\n2  1 1 0\n') });
  cases.push({
    name: 'a location that refers to a later one',
    text: located('2\n2  2 1 0\n2  1 1 0\n'),
  });
  cases.push({
    name: 'a location with a power of 10^9',
    text: located('2\n1\n1 0 0 1\n0 1 0 0\n0 0 1 0\n2  1 1000000000 0\n'),
  });
  cases.push({
    name: 'a location with a singular matrix',
    text: located('1\n1\n0 0 0 0\n0 0 0 0\n0 0 0 0\n'),
  });
  cases.push({ name: '1000 nested compounds', text: nested(1000) });
  cases.push({ name: '100000 nested compounds', text: nested(100_000) });
  return cases;
}
