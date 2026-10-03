import { readFileSync } from 'node:fs';
import {
  registerTextShaper,
  type SketchData,
  type SketchEntityId,
  type TextShaper,
  type Vec2,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { SketchBuilder } from '../fixtures';
import { loadFont, shapeText } from '../text/index.js';
import { detectProfiles, type Profile, textInkOf } from './profiles';

const FONTS_DIR = new URL('../../../fonts/fonts/', import.meta.url);
loadFont('inter-regular@1', readFileSync(new URL('inter-regular.ttf', FONTS_DIR)));
registerTextShaper(shapeText);

/** A text entity from (0,0) up to (0,10): height 10 mm, upright, left-aligned. */
function addText(
  b: SketchBuilder,
  text: string,
  anchor: [number, number] = [0, 0],
  top: [number, number] = [0, 10],
  construction = false,
): SketchEntityId {
  const a = b.point(anchor[0], anchor[1]);
  const t = b.point(top[0], top[1]);
  const id = b.id('x');
  b.entities[id] = {
    type: 'text',
    anchor: a as never,
    top: t as never,
    text,
    font: 'inter-regular@1',
    align: 'left',
    construction,
  } as never;
  return id as SketchEntityId;
}

function rect(b: SketchBuilder, x: number, y: number, w: number, h: number): void {
  b.line(x, y, x + w, y);
  b.line(x + w, y, x + w, y + h);
  b.line(x + w, y + h, x, y + h);
  b.line(x, y + h, x, y);
}

const inkProfiles = (profiles: readonly Profile[]) => profiles.filter((p) => p.text !== undefined);

describe('text profiles', () => {
  it('marks the body of "O" as ink with one hole; its counter is a plain region', () => {
    const b = new SketchBuilder();
    addText(b, 'O');
    const profiles = detectProfiles(b.sketch);
    const ink = inkProfiles(profiles);
    expect(ink).toHaveLength(1);
    expect(ink[0]?.holes).toHaveLength(1);
    expect(profiles).toHaveLength(2);
    expect(profiles.find((p) => p.text === undefined)).toBeDefined();
  });

  it('keeps the rectangle around "HI" plain with the letters as holes; the letters are ink', () => {
    const b = new SketchBuilder();
    rect(b, -5, -5, 35, 20);
    addText(b, 'HI', [0, 0], [0, 10]);
    const profiles = detectProfiles(b.sketch);
    const plate = profiles.find((p) => p.text === undefined);
    expect(plate).toBeDefined();
    expect(plate?.holes.length).toBeGreaterThanOrEqual(2);
    const ink = inkProfiles(profiles);
    expect(ink.length).toBeGreaterThanOrEqual(2);
    for (const p of ink) expect(p.holes).toEqual([]);
  });

  it('marks the body of "8" as one ink region with two holes', () => {
    const b = new SketchBuilder();
    addText(b, '8');
    const profiles = detectProfiles(b.sketch);
    const ink = inkProfiles(profiles);
    expect(ink).toHaveLength(1);
    expect(ink[0]?.holes).toHaveLength(2);
  });

  it('marks every piece of touching letters as ink and their union has the right area', () => {
    const saved = shapeText;
    // Two unit squares overlapping by half a unit.
    const fake: TextShaper = () => ({
      contours: [
        {
          segments: [
            { kind: 'line', a: [0, 0], b: [1, 0] },
            { kind: 'line', a: [1, 0], b: [1, 1] },
            { kind: 'line', a: [1, 1], b: [0, 1] },
            { kind: 'line', a: [0, 1], b: [0, 0] },
          ],
        },
        {
          segments: [
            { kind: 'line', a: [0.5, 0], b: [1.5, 0] },
            { kind: 'line', a: [1.5, 0], b: [1.5, 1] },
            { kind: 'line', a: [1.5, 1], b: [0.5, 1] },
            { kind: 'line', a: [0.5, 1], b: [0.5, 0] },
          ],
        },
      ],
      missing: [],
    });
    registerTextShaper(fake);
    try {
      const b = new SketchBuilder();
      addText(b, 'AB');
      const profiles = detectProfiles(b.sketch);
      expect(inkProfiles(profiles)).toHaveLength(profiles.length);
      expect(profiles.length).toBeGreaterThan(1);
      const union = profiles.reduce((s, p) => s + p.area, 0);
      // Two 10 × 10 squares overlapping by 5 × 10: the union is 150 mm².
      expect(union).toBeCloseTo(150, 6);
    } finally {
      registerTextShaper(saved);
    }
  });

  it('changes the region IDs when the string changes', () => {
    const b1 = new SketchBuilder();
    addText(b1, 'O');
    const before = detectProfiles(b1.sketch)
      .map((p) => p.id)
      .sort();
    const b2 = new SketchBuilder();
    addText(b2, 'L');
    const after = detectProfiles(b2.sketch)
      .map((p) => p.id)
      .sort();
    expect(before).not.toEqual(after);
  });

  it('gives construction text no profiles', () => {
    const b = new SketchBuilder();
    addText(b, 'O', [0, 0], [0, 10], true);
    expect(detectProfiles(b.sketch)).toEqual([]);
  });

  it('textInkOf returns the text contours as polylines', () => {
    const b = new SketchBuilder();
    addText(b, 'O');
    const ink = textInkOf(
      b.sketch,
      Object.keys(b.entities).find((k) => b.entities[k]?.type === 'text') as SketchEntityId,
    );
    expect(ink).toBeDefined();
    expect(ink?.length).toBe(2);
    for (const contour of ink as readonly Vec2[][]) {
      expect(contour.length).toBeGreaterThan(2);
    }
    expect(textInkOf(b.sketch, 'n9' as SketchEntityId)).toBeUndefined();
  });

  it('detects profiles of a placed text consistently from a parsed sketch data', () => {
    const b = new SketchBuilder();
    addText(b, 'O');
    const data = JSON.parse(JSON.stringify(b.sketch)) as SketchData;
    const profiles = detectProfiles(data);
    expect(inkProfiles(profiles)).toHaveLength(1);
  });
});
