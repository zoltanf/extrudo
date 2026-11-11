// The two-page sample of P6-24's S0 (ADR-0143's amendment): an A3 landscape
// and an A4 portrait page from `writePdf`, with solid and dashed lines, an
// arc, a filled shape and text as Inter's outlines plus the invisible layer.
// It lives here because the outlines come from this module (the only place
// opentype.js may be imported) and io must not import sketch. To look at the
// file in other readers:
//   PDF_OUT=/some/dir/sample.pdf pnpm vitest run packages/sketch/src/text/pdf-sample
import { readFileSync, writeFileSync } from 'node:fs';
import type { UnitContour } from '@extrudo/core';
import { type Contour, type PdfItem, type Point, writePdf } from '@extrudo/io';
import { describe, expect, it } from 'vitest';
import { loadFont, shapeText } from './index.js';

const ENV =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

loadFont('inter', readFileSync(new URL('../../../fonts/fonts/inter-regular.ttf', import.meta.url)));
loadFont(
  'inter-bold',
  readFileSync(new URL('../../../fonts/fonts/inter-bold.ttf', import.meta.url)),
);

/** A text item: Inter's outlines at cap height `height` mm, its baseline starting at `at`. */
function text(value: string, at: Point, height: number, font = 'inter'): PdfItem {
  const layout = shapeText(font, value, 'left');
  if (!layout) throw new Error('font not loaded');
  const map = ([x, y]: readonly [number, number]): Point => [
    at[0] + x * height,
    at[1] + y * height,
  ];
  let maxX = 0;
  const outline: Contour[] = layout.contours.map((c: UnitContour) => {
    const first = c.segments[0];
    const start = map(first?.kind === 'line' ? first.a : (first?.points[0] ?? [0, 0]));
    const segments: Contour['segments'] = c.segments.map((s) => {
      const p = s.kind === 'line' ? [s.b] : s.points.slice(1);
      for (const q of p) maxX = Math.max(maxX, q[0]);
      if (s.kind === 'line') return { type: 'line', to: map(s.b) };
      const [p1, p2, p3] = s.points.slice(1).map(map);
      return s.points.length === 3
        ? { type: 'quadratic', control: p1 as Point, to: p2 as Point }
        : { type: 'cubic', c1: p1 as Point, c2: p2 as Point, to: p3 as Point };
    });
    return { start, segments, closed: true };
  });
  return { type: 'text', text: value, outline, at, height, width: maxX * height };
}

const rect = (x0: number, y0: number, x1: number, y1: number): Contour => ({
  start: [x0, y0],
  segments: [
    { type: 'line', to: [x1, y0] },
    { type: 'line', to: [x1, y1] },
    { type: 'line', to: [x0, y1] },
    { type: 'line', to: [x0, y0] },
  ],
  closed: true,
});

function sheet(width: number, height: number, title: string): PdfItem[] {
  const thick = { width: 0.5 };
  const thin = { width: 0.25 };
  return [
    { type: 'path', contours: [rect(10, 10, width - 10, height - 10)], stroke: thick },
    { type: 'path', contours: [rect(width - 190, 10, width - 10, 40)], stroke: thin },
    text(title, [width - 185, 28], 5, 'inter-bold'),
    text('Scale 1:2 · A sheet of Extrudo', [width - 185, 16], 3.5),
    // A plate with a hole: visible outline, a hidden (dashed) edge, a centre line.
    { type: 'path', contours: [rect(40, 60, 140, 120)], stroke: thick },
    {
      type: 'path',
      contours: [{ start: [40, 100], segments: [{ type: 'line', to: [140, 100] }], closed: false }],
      stroke: { width: 0.25, dash: [3, 1.5] },
    },
    {
      type: 'path',
      contours: [{ start: [90, 54], segments: [{ type: 'line', to: [90, 126] }], closed: false }],
      stroke: { width: 0.18, dash: [8, 1.5, 1, 1.5] },
    },
    {
      type: 'path',
      contours: [
        {
          start: [96, 80],
          segments: [{ type: 'arc', center: [90, 80], sweep: 2 * Math.PI, to: [96, 80] }],
          closed: true,
        },
      ],
      stroke: thick,
    },
    // An arc of a quarter-and-a-bit turn and a filled triangle (an arrowhead).
    {
      type: 'path',
      contours: [
        {
          start: [180, 90],
          segments: [
            {
              type: 'arc',
              center: [160, 90],
              sweep: 2,
              to: [160 + 20 * Math.cos(2), 90 + 20 * Math.sin(2)],
            },
          ],
          closed: false,
        },
      ],
      stroke: thin,
    },
    {
      type: 'path',
      contours: [
        {
          start: [40, 130],
          segments: [
            { type: 'line', to: [43, 131] },
            { type: 'line', to: [43, 129] },
          ],
          closed: true,
        },
      ],
      fill: { color: '#000000' },
    },
    {
      type: 'path',
      contours: [{ start: [43, 130], segments: [{ type: 'line', to: [137, 130] }], closed: false }],
      stroke: { width: 0.18 },
    },
    {
      type: 'path',
      contours: [
        {
          start: [140, 130],
          segments: [
            { type: 'line', to: [137, 131] },
            { type: 'line', to: [137, 129] },
          ],
          closed: true,
        },
      ],
      fill: { color: '#000000' },
    },
    text('100 ±0.2', [80, 132], 3.5),
    text('Ø12 H7', [98, 86], 3.5),
    text('45° × 1', [150, 100], 3.5),
    {
      type: 'path',
      contours: [rect(150, 140, 180, 160)],
      fill: { color: '#ffd166' },
      stroke: thin,
    },
  ];
}

describe('the S0 sample PDF', () => {
  it('writes an A3 landscape and an A4 portrait page', () => {
    const pdf = writePdf(
      [
        { width: 420, height: 297, items: sheet(420, 297, 'Bracket, sheet 1') },
        { width: 210, height: 297, items: sheet(210, 297, 'Bracket, sheet 2') },
      ],
      { title: 'Bracket' },
    );
    expect(pdf.length).toBeGreaterThan(1000);
    if (ENV.PDF_OUT) writeFileSync(ENV.PDF_OUT, pdf);
  });
});
