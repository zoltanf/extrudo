import { readFileSync } from 'node:fs';
import type { TextAlign, UnitLayout, UnitSegment } from '@extrudo/core';
import { BUNDLED_FONTS } from '@extrudo/fonts';
import opentype from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { fontName, hasFont, loadFont, measureText, shapeText } from './index.js';

const FONTS_DIR = new URL('../../../fonts/fonts/', import.meta.url);

function loadBundled(id: string, file: string): void {
  loadFont(id, readFileSync(new URL(file, FONTS_DIR)));
}

function shape(font: string, text: string, align: TextAlign): UnitLayout {
  const layout = shapeText(font, text, align);
  if (!layout) throw new Error(`shapeText(${font}, …) returned undefined`);
  return layout;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function bbox(layout: UnitLayout): Box {
  const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const contour of layout.contours) {
    for (const segment of contour.segments) {
      const points = segment.kind === 'line' ? [segment.a, segment.b] : segment.points;
      for (const [x, y] of points) {
        box.minX = Math.min(box.minX, x);
        box.minY = Math.min(box.minY, y);
        box.maxX = Math.max(box.maxX, x);
        box.maxY = Math.max(box.maxY, y);
      }
    }
  }
  return box;
}

function parseFont(file: string): opentype.Font {
  const bytes = readFileSync(new URL(file, FONTS_DIR));
  return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

/** The line's pen width in the unit frame, computed straight from opentype.js. */
function penWidth(file: string, text: string): number {
  const font = parseFont(file);
  const glyphs = font.stringToGlyphs(text);
  const os2 = font.tables.os2 as { sCapHeight?: number } | undefined;
  const scale = 1 / (os2?.sCapHeight ?? 0);
  let width = 0;
  for (let i = 0; i < glyphs.length; i++) {
    const glyph = glyphs[i];
    if (!glyph) continue;
    width += glyph.advanceWidth ?? 0;
    const next = glyphs[i + 1];
    if (next) width += font.getKerningValue(glyph, next);
  }
  return width * scale;
}

/** advanceWidth and the kerning to the next glyph of `char`, in font units. */
function metrics(
  file: string,
  char: string,
  next?: string,
): { advance: number; kern: number; scale: number } {
  const font = parseFont(file);
  const os2 = font.tables.os2 as { sCapHeight?: number } | undefined;
  const glyph = font.charToGlyph(char);
  const kern = next ? font.getKerningValue(glyph, font.charToGlyph(next)) : 0;
  return { advance: glyph.advanceWidth ?? 0, kern, scale: 1 / (os2?.sCapHeight ?? 0) };
}

function beziersOf(layout: UnitLayout): Extract<UnitSegment, { kind: 'bezier' }>[] {
  return layout.contours.flatMap((contour) =>
    contour.segments.filter((segment): segment is Extract<UnitSegment, { kind: 'bezier' }> => {
      return segment.kind === 'bezier';
    }),
  );
}

const INTER = 'inter-regular@1';

loadBundled(INTER, 'inter-regular.ttf');

/** Longer than any glyph's own outline: a list this long grew with the text. */
const LONG_LIST = 256;

/** The array methods that copy or walk the whole list they are given. */
const WHOLE_LIST = [
  'concat',
  'entries',
  'every',
  'fill',
  'filter',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'flat',
  'flatMap',
  'forEach',
  'includes',
  'indexOf',
  'join',
  'lastIndexOf',
  'map',
  'reduce',
  'reduceRight',
  'reverse',
  'shift',
  'some',
  'sort',
  'splice',
  'toReversed',
  'toSorted',
  'toSpliced',
  'unshift',
  'values',
  'with',
] as const;

type Method = (this: unknown, ...args: unknown[]) => unknown;

/**
 * The limit on `countWork` per character of a 1000-character text. Shaping does
 * 9.9; a list copied or re-read per glyph does 380 to 4000.
 */
const WORK_PER_CHARACTER = 40;

let countedTexts = 0;

/**
 * Counts the work `run` does that grows with the text, with no clock involved:
 * elements of long lists copied or walked, glyphs read from the font's list,
 * characters the font turns into glyphs, and kerning lookups. What the font does
 * inside those calls doesn't count. A list copied by assigning one index at a
 * time is the one copy it can't see. Every patch is undone before this returns.
 */
function countWork(run: () => void): number {
  let count = 0;
  let muted = 1;
  const long = (list: unknown) =>
    (Array.isArray(list) || typeof list === 'string') && list.length >= LONG_LIST ? list.length : 0;
  const undo: (() => void)[] = [];
  const patch = (owner: object, key: PropertyKey, wrap: (original: Method) => Method) => {
    const original = Reflect.get(owner, key) as Method;
    Reflect.set(owner, key, wrap(original));
    undo.push(() => Reflect.set(owner, key, original));
  };
  const walks = (original: Method): Method =>
    function (this: unknown, ...args) {
      if (!muted) {
        count += long(this);
        for (let i = 0; i < args.length; i++) count += long(args[i]);
      }
      return original.apply(this, args);
    };
  for (const name of WHOLE_LIST) patch(Array.prototype, name, walks);
  patch(Array.prototype, Symbol.iterator, walks);
  patch(String.prototype, Symbol.iterator, walks);
  patch(
    Array.prototype,
    'slice',
    (original) =>
      function (this: unknown, ...args) {
        const part = original.apply(this, args);
        if (!muted) count += long(part);
        return part;
      },
  );
  patch(
    Array.prototype,
    'push',
    (original) =>
      function (this: unknown, ...args) {
        if (!muted && long(this)) count += args.length;
        return original.apply(this, args);
      },
  );
  const glyphReads: ProxyHandler<opentype.Glyph[]> = {
    get(list, key, receiver) {
      if (!muted && typeof key === 'string' && key !== 'length') count++;
      return Reflect.get(list, key, receiver);
    },
  };
  const inFont = (original: Method, charge: (args: unknown[]) => number): Method =>
    function (this: unknown, ...args) {
      if (!muted) count += charge(args);
      muted++;
      try {
        return original.apply(this, args);
      } finally {
        muted--;
      }
    };
  patch(opentype.Font.prototype, 'getKerningValue', (original) => inFont(original, () => 1));
  patch(opentype.Font.prototype, 'stringToGlyphs', (original) => {
    const read = inFont(original, (args) => String(args[0]).length);
    return function (this: unknown, ...args) {
      return new Proxy(read.apply(this, args) as opentype.Glyph[], glyphReads);
    };
  });
  try {
    muted = 0;
    run();
  } finally {
    muted = 1;
    for (const restore of undo) restore();
  }
  return count;
}

describe('shapeText', () => {
  it('shapes H with the cap height as 1', () => {
    const box = bbox(shape(INTER, 'H', 'left'));
    expect(Math.abs(box.maxY - box.minY - 1)).toBeLessThan(0.02);
    expect(Math.abs(box.minY)).toBeLessThan(0.01);
  });

  it('aligns left, center and right about the anchor', () => {
    const text = 'Extrudo';
    const left = bbox(shape(INTER, text, 'left'));
    const center = bbox(shape(INTER, text, 'center'));
    const right = bbox(shape(INTER, text, 'right'));
    const w = penWidth('inter-regular.ttf', text);
    expect(left.minX - center.minX).toBeCloseTo(w / 2, 6);
    expect(left.minX - right.minX).toBeCloseTo(w, 6);
  });

  it('centres a symmetric word on the anchor', () => {
    const box = bbox(shape(INTER, 'HIH', 'center'));
    expect((box.minX + box.maxX) / 2).toBeCloseTo(0, 6);
  });

  it('kerns AV closer than A and V side by side', () => {
    // The V ink inside "AV" sits at pen(A) + kern(A, V); against V alone that
    // shift is the kerning alone, so it must be left of a plain A advance.
    const avBox = bbox(shape(INTER, 'AV', 'left'));
    const vBox = bbox(shape(INTER, 'V', 'left'));
    const vInAv = avBox.maxX - (vBox.maxX - vBox.minX);
    const shift = vInAv - vBox.minX;
    const { advance, kern, scale } = metrics('inter-regular.ttf', 'A', 'V');
    expect(kern).toBeLessThan(0);
    expect(shift).toBeCloseTo((advance + kern) * scale, 6);
    expect(shift).toBeLessThan(advance * scale);
  });

  it('puts the second line one line height lower', () => {
    const font = parseFont('inter-regular.ttf');
    const os2 = font.tables.os2 as { sCapHeight?: number } | undefined;
    const hhea = font.tables.hhea as { lineGap?: number } | undefined;
    const lineHeight =
      (font.ascender - font.descender + (hhea?.lineGap ?? 0)) / (os2?.sCapHeight ?? 1);
    const box = bbox(shape(INTER, 'A\nA', 'left'));
    // A sits on the baseline: the second one's bottom is a line height below 0.
    expect(box.minY).toBeCloseTo(-lineHeight, 6);
  });

  it('gives o two contours of opposite direction', () => {
    const layout = shape(INTER, 'o', 'left');
    expect(layout.contours).toHaveLength(2);
    const signs = layout.contours.map((contour) => {
      const points = contour.segments.map((segment) =>
        segment.kind === 'line' ? segment.b : segment.points[segment.points.length - 1],
      );
      let area = 0;
      let previous = points[points.length - 1];
      for (const point of points) {
        if (!point || !previous) continue;
        area += previous[0] * point[1] - point[0] * previous[1];
        previous = point;
      }
      return Math.sign(area);
    });
    expect(signs[0]).not.toBe(signs[1]);
  });

  it('reports a missing character and draws .notdef', () => {
    const layout = shape(INTER, '漢', 'left');
    expect(layout.missing).toEqual(['漢']);
    expect(layout.contours.length).toBeGreaterThan(0);
  });

  it("keeps Inter's TrueType quadratics as three-point Béziers", () => {
    const layout = shape(INTER, 'Extrudo', 'left');
    const beziers = beziersOf(layout);
    expect(beziers.length).toBeGreaterThan(0);
    for (const segment of beziers) expect(segment.points).toHaveLength(3);
    expect(layout.contours.some((c) => c.segments.some((s) => s.kind === 'line'))).toBe(true);
  });

  it("keeps a built font's cubics as four-point Béziers", () => {
    const path = new opentype.Path();
    path.moveTo(0, 0);
    path.bezierCurveTo(10, 20, 20, 20, 30, 0);
    path.closePath();
    const a = new opentype.Glyph({ name: 'A', unicode: 65, advanceWidth: 100, path });
    const notdefGlyph = new opentype.Glyph({
      name: '.notdef',
      unicode: 0,
      advanceWidth: 100,
      path: new opentype.Path(),
    });
    const font = new opentype.Font({
      familyName: 'TestCubic',
      styleName: 'Regular',
      unitsPerEm: 100,
      ascender: 80,
      descender: -20,
      glyphs: [notdefGlyph, a],
    });
    loadFont('test-cubic@1', font.toArrayBuffer());
    const layout = shape('test-cubic@1', 'A', 'left');
    const beziers = beziersOf(layout);
    expect(beziers).toHaveLength(1);
    expect(beziers[0]?.points).toHaveLength(4);
  });

  it('loads and shapes every bundled font without missing characters', () => {
    for (const font of BUNDLED_FONTS) {
      loadBundled(font.id, font.file);
      const layout = shape(font.id, 'Extrudo 0123 ÄÖÜ ß é ñ ž', 'left');
      expect(layout.missing, font.id).toEqual([]);
      expect(layout.contours.length, font.id).toBeGreaterThan(0);
    }
  });

  it('refuses bytes that are not a font', () => {
    expect(() => loadFont('bad@1', new Uint8Array([1, 2, 3]))).toThrow(/bad@1/);
    expect(hasFont('bad@1')).toBe(false);
    expect(hasFont(INTER)).toBe(true);
    expect(shapeText('not-loaded@1', 'A', 'left')).toBeUndefined();
  });

  it('names a font by its own family and subfamily (P4-03b)', () => {
    // A subfamily that says nothing is left out, so the name stays short. The
    // bundled subsets record "Regular" for every style, so a bold one shows its
    // family only too; a font with a real subfamily joins the two.
    expect(fontName(readFileSync(new URL('inter-regular.ttf', FONTS_DIR)))).toBe('Inter');
    expect(fontName(readFileSync(new URL('jetbrains-mono-regular.ttf', FONTS_DIR)))).toBe(
      'JetBrains Mono',
    );
    // A font with a subfamily of its own shows both, as "Comic Neue Bold" does.
    const built = (style: string) => {
      const glyph = new opentype.Glyph({
        name: 'A',
        unicode: 65,
        advanceWidth: 100,
        path: new opentype.Path(),
      });
      return new opentype.Font({
        familyName: 'Comic Neue',
        styleName: style,
        unitsPerEm: 100,
        ascender: 80,
        descender: -20,
        glyphs: [glyph],
      }).toArrayBuffer();
    };
    expect(fontName(built('Bold'))).toBe('Comic Neue Bold');
    expect(fontName(built('Regular'))).toBe('Comic Neue');
  });

  it('says what is wrong with bytes that are not a font', () => {
    // Too short to read, and long enough to be read and refused: both are "not
    // a font" as far as a person is concerned.
    expect(() => fontName(new Uint8Array([104, 105]))).toThrow(/doesn't look like a font file/);
    expect(() => fontName(new TextEncoder().encode('hello world'))).toThrow(
      /doesn't look like a font file/,
    );
  });

  it('memoises a layout and shapes 1000 fresh characters with work that grows with the text', () => {
    const first = shape(INTER, 'memo', 'left');
    expect(shapeText(INTER, 'memo', 'left')).toBe(first);
    const length = 1000;
    let pangrams = '';
    while (pangrams.length < length + 1) {
      pangrams += 'The quick brown fox jumps over the lazy dog. 0123456789 ';
    }
    // The font parses an outline when it is first read: that is not the layout's work.
    shape(INTER, pangrams.slice(1, length + 1), 'left');
    // A new text each time, or the memo would answer.
    const text = String(++countedTexts).padStart(4, '0') + pangrams.slice(0, length - 4);
    let layout: UnitLayout | undefined;
    const work = countWork(() => {
      layout = shape(INTER, text, 'left');
    });
    expect(layout?.missing).toEqual([]);
    const sum = layout?.contours.reduce((n, contour) => n + contour.segments.length, 0) ?? 0;
    expect(sum).toBeGreaterThan(0);
    // The count sees the text at all, and sees a list copied per element.
    expect(work).toBeGreaterThanOrEqual(length);
    let copied: number[] = [];
    const copying = countWork(() => {
      for (let i = 0; i < length; i++) copied = [...copied, i];
    });
    expect(copying).toBeGreaterThan(WORK_PER_CHARACTER * length);
    expect(work).toBeLessThan(WORK_PER_CHARACTER * length);
  });
});

describe('measureText', () => {
  it("is the distance right alignment moves a line: the pen's advance, kerning included", () => {
    for (const line of ['AV', 'Hello, sheet', 'Ø12 ±0.1']) {
      const width = measureText(INTER, line) as number;
      const left = bbox(shape(INTER, line, 'left'));
      const right = bbox(shape(INTER, line, 'right'));
      expect(left.minX - right.minX).toBeCloseTo(width, 9);
    }
    // Kerning pulls A and V together.
    expect(measureText(INTER, 'AV') as number).toBeLessThan(
      (measureText(INTER, 'A') as number) + (measureText(INTER, 'V') as number),
    );
  });

  it('is undefined for a font that is not loaded and 0 for an empty line', () => {
    expect(measureText('no-such-font', 'H')).toBeUndefined();
    expect(measureText(INTER, '')).toBe(0);
  });
});
