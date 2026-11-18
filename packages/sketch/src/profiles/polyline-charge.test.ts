/**
 * A curve's polyline is charged against the segment and point limits
 * before it is sampled (ADR-0020's second amendment of 2026-11-15): a curve
 * past them is refused without its polyline being made.
 */
import { readFileSync } from 'node:fs';
import type * as core from '@extrudo/core';
import { registerTextShaper } from '@extrudo/core';
import { expect, it, vi } from 'vitest';
import { SketchBuilder } from '../fixtures';
import { loadFont, shapeText } from '../text/index.js';
import {
  detectProfilesWork,
  MAX_PROFILE_SEGMENTS,
  ProfilesRefusedError,
  type Work,
} from './profiles';

const sampled = vi.hoisted(() => ({ points: 0 }));
vi.mock('@extrudo/core', async (original) => {
  const actual = await original<typeof core>();
  const count = <T extends unknown[]>(f: (...args: T) => unknown) =>
    ((...args: T) => {
      const out = f(...args) as unknown[] | Map<unknown, unknown[]> | undefined;
      if (Array.isArray(out)) sampled.points += out.length;
      else if (out instanceof Map) for (const v of out.values()) sampled.points += v.length;
      return out;
    }) as never;
  return {
    ...actual,
    curvePolyline: count(actual.curvePolyline),
    splinePolyline: count(actual.splinePolyline),
    textPolylines: count(actual.textPolylines),
  };
});

loadFont(
  'inter-regular@1',
  readFileSync(new URL('../../../fonts/fonts/inter-regular.ttf', import.meta.url)),
);
registerTextShaper(shapeText);

/** Detects `data`'s sketch: the refusal's reason, the work charged, the polyline points sampled. */
function refused(data: SketchBuilder) {
  const work: Work = { segments: 0, points: 0, tests: 0 };
  sampled.points = 0;
  let reason: string | undefined;
  try {
    detectProfilesWork(data.sketch, work);
  } catch (error) {
    if (!(error instanceof ProfilesRefusedError)) throw error;
    reason = error.reason;
  }
  return { reason, work, sampled: sampled.points };
}

it.each(['control', 'fit'] as const)(
  'refuses a %s spline of more pieces than the segment limit before sampling it',
  (mode) => {
    // 16 pieces a span: 13,000 poles are past 200,000.
    const b = new SketchBuilder();
    b.spline(
      Array.from({ length: 13_000 }, (_, i): [number, number] => [i * 0.01, (i % 2) * 0.01]),
      { mode },
    );
    const r = refused(b);
    expect(r.reason).toBe('curves');
    expect(r.work.segments).toBeGreaterThan(MAX_PROFILE_SEGMENTS);
    expect(r.sampled).toBe(0);
  },
);

it('refuses a text of more pieces than the limit before sampling its glyphs', () => {
  const b = new SketchBuilder();
  const a = b.point(0, 0);
  const t = b.point(0, 10);
  b.entities[b.id('x')] = {
    type: 'text',
    anchor: a as never,
    top: t as never,
    text: '8'.repeat(300),
    font: 'inter-regular@1',
    align: 'left',
    construction: false,
  } as never;
  const r = refused(b);
  expect(r.reason).toBe('curves');
  expect(r.sampled).toBe(0);
});

it('samples a spline under the limit once, as many points as it charged', () => {
  const b = new SketchBuilder();
  b.spline(
    Array.from({ length: 100 }, (_, i): [number, number] => [i, (i % 2) * 0.5]),
    {
      mode: 'control',
    },
  );
  const r = refused(b);
  expect(r.reason).toBeUndefined();
  expect(r.sampled).toBe(r.work.points + 1);
});
