/**
 * Detection remembers its result per sketch data object (ADR-0020's
 * amendment of 2026-11-16): the same object again does no work, a refusal
 * is given again without the work, a sketch with text is detected every
 * time, an edit (a new object) gives the new regions, the measuring entries
 * still do the work, and no caller can change what the next one gets.
 * The work is counted by the crossing tests (`intersectCurves`), which every
 * detection of curves that meet makes.
 */
import { readFileSync } from 'node:fs';
import {
  createDocument,
  createDocumentStore,
  type Feature,
  type FeatureId,
  originPlaneRef,
  readSketch,
  registerTextShaper,
  removeFromSketch,
  type SketchData,
  type SketchEntityId,
  setSketchGeometry,
  sketchInputs,
} from '@extrudo/core';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SketchBuilder } from '../fixtures';
import * as geometry from '../inference/geometry';
import { loadFont, shapeText } from '../text/index.js';
import {
  detectProfiles,
  detectProfilesAllPairs,
  detectProfilesWork,
  MAX_PROFILE_COORDINATE,
  ProfilesRefusedError,
  type Work,
} from './profiles';

vi.mock('../inference/geometry', async (original) => {
  const actual = await original<typeof geometry>();
  return { ...actual, intersectCurves: vi.fn(actual.intersectCurves) };
});
const tests = vi.mocked(geometry.intersectCurves);
beforeEach(() => {
  tests.mockClear();
});

/** A `w` × `h` rectangle at (x, y), with a circle hole in it. */
function plate(b = new SketchBuilder(), x = 0, w = 40): SketchBuilder {
  b.line(x, 0, x + w, 0);
  b.line(x + w, 0, x + w, 20);
  b.line(x + w, 20, x, 20);
  b.line(x, 20, x, 0);
  b.circle(x + w / 2, 10, 4);
  return b;
}

/** `n` chords of one circle that all cross: about n²/2 crossings, refused. */
function chords(n = 330): SketchData {
  const b = plate();
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * i) / n;
    b.line(
      100 + 30 * Math.cos(a),
      30 * Math.sin(a),
      100 - 30 * Math.cos(a + 0.3),
      -30 * Math.sin(a + 0.3),
    );
  }
  return b.sketch;
}

/** The reason `detectProfiles(data)` refused it with. */
function refusal(data: SketchData): string | undefined {
  try {
    detectProfiles(data);
  } catch (error) {
    if (error instanceof ProfilesRefusedError) return error.reason;
    throw error;
  }
  return undefined;
}

describe('detectProfiles remembers', () => {
  it('a sketch: the same object again does no work and gives the same regions', () => {
    const data = plate().sketch;
    const first = detectProfiles(data);
    expect(tests.mock.calls.length).toBeGreaterThan(0);
    tests.mockClear();
    const again = detectProfiles(data);
    expect(tests).not.toHaveBeenCalled();
    expect(again).toEqual(first);
    expect(again.map((p) => p.id)).toEqual(first.map((p) => p.id));
    // A new object with the same content is detected again.
    detectProfiles({ ...data });
    expect(tests.mock.calls.length).toBeGreaterThan(0);
  });

  it('a refusal: the same object refuses again with the same reason and no work', () => {
    const data = chords();
    expect(refusal(data)).toBe('crossings');
    expect(tests.mock.calls.length).toBeGreaterThan(1000);
    tests.mockClear();
    let second: unknown;
    try {
      detectProfiles(data);
    } catch (error) {
      second = error;
    }
    expect(second).toBeInstanceOf(ProfilesRefusedError);
    expect((second as ProfilesRefusedError).reason).toBe('crossings');
    expect(tests).not.toHaveBeenCalled();

    // A curve past the largest coordinate: refused before any pair is tested.
    const far = plate().sketch;
    (far.entities as Record<string, unknown>).p0 = {
      type: 'point',
      x: 2 * MAX_PROFILE_COORDINATE,
      y: 0,
    };
    expect(refusal(far)).toBe('size');
    expect(refusal(far)).toBe('size');
  });

  it('only what detection itself throws for: other errors are thrown again, with the work again', () => {
    const data = plate().sketch;
    tests.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(() => detectProfiles(data)).toThrow('boom');
    tests.mockClear();
    expect(detectProfiles(data).length).toBeGreaterThan(0);
    expect(tests.mock.calls.length).toBeGreaterThan(0);
  });
});

describe('a sketch with text', () => {
  loadFont(
    'inter-regular@1',
    readFileSync(new URL('../../../fonts/fonts/inter-regular.ttf', import.meta.url)),
  );
  registerTextShaper(shapeText);
  afterAll(() => registerTextShaper(undefined));

  function withText(construction: boolean): SketchData {
    const b = plate();
    const a = b.point(0, 30);
    const t = b.point(0, 40);
    b.entities.text = {
      type: 'text',
      anchor: a as never,
      top: t as never,
      text: 'OK',
      font: 'inter-regular@1',
      align: 'left',
      construction,
    } as never;
    return b.sketch;
  }

  it('is detected every time: its ink depends on the fonts loaded', () => {
    const data = withText(false);
    const first = detectProfiles(data);
    expect(first.some((p) => p.text)).toBe(true);
    tests.mockClear();
    expect(detectProfiles(data)).toEqual(first);
    expect(tests.mock.calls.length).toBeGreaterThan(0);
  });

  it('is remembered when the text is construction: detection never reads it', () => {
    const data = withText(true);
    const first = detectProfiles(data);
    expect(first.some((p) => p.text)).toBe(false);
    tests.mockClear();
    expect(detectProfiles(data)).toEqual(first);
    expect(tests).not.toHaveBeenCalled();
  });
});

