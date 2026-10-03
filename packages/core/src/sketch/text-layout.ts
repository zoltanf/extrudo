/**
 * The unit layout of shaped text (ADR-0058 §4): the frames the shaper
 * returns and the text features place. Types only — the shaping itself
 * lives behind the registry in `@extrudo/sketch/text` (opentype.js must
 * not land in core or the app's main chunk).
 */

import type { Vec2 } from './planes';

/** A piece of a glyph contour in the unit layout (ADR-0058 §4). */
export type UnitSegment =
  | { kind: 'line'; a: Vec2; b: Vec2 }
  /** A Bézier: 3 points (quadratic) or 4 (cubic), ends included. */
  | { kind: 'bezier'; points: Vec2[] };

/** A closed contour in the font's own direction (needed for the winding rule). */
export interface UnitContour {
  segments: UnitSegment[];
}

/**
 * Text laid out in the unit frame: cap height 1, the anchor at the origin on
 * the first baseline, +y up, lines going down.
 */
export interface UnitLayout {
  contours: UnitContour[];
  /** Characters the font has no glyph for (drawn as its .notdef). */
  missing: string[];
}

export type TextAlign = 'left' | 'center' | 'right';

/**
 * Shapes text into the unit frame. Undefined when the font isn't loaded
 * (`@extrudo/sketch/text` registers the real shaper; core stays free of it).
 */
export type TextShaper = (font: string, text: string, align: TextAlign) => UnitLayout | undefined;
