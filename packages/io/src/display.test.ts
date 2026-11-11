import { describe, expect, it } from 'vitest';
import {
  type DisplayList,
  displayPaint,
  displayPathData,
  displayPdfPage,
  displayTextLayer,
  writeDisplayPdf,
  writeDisplaySvg,
} from './display';
import type { Contour } from './drawing';
import { parseXml } from './xml';

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
/** A quarter turn from +x towards +y around (50, 50): on a y-down page, clockwise from the right to the bottom. */
const quarter: Contour = {
  start: [60, 50],
  segments: [{ type: 'arc', center: [50, 50], sweep: Math.PI / 2, to: [50, 60] }],
  closed: false,
};

const LIST: DisplayList = {
  width: 100,
  height: 80,
  items: [
    { type: 'path', contours: [square], fill: { color: '#ffffff' }, key: 'paper' },
    { type: 'path', contours: [quarter], stroke: { width: 0.25, dash: [3, 1.5], cap: 'butt' } },
    {
      type: 'text',
      text: 'A & <B> Ø',
      outline: [square],
      at: [10, 30],
      height: 3.5,
      width: 20,
      angle: -Math.PI / 2,
      key: 'item:1',
    },
  ],
};

describe('displayPdfPage', () => {
  it('flips y about the page height, and with it arcs and angles', () => {
    const page = displayPdfPage(LIST);
    expect(page).toMatchObject({ width: 100, height: 80 });
    const [paper, arc, text] = page.items;
    expect(paper).toMatchObject({ type: 'path', contours: [{ start: [10, 70] }] });
    expect(arc).toMatchObject({
      type: 'path',
      contours: [{ start: [60, 30], segments: [{ type: 'arc', center: [50, 30], to: [50, 20] }] }],
      stroke: { width: 0.25, dash: [3, 1.5], cap: 'butt' },
    });
    // The quarter turn goes from the right to below the centre either way: in y up that is clockwise.
    expect(arc?.type === 'path' && arc.contours[0]?.segments[0]).toMatchObject({
      sweep: -Math.PI / 2,
    });
    expect(text).toMatchObject({ type: 'text', at: [10, 50], angle: Math.PI / 2, width: 20 });
    expect(text && 'key' in text).toBe(false);
  });

  it('writes one PDF page per list at its size', () => {
    const file = latin1(writeDisplayPdf([LIST, { width: 210, height: 297, items: [] }]));
    expect(file).toContain('/Count 2');
    expect(file).toContain('/MediaBox [0 0 283.465 226.772]');
    expect(file).toContain('/MediaBox [0 0 595.276 841.89]');
  });
});

describe('writeDisplaySvg', () => {
  it('writes the page at its true size with y as it is', () => {
    const svg = writeDisplaySvg(LIST, { title: 'A & B' });
    const root = parseXml(svg);
    expect(root.name).toBe('svg');
    expect(root.attributes).toMatchObject({
      width: '100mm',
      height: '80mm',
      viewBox: '0 0 100 80',
    });
    expect(root.children.find((c) => c.name === 'title')?.text).toBe('A & B');
    const paths = root.children.filter((c) => c.name === 'path');
    expect(paths.map((p) => p.attributes.d)).toEqual([
      'M10 10L20 10L20 20L10 20L10 10Z',
      // A positive sweep turns towards +y: SVG's sweep flag 1.
      'M60 50A10 10 0 0 1 50 60',
      'M10 10L20 10L20 20L10 20L10 10Z',
    ]);
    expect(paths[1]?.attributes).toMatchObject({
      fill: 'none',
      stroke: '#000000',
      'stroke-width': '0.25',
      'stroke-dasharray': '3 1.5',
      'stroke-linecap': 'butt',
    });
    expect(paths[2]?.attributes).toMatchObject({ fill: '#000000', 'fill-rule': 'evenodd' });
  });

  it('adds each text run as invisible, selectable text stretched onto its outlines', () => {
    const root = parseXml(writeDisplaySvg(LIST));
    const group = root.children.find((c) => c.name === 'g');
    expect(group?.attributes['fill-opacity']).toBe('0');
    const text = group?.children[0];
    expect(text?.text).toBe('A & <B> Ø');
    expect(text?.attributes).toMatchObject({
      x: '10',
      y: '30',
      textLength: '20',
      lengthAdjust: 'spacingAndGlyphs',
      transform: 'rotate(-90 10 30)',
    });
    // Capitals 3.5 mm high in Inter (cap height 0.7275 em).
    expect(Number(text?.attributes['font-size'])).toBeCloseTo(3.5 / 0.7275, 3);
  });

  it('is the same text for the same list', () => {
    expect(writeDisplaySvg(LIST)).toBe(writeDisplaySvg(structuredClone(LIST)));
  });
});

describe('the screen helpers', () => {
  it('give the same path data and paint the SVG file has', () => {
    expect(displayPathData([quarter])).toBe('M60 50A10 10 0 0 1 50 60');
    expect(displayPaint(LIST.items[0] as never)).toEqual({ fill: '#ffffff', fillRule: 'evenodd' });
    expect(displayPaint(LIST.items[1] as never)).toEqual({
      fill: 'none',
      stroke: '#000000',
      strokeWidth: '0.25',
      strokeDasharray: '3 1.5',
      strokeLinecap: 'butt',
      strokeLinejoin: 'round',
    });
    const layer = displayTextLayer(LIST.items[2] as never);
    expect(layer).toMatchObject({ x: '10', y: '30', textLength: '20' });
  });
});