describe('an edited sketch gives the new regions', () => {
  function store() {
    const b = plate();
    const sketch = 's1' as FeatureId;
    const feature = {
      id: sketch,
      type: 'sketch',
      name: 'Sketch1',
      suppressed: false,
      inputs: sketchInputs(originPlaneRef('origin:xy'), b.sketch),
    } as Feature;
    const doc = { ...createDocument({ name: 'Cache' }), features: [feature], timelineMarker: 1 };
    const s = createDocumentStore(doc);
    const data = () => readSketch(s.getState().doc.features[0] as Feature)?.data as SketchData;
    return { s, sketch, data };
  }

  it('through a command (a solve, a delete) and its undo', () => {
    const { s, sketch, data } = store();
    const before = data();
    const regions = detectProfiles(before);
    expect(regions[0]?.area).toBeCloseTo(800 - Math.PI * 16, 0);
    // Widen the rectangle: its right side's points move to x = 60.
    const right = Object.entries(before.entities)
      .filter(([, e]) => e.type === 'point' && Math.abs(e.x - 40) < 1e-9)
      .map(([id]) => id as SketchEntityId);
    expect(right).toHaveLength(4);
    s.getState().dispatch(
      setSketchGeometry({
        feature: sketch,
        points: Object.fromEntries(
          right.map((id) => [id, { x: 60, y: (before.entities[id] as { y: number }).y }]),
        ),
      }),
    );
    expect(data()).not.toBe(before);
    expect(detectProfiles(data())[0]?.area).toBeCloseTo(1200 - Math.PI * 16, 0);
    // The document's data can't be written into: it is frozen.
    expect(Object.isFrozen(data().entities)).toBe(true);

    // Delete the circle: one region, no hole.
    const circle = Object.entries(data().entities).find(([, e]) => e.type === 'circle')?.[0];
    s.getState().dispatch(
      removeFromSketch({ feature: sketch, entities: [circle as SketchEntityId] }),
    );
    const removed = detectProfiles(data());
    expect(removed).toHaveLength(1);
    expect(removed[0]?.holes).toHaveLength(0);

    // Undo twice: the first object's regions again.
    s.getState().undo();
    s.getState().undo();
    expect(detectProfiles(data())[0]?.area).toBeCloseTo(regions[0]?.area ?? 0, 6);
  });

  it("through a builder's live maps: each look at the sketch is a new object", () => {
    const b = plate();
    expect(detectProfiles(b.sketch)).toHaveLength(2);
    plate(b, 100);
    expect(detectProfiles(b.sketch)).toHaveLength(4);
  });
});

describe('the measuring entries', () => {
  it('still do the work on a remembered sketch', () => {
    const data = plate().sketch;
    const first = detectProfiles(data);
    tests.mockClear();
    const work: Work = { segments: 0, points: 0, tests: 0 };
    expect(detectProfilesWork(data, work)).toEqual(first);
    expect(work.segments).toBe(5);
    expect(work.tests).toBeGreaterThan(0);
    expect(tests.mock.calls.length).toBeGreaterThan(0);
    tests.mockClear();
    expect(detectProfilesAllPairs(data)).toEqual(first);
    expect(tests.mock.calls.length).toBeGreaterThan(0);
  });
});

describe('what a caller gets', () => {
  it("is its own list, of frozen profiles: the next caller's regions don't change", () => {
    const data = plate(plate(), 100).sketch;
    const first = detectProfiles(data);
    const ids = first.map((p) => p.id);
    const area = first[0]?.area;
    first.sort((a, b) => a.area - b.area);
    first.pop();
    first.push(first[0] as never);
    const profile = detectProfiles(data)[0];
    if (!profile) throw new Error('no profile');
    expect(() => {
      (profile as { area: number }).area = 0;
    }).toThrow(TypeError);
    expect(() => profile.holes.push(profile.outer)).toThrow(TypeError);
    expect(() => {
      (profile.outer.polygon[0] as unknown as number[])[0] = 99;
    }).toThrow(TypeError);
    expect(() => {
      profile.outer.edges[0]?.points.reverse();
    }).toThrow(TypeError);
    const again = detectProfiles(data);
    expect(again.map((p) => p.id)).toEqual(ids);
    expect(again[0]?.area).toBe(area);
  });

  it("shares nothing with the sketch: freezing leaves a builder's data as it was", () => {
    const b = plate();
    b.arc(60, 10, 5, 0, 180);
    b.line(55, 10, 65, 10);
    b.ellipse(80, 10, 6, 3, 30);
    b.spline([
      [90, 0],
      [95, 10],
      [100, 0],
    ]);
    const data = b.sketch;
    const profiles = detectProfiles(data);
    expect(profiles.length).toBeGreaterThan(3);
    const isPart = (o: unknown): boolean =>
      typeof o === 'object' &&
      o !== null &&
      (Object.isFrozen(o) || Object.values(o as object).some(isPart));
    expect(isPart(b.entities)).toBe(false);
    // The builder still writes into its maps and entities.
    b.line(0, 30, 10, 30);
    const first = Object.values(b.entities)[0] as { x: number };
    first.x += 0;
  });
});
