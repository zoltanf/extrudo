/**
 * A sketch holding text, for the tests that need real glyph geometry
 * (P4-03). The shaper needs its font: this loads Inter from the package
 * directory, the way `packages/sketch/src/text/text.test.ts` does.
 *
 * **Test-only**, like the other `testing.ts` files: it imports
 * `@extrudo/sketch/text`, which must never reach an app chunk (opentype.js
 * belongs in its own lazy chunk, ADR-0058 §4).
 */
import { readFileSync } from 'node:fs';
import { emptySketchData, type SketchData, type SketchEntityId } from '@extrudo/core';
import { DEFAULT_FONT } from '@extrudo/fonts';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { loadFont } from '@extrudo/sketch/text';

const FONTS_DIR = new URL('../../../../packages/fonts/fonts/', import.meta.url);

let loaded = false;

/** Loads Inter once per test process, so `placeText` has a font to shape with. */
export function loadTestFont(): void {
  if (loaded) return;
  loaded = true;
  loadFont(DEFAULT_FONT, readFileSync(new URL('inter-regular.ttf', FONTS_DIR)));
}

const eid = (id: string) => id as SketchEntityId;

export interface TextSketchOptions {
  text?: string;
  /** Cap height in mm: the distance from the anchor to the top point. */
  height?: number;
  at?: [number, number];
  align?: 'left' | 'center' | 'right';
  construction?: boolean;
}

/**
 * A sketch with one text on its anchor and top points. The anchor sits at
 * `at`, the text runs along +x and rises to `height` (cap height).
 */
export function textSketch(options: TextSketchOptions = {}): SketchData {
  loadTestFont();
  const [x, y] = options.at ?? [0, 0];
  const height = options.height ?? 10;
  const entities: Record<string, unknown> = {
    [eid('anchor')]: { type: 'point', x, y },
    [eid('top')]: { type: 'point', x, y: y + height },
    [eid('word')]: {
      type: 'text',
      anchor: eid('anchor'),
      top: eid('top'),
      text: options.text ?? 'Ag',
      font: DEFAULT_FONT,
      align: options.align ?? 'left',
      construction: options.construction ?? false,
    },
  };
  return { ...emptySketchData(), entities: entities as SketchData['entities'] };
}

/** The sketch's profiles, as the view shades and picks them (ink marked, P4-03). */
export function textProfiles(data: SketchData) {
  return detectProfiles(data);
}
