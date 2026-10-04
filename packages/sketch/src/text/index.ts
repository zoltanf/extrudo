/**
 * Text shaping with opentype.js (ADR-0058 §4). This is the `@extrudo/sketch/text`
 * entry: nothing else in the package may import opentype.js or this module (the
 * boundary check in scripts/check-boundaries.mjs enforces that), so the ~170 kB
 * of the parser stays out of every other chunk until something imports this
 * entry.
 *
 * `shapeText` returns the unit layout (packages/core `text-layout.ts`): cap
 * height 1, the anchor at the origin on the first baseline, +y up, lines going
 * down. Contours keep the font's own direction; the glyph outlines come from
 * `glyph.path` (font units, y up) — never from `getPath`, which flips y for
 * canvas.
 */

import type { TextShaper, UnitContour, UnitLayout, UnitSegment, Vec2 } from '@extrudo/core';
import { registerTextShaper } from '@extrudo/core';
import type { Font, Glyph, PathCommand } from 'opentype.js';
import opentype from 'opentype.js';

const fonts = new Map<string, Font>();

/**
 * opentype.js's ways of saying "these bytes are not a font at all", which is
 * not something to tell a person who picked the wrong file: they get one
 * sentence instead. Anything else (a truncated table, an unknown table version)
 * is a real reason and is passed through.
 */
const NOT_A_FONT =
  /^(Unsupported OpenType signature|Offset is outside the bounds|Unexpected end of)/;

/**
 * Parses font bytes, or throws with a reason a person can read.
 */
