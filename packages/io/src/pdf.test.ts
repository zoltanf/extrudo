import { strFromU8, unzlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { Contour } from './drawing';
import { type PdfPage, winAnsi, writePdf } from './pdf';

const latin1 = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

const square: Contour = {
  start: [10, 10],
  segments: [
    { type: 'line', to: [20, 10] },
    { type: 'line', to: [20, 20] },
    { type: 'line', to: [10, 20] },
    { type: 'line', to: [10, 10] },
  ],
  closed: true,
};
const circle: Contour = {
  start: [60, 50],
  segments: [{ type: 'arc', center: [50, 50], sweep: 2 * Math.PI, to: [60, 50] }],
  closed: true,
};

const PAGE: PdfPage = {
  width: 210,
  height: 297,
  items: [
    { type: 'path', contours: [square], stroke: { width: 0.35, dash: [3, 1.5] } },
    { type: 'path', contours: [circle], fill: { color: '#ff8000' } },
    {
      type: 'text',
      text: 'Ø 12 ±0.1 90°',
      outline: [square],
      at: [10, 100],
      height: 3.5,
      width: 30,
    },
  ],
};

describe('writePdf', () => {
  it('writes a cross-reference table whose offsets point at their objects', () => {
    const file = latin1(writePdf([PAGE, PAGE]));
    expect(file.startsWith('%PDF-1.4\n')).toBe(true);
    expect(file.endsWith('%%EOF\n')).toBe(true);
    const xref = Number(/startxref\n(\d+)\n/.exec(file)?.[1]);
    expect(file.slice(xref, xref + 4)).toBe('xref');
    const entries = [...file.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    );
    // Catalog, pages, font, info, and a page and its content per page.
    expect(entries).toHaveLength(4 + 2 * 2);
    entries.forEach((offset, i) => {
      expect(file.slice(offset)).toMatch(new RegExp(`^${i + 1} 0 obj\n`));
    });
    expect(file).toContain('/Count 2');
  });

  it('gives each page its size in points', () => {
    const file = latin1(writePdf([{ width: 420, height: 297, items: [] }]));
    expect(file).toContain('/MediaBox [0 0 1190.551 841.89]');
  });

  it('deflates the content streams, which inflate back to the operators', () => {
    const file = writePdf([PAGE]);
    const text = latin1(file);
    const start = text.indexOf('stream\n') + 'stream\n'.length;
    const length = Number(/\/Length (\d+) \/Filter \/FlateDecode/.exec(text)?.[1]);
    const content = strFromU8(unzlibSync(file.slice(start, start + length)));
    expect(content).toBe(
      latin1(writePdf([PAGE], { compress: false })).match(/stream\n([\s\S]*?)\nendstream/)?.[1],
    );
  });

  it('draws dashes, fills even-odd, arcs as Béziers, and the text twice', () => {
    const content = latin1(writePdf([PAGE], { compress: false }));
    expect(content).toContain('[3 1.5] 0 d');
    expect(content).toContain('0.35 w');
    expect(content).toContain('1 0.502 0 rg');
    // A full circle is four quarter Béziers.
    const circleOps = content.split('\n').find((l) => l.startsWith('60 50 m')) ?? '';
    expect(circleOps.match(/ c/g)).toHaveLength(4);
    expect(content).toMatch(/f\*\nQ\nBT\n3 Tr\n\/F1 4\.8747 Tf/);
    expect(content).toContain(
      `<${winAnsi('Ø 12 ±0.1 90°')
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')}> Tj`,
    );
  });

  it('encodes Ø, ± and ° in WinAnsiEncoding and others as ?', () => {
    expect(winAnsi('Ø±°×€')).toEqual([0xd8, 0xb1, 0xb0, 0xd7, 0x80]);
    expect(winAnsi('α\n')).toEqual([0x3f, 0x20]);
  });

  it('is the same bytes for the same pages', () => {
    expect(writePdf([PAGE], { title: 'Plate' })).toEqual(writePdf([PAGE], { title: 'Plate' }));
  });
});
