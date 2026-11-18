import { readFileSync } from 'node:fs';
import type * as core from '@extrudo/core';
import { registerTextShaper } from '@extrudo/core';
import { expect, it, vi } from 'vitest';
import { SketchBuilder } from '../fixtures';
import { loadFont, shapeText } from '../text/index.js';
import { detectProfiles } from './profiles';

const calls = vi.hoisted(() => ({ textPolylines: 0 }));
vi.mock('@extrudo/core', async (original) => {
  const actual = await original<typeof core>();
  return {
    ...actual,
    textPolylines: (...args: Parameters<typeof actual.textPolylines>) => {
      calls.textPolylines++;
      return actual.textPolylines(...args);
    },
  };
});

loadFont(
  'inter-regular@1',
  readFileSync(new URL('../../../fonts/fonts/inter-regular.ttf', import.meta.url)),
);
registerTextShaper(shapeText);

function addText(b: SketchBuilder, text: string, y: number): void {
  const a = b.point(0, y);
  const t = b.point(0, y + 10);
  b.entities[b.id('x')] = {
    type: 'text',
    anchor: a as never,
    top: t as never,
    text,
    font: 'inter-regular@1',
    align: 'left',
    construction: false,
  } as never;
}

it("lays each text's outline out once per detection, however many regions it has", () => {
  const b = new SketchBuilder();
  addText(b, '8'.repeat(40), 0);
  addText(b, 'B'.repeat(10), 20);
  calls.textPolylines = 0;
  const profiles = detectProfiles(b.sketch);
  // Each 8 and each B: its ink and its two counters.
  expect(profiles.filter((p) => p.text)).toHaveLength(50);
  expect(profiles).toHaveLength(150);
  expect(calls.textPolylines).toBe(2);
});