function parseFont(bytes: ArrayBuffer | Uint8Array): Font {
  // A Buffer or other view may sit in a larger pool: copy the exact range.
  const buffer =
    bytes instanceof ArrayBuffer
      ? bytes
      : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  let font: Font;
  try {
    font = opentype.parse(buffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(NOT_A_FONT.test(message) ? "it doesn't look like a font file" : message);
  }
  if (!font.supported || typeof font.stringToGlyphs !== 'function') {
    throw new Error('it is not a font format Extrudo can read');
  }
  return font;
}

/** Parses a font file and keeps it under `id` for `shapeText`. Throws on bytes opentype.js can't read. */
export function loadFont(id: string, bytes: ArrayBuffer | Uint8Array): void {
  try {
    fonts.set(id, parseFont(bytes));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Font "${id}" could not be parsed: ${message}`);
  }
}

/** Subfamilies that say nothing: a font named for its family alone. */
const PLAIN_SUBFAMILIES = new Set(['regular', 'book', 'normal']);

/** One name record in the language it is written in, preferring English. */
function nameOf(names: Record<string, string> | undefined): string | undefined {
  if (!names) return undefined;
  const english = names.en;
  if (english) return english;
  return Object.values(names)[0];
}

/**
 * The name to show a font the user brought to the design (P4-03b, ADR-0061
 * §3): its family and subfamily, as its own names give them ("Comic Neue
 * Bold"). A subfamily that adds nothing is left out, and a file that records no
 * family name gives `undefined`, so the caller can fall back to the file name.
 * Throws the same way as `loadFont` on bytes that aren't a readable font.
 */
export function fontName(bytes: ArrayBuffer | Uint8Array): string | undefined {
  const names = parseFont(bytes).names as {
    fontFamily?: Record<string, string>;
    fontSubfamily?: Record<string, string>;
  };
  const family = nameOf(names.fontFamily);
  const subfamily = nameOf(names.fontSubfamily);
  if (!family) return subfamily;
  if (!subfamily || PLAIN_SUBFAMILIES.has(subfamily.toLowerCase())) return family;
  return `${family} ${subfamily}`;
}

export function hasFont(id: string): boolean {
  return fonts.has(id);
}

/** The cap height in font units: OS/2 `sCapHeight`, else the height of `H` (ADR-0058 §1). */
function capHeightOf(font: Font): number {
  const os2 = font.tables.os2 as { sCapHeight?: number } | undefined;
  const cap = os2?.sCapHeight ?? 0;
  if (cap > 0) return cap;
  const h = font.charToGlyph('H');
  if ((h.yMax ?? 0) > 0) return h.yMax as number;
  // Neither recorded: fall back to the em so the scale stays finite. Real
  // fonts always have OS/2 (opentype.js synthesizes one for built fonts).
  return font.unitsPerEm;
}

const MAX_CACHE = 500;
const cache = new Map<string, UnitLayout>();

/** True when the segment has no ink: shorter than 1e-9 in the unit frame. */
function isShort(segment: UnitSegment): boolean {
  const [first, ...rest] = segment.kind === 'line' ? [segment.a, segment.b] : segment.points;
  if (!first) return true;
  return rest.every((p) => Math.hypot(p[0] - first[0], p[1] - first[1]) < 1e-9);
}

/** Turns one glyph's path commands into unit-frame contours placed at (penX, baselineY) in font units. */
function glyphContours(
  glyph: Glyph,
  penX: number,
  baselineY: number,
  scale: number,
): UnitContour[] {
  const at = (x: number, y: number): Vec2 => [(x + penX) * scale, (y + baselineY) * scale];
  const contours: UnitContour[] = [];
  let segments: UnitSegment[] = [];
  let pos: Vec2 | undefined;
  let start: Vec2 | undefined;
  const close = () => {
    if (segments.length > 0) contours.push({ segments });
    segments = [];
    pos = undefined;
    start = undefined;
  };
  const push = (segment: UnitSegment, end: Vec2) => {
    if (!isShort(segment)) segments.push(segment);
    pos = end;
  };
  const commands: readonly PathCommand[] = glyph.path?.commands ?? [];
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M': {
        // opentype.js always closes a contour before the next M; finalize
        // defensively without a closing line if a font doesn't.
        close();
        pos = start = at(cmd.x, cmd.y);
        break;
      }
      case 'L':
        if (pos) push({ kind: 'line', a: pos, b: at(cmd.x, cmd.y) }, at(cmd.x, cmd.y));
        break;
      case 'Q':
        if (pos) {
          push(
            { kind: 'bezier', points: [pos, at(cmd.x1, cmd.y1), at(cmd.x, cmd.y)] },
            at(cmd.x, cmd.y),
          );
        }
        break;
      case 'C':
        if (pos) {
          push(
            {
              kind: 'bezier',
              points: [pos, at(cmd.x1, cmd.y1), at(cmd.x2, cmd.y2), at(cmd.x, cmd.y)],
            },
            at(cmd.x, cmd.y),
          );
        }
        break;
      case 'Z': {
        if (pos && start) push({ kind: 'line', a: pos, b: start }, start);
        close();
        break;
      }
    }
  }
  // A path that ends without Z still has ink.
  close();
  return contours;
}

/**
 * Shapes text into the unit layout, or undefined when the font isn't loaded.
 * Kerning comes from the font through `getKerningValue`; missing characters
 * are drawn as the font's .notdef and listed in `missing`.
 */
export const shapeText: TextShaper = (font, text, align) => {
  const key = `${font}\u0000${text}\u0000${align}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const parsed = fonts.get(font);
  if (!parsed) return undefined;

  const scale = 1 / capHeightOf(parsed);
  const hhea = parsed.tables.hhea as { lineGap?: number } | undefined;
  const lineGap = hhea?.lineGap ?? 0;
  // Line positions and pen positions are font units, scaled with the points.
  const lineHeight = parsed.ascender - parsed.descender + lineGap;

  const contours: UnitContour[] = [];
  const missing = new Set<string>();
  const lines = text.split('\n');
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k] ?? '';
    const glyphs = parsed.stringToGlyphs(line);
    const chars = [...line];
    // Line width: the pen position after the last glyph, with the kerning
    // between each pair but none after the last.
    let width = 0;
    for (let i = 0; i < glyphs.length; i++) {
      width += glyphs[i]?.advanceWidth ?? 0;
      if (i + 1 < glyphs.length) {
        width += parsed.getKerningValue(glyphs[i] as Glyph, glyphs[i + 1] as Glyph);
      }
    }
    const x0 = align === 'center' ? -width / 2 : align === 'right' ? -width : 0;
    const baselineY = -k * lineHeight;
    let pen = x0;
    for (let i = 0; i < glyphs.length; i++) {
      const glyph = glyphs[i];
      if (!glyph) continue;
      if (glyph.index === 0) {
        const char = chars[i] ?? line;
        if (char !== '') missing.add(char);
      }
      contours.push(...glyphContours(glyph, pen, baselineY, scale));
      pen += glyph.advanceWidth ?? 0;
      if (i + 1 < glyphs.length) {
        pen += parsed.getKerningValue(glyph, glyphs[i + 1] as Glyph);
      }
    }
  }

  const layout: UnitLayout = { contours, missing: [...missing] };
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, layout);
  return layout;
};

// Importing this entry is enough: core's registry gets the shaper at once.
registerTextShaper(shapeText);
