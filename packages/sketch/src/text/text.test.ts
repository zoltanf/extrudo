import { readFileSync } from 'node:fs';
import type { TextAlign, UnitLayout, UnitSegment } from '@extrudo/core';
import { BUNDLED_FONTS } from '@extrudo/fonts';
import opentype from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { fontName, hasFont, loadFont, shapeText } from './index.js';

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

  it('memoises a layout and shapes 1000 fresh characters quickly', () => {
    const first = shape(INTER, 'memo', 'left');
    expect(shapeText(INTER, 'memo', 'left')).toBe(first);
    let text = '';
    while (text.length < 1000) text += 'The quick brown fox jumps over the lazy dog. ';
    text = text.slice(0, 1000);
    const start = performance.now();
    const layout = shape(INTER, text, 'left');
    const elapsed = performance.now() - start;
    expect(layout.missing).toEqual([]);
    expect(elapsed).toBeLessThan(100);
  });
});
