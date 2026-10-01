// The benchmark designs of requirements §7 as fixtures (P2-17): the
// `.extrudo` files under `fixtures/benchmarks/` are what the e2e specs
// (`e2e/benchmark-b1.spec.ts` to `-b7`) build through the UI and export
// (`WRITE_FIXTURES=1 pnpm e2e` rewrites them). Here each one is loaded through
// core's migrations and recomputed with the real kernel: the bodies, their
// size and volume are what the parameters give, and changing parameters the
// extrudes read moves them. (Sketch dimensions are re-solved by the app, not
// by the kernel, so those parameters aren't changed here.)
import {
  applyCommand,
  type ExtrudoDocument,
  loadDocument,
  type Parameter,
  updateParameter,
} from '@extrudo/core';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import b1 from '../../../fixtures/benchmarks/b1-plate.extrudo?url&inline';
import b2 from '../../../fixtures/benchmarks/b2-storage-box.extrudo?url&inline';
import b3 from '../../../fixtures/benchmarks/b3-phone-stand.extrudo?url&inline';
import b4 from '../../../fixtures/benchmarks/b4-box-with-lid.extrudo?url&inline';
import b5 from '../../../fixtures/benchmarks/b5-pcb-enclosure.extrudo?url&inline';
import b6 from '../../../fixtures/benchmarks/b6-wall-hook.extrudo?url&inline';
import b7 from '../../../fixtures/benchmarks/b7-knurled-knob.extrudo?url&inline';
import { kernelFeatures } from './features';
import { translation } from './features/matrix';
import { Kernel } from './kernel';
import { loadOcct } from './occt/load';
import { RecomputeEngine } from './recompute/engine';
import type { RecomputeResult } from './recompute/types';

/** The bytes of a `data:` URL (Vite's `?url&inline` import of a binary file). */
function bytesOf(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** The document inside an `.extrudo` fixture, loaded through core's migrations. */
function load(dataUrl: string): ExtrudoDocument {
  const files = unzipSync(bytesOf(dataUrl));
  const json = files['document.json'];
  if (!json) throw new Error('no document.json');
  return loadDocument(JSON.parse(strFromU8(json))).doc;
}

let kernel: Kernel;
let engine: RecomputeEngine;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

afterAll(() => {
  engine?.clear();
});

type Done = Extract<RecomputeResult, { status: 'done' }>;

/** Recomputes a document from scratch: every feature ok. */
async function recompute(doc: ExtrudoDocument): Promise<Done> {
  engine?.clear();
  engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error(`recompute ${result.status}`);
  const problems = Object.entries(result.features).filter(([, s]) => s.status !== 'ok');
  expect(problems).toEqual([]);
  return result;
}

/**
 * Size, volume and face count of each body, in creation order. The box is
 * the display mesh's (`measure`'s is loose: it grows by a tolerance around
 * curved and shelled shapes); its nodes lie on the exact vertices.
 */
function bodies(result: Done) {
  return result.bodies.map(({ id, mesh }) => {
    const shape = engine.latestBody(id);
    if (!shape || !mesh) throw new Error(`no body ${id}`);
    const { volume } = kernel.measure(shape);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const p = mesh.positions;
    for (let i = 0; i < p.length; i++) {
      min[i % 3] = Math.min(min[i % 3] as number, p[i] as number);
      max[i % 3] = Math.max(max[i % 3] as number, p[i] as number);
    }
    return {
      size: max.map((v, k) => Number((v - (min[k] as number)).toFixed(3))),
      min: min.map((v) => Number(v.toFixed(3)) + 0),
      volume,
      faces: mesh.faceRanges.length / 2,
    };
  });
}

/** `doc` with user parameters set (by name) to new expressions. */
function withParameters(doc: ExtrudoDocument, values: Record<string, string>): ExtrudoDocument {
  let next = doc;
  for (const [name, expression] of Object.entries(values)) {
    const parameter = next.parameters.find((p): p is Parameter => p.name === name);
    if (!parameter) throw new Error(`no parameter ${name}`);
    next = applyCommand(next, updateParameter({ id: parameter.id, changes: { expression } })).doc;
  }
  return next;
}

const featureNames = (doc: ExtrudoDocument) => doc.features.map((f) => f.name);
/** The stored names of the computed bodies, in creation order. */
const bodyNames = (doc: ExtrudoDocument, result: Done) =>
  result.bodies.map(({ id }) => doc.bodies[id]?.name);

describe('B1 plate with four holes', () => {
  it('is a sketch with its parameters, and no body', async () => {
    const doc = load(b1);
    expect(doc.name).toBe('B1 Plate');
    expect(featureNames(doc)).toEqual(['Sketch1']);
    expect(doc.parameters.map((p) => [p.name, p.expression])).toEqual(
      expect.arrayContaining([
        ['width', '120 mm'],
        ['depth', '80 mm'],
        ['spacing', '70 mm'],
        ['hole', '6 mm'],
        ['margin', '(width - spacing) / 2'],
      ]),
    );
    const result = await recompute(doc);
    expect(result.bodies).toEqual([]);
    // The sketch computed; there is nothing to extrude.
    expect(Object.keys(result.features)).toEqual([doc.features[0]?.id]);
  });
});

describe('B2 storage box', () => {
  it('is one body cut from a solid: 80 x 60 x 40 mm, 3 mm walls, a 4 mm floor', async () => {
    const doc = load(b2);
    expect(doc.name).toBe('B2 Storage box');
    expect(featureNames(doc)).toEqual(['Sketch1', 'Extrude1', 'Sketch2', 'Extrude2']);
    const result = await recompute(doc);
    const [box, ...others] = bodies(result);
    expect(others).toEqual([]);
    expect(box?.size).toEqual([80, 60, 40]);
    expect(box?.min).toEqual([0, 0, 0]);
    // Outside four, inside four, the floor, the bottom and the rim.
    expect(box?.faces).toBe(11);
    expect(box?.volume).toBeCloseTo(80 * 60 * 40 - 74 * 54 * 36, 3);
  });

  it('follows the parameters the extrudes read', async () => {
    const doc = withParameters(load(b2), { height: '50 mm', bottom: '6 mm' });
    const [box] = bodies(await recompute(doc));
    // The top face, the sketch on it and its cut all ride up with the height.
    expect(box?.size).toEqual([80, 60, 50]);
    expect(box?.faces).toBe(11);
    expect(box?.volume).toBeCloseTo(80 * 60 * 50 - 74 * 54 * 44, 3);
  });
});

describe('B3 phone stand', () => {
  it('is two bodies combined into one: 60 wide, 70 tall, the rest leaning back', async () => {
    const doc = load(b3);
    expect(doc.name).toBe('B3 Phone stand');
    expect(featureNames(doc)).toEqual(['Sketch1', 'Extrude1', 'Sketch2', 'Extrude2', 'Combine1']);
    // Rolled back before the Combine, the base and the rest are two bodies.
    const beforeCombine = { ...doc, timelineMarker: 4 };
    const two = bodies(await recompute(beforeCombine));
    expect(two.map((b) => b.size)).toEqual([
      [60, 80, 10],
      [60, Number((60 / Math.tan((70 * Math.PI) / 180) + 10).toFixed(3)), 60],
    ]);

    const [stand, ...others] = bodies(await recompute(doc));
    expect(others).toEqual([]);
    expect(stand?.size).toEqual([
      60,
      Number((60 + 60 / Math.tan((70 * Math.PI) / 180)).toFixed(3)),
      70,
    ]);
    // Base plate + back rest, which only touch: the volumes add up.
    expect(stand?.volume).toBeCloseTo(60 * 80 * 10 + 60 * 10 * 60, 3);
    expect(stand?.faces).toBeGreaterThan(6);
  });

  it('follows the parameters the extrudes read', async () => {
    const doc = withParameters(load(b3), { width: '80 mm' });
    const [stand, ...others] = bodies(await recompute(doc));
    expect(others).toEqual([]);
    expect(stand?.size[0]).toBe(80);
    // The rest is 80 wide now; the base plate stays 60 wide.
    expect(stand?.volume).toBeCloseTo(60 * 80 * 10 + 80 * 10 * 60, 3);
  });
});

describe('B4 box with a lid that fits', () => {
  /** The box: a block less the cavity, less the bottom chamfer (four mitred prisms). */
  const boxVolume = (length: number, width: number) =>
    length * width * 30 -
    (length - 4) * (width - 4) * 28 -
    (0.8 ** 2 * (length + width) - (4 * 0.8 ** 3) / 3);

  /**
   * How the lid sits on the box: the volume they share where it rests (none:
   * it fits), and the gap once it is lifted 1 mm off the rim, which is the
   * lip's clearance from the walls on its tightest side.
   */
  function fit() {
    const [box, lid] = result.bodies.map(({ id }) => engine.latestBody(id));
    if (!box || !lid) throw new Error('two bodies expected');
    using scope = kernel.scope();
    const common = scope.track(kernel.common(box, lid));
    const lifted = scope.track(kernel.transform(lid, translation([0, 0, 1])));
    return {
      overlap: kernel.measure(common.shape).volume,
      gap: kernel.distance(box, lifted.shape),
    };
  }

  let result: Done;

  it('is two bodies: a box shelled open and a lid whose lip is `clearance` inside it', async () => {
    const doc = load(b4);
    expect(doc.name).toBe('B4 Box with lid');
    expect(featureNames(doc)).toEqual([
      'Offset Plane1',
      'Box1',
      'Shell1',
      'Chamfer1',
      'Box2',
      'Box3',
      'Fillet1',
    ]);
    result = await recompute(doc);
    expect(bodyNames(doc, result)).toEqual(['Box', 'Lid']);
    const [box, lid] = bodies(result);
    expect(box).toMatchObject({ size: [60, 40, 30], min: [-30, -20, 0], faces: 15 });
    expect(box?.volume).toBeCloseTo(boxVolume(60, 40), 3);
    // The plate on the rim, the lip 5 mm down into the box, four fillet faces on top.
    expect(lid).toMatchObject({ size: [60, 40, 8], min: [-30, -20, 25], faces: 15 });
    const block = 60 * 40 * 3 + 55.6 * 35.6 * 5;
    // The fillets take about r² (1 − π/4) along each top edge, a little less at the corners.
    const fillet = 1.5 ** 2 * (1 - Math.PI / 4) * 200;
    expect(block - (lid?.volume ?? 0)).toBeGreaterThan(fillet * 0.95);
    expect(block - (lid?.volume ?? 0)).toBeLessThan(fillet);
    const { overlap, gap } = fit();
    expect(overlap).toBeCloseTo(0, 6);
    expect(gap).toBeCloseTo(0.2, 6);
  });

  it('still fits with another clearance and a longer box', async () => {
    const doc = withParameters(load(b4), { clearance: '0.5 mm', length: '70 mm', height: '40 mm' });
    result = await recompute(doc);
    const [box, lid] = bodies(result);
    expect(box).toMatchObject({ size: [70, 40, 40], faces: 15 });
    expect(box?.volume).toBeCloseTo(
      70 * 40 * 40 - 66 * 36 * 38 - (0.8 ** 2 * 110 - (4 * 0.8 ** 3) / 3),
      3,
    );
    // The offset plane rides up with the height, the lid on it.
    expect(lid).toMatchObject({ size: [70, 40, 8], min: [-35, -20, 35], faces: 15 });
    const { overlap, gap } = fit();
    expect(overlap).toBeCloseTo(0, 6);
    expect(gap).toBeCloseTo(0.5, 6);
  });
});

describe('B5 PCB enclosure', () => {
  const INSERT = Math.PI * 2 * 2 * 6.5;
  /** A countersunk M3 clearance hole through a lid: the hole and the 90° cone over it. */
  const countersunk = (lid: number) => {
    const [r, R] = [1.7, 3.35];
    const h = R - r;
    return (
      Math.PI * r * r * lid + (Math.PI * h * (R * R + R * r + r * r)) / 3 - Math.PI * r * r * h
    );
  };
  const trayVolume = (length: number, width: number, height: number) =>
    length * width * height -
    (length - 4) * (width - 4) * (height - 2) +
    4 * Math.PI * 3.5 * 3.5 * (height - 2) -
    4 * INSERT;

  it('is a tray with four posts and inserts, and a lid with four countersunk holes', async () => {
    const doc = load(b5);
    expect(doc.name).toBe('B5 PCB enclosure');
    expect(featureNames(doc)).toEqual([
      'Box1',
      'Shell1',
      'Cylinder1',
      'Hole1',
      'Rectangular Pattern1',
      'Box2',
      'Hole2',
      'Hole3',
      'Mirror1',
    ]);
    const result = await recompute(doc);
    expect(bodyNames(doc, result)).toEqual(['Enclosure', 'Lid']);
    const [tray, lid] = bodies(result);
    expect(tray).toMatchObject({ size: [80, 60, 25], faces: 27 });
    expect(tray?.volume).toBeCloseTo(trayVolume(80, 60, 25), 2);
    expect(lid).toMatchObject({ size: [80, 60, 3], min: [-40, -30, 25], faces: 14 });
    expect(lid?.volume).toBeCloseTo(80 * 60 * 3 - 4 * countersunk(3), 2);
  });

  it('follows the parameters: the posts stay `inset` from the corners', async () => {
    const doc = withParameters(load(b5), { length: '100 mm', height: '30 mm', lid: '4 mm' });
    const [tray, lid] = bodies(await recompute(doc));
    expect(tray).toMatchObject({ size: [100, 60, 30], faces: 27 });
    expect(tray?.volume).toBeCloseTo(trayVolume(100, 60, 30), 2);
    expect(lid).toMatchObject({ size: [100, 60, 4], min: [-50, -30, 30], faces: 14 });
    expect(lid?.volume).toBeCloseTo(100 * 60 * 4 - 4 * countersunk(4), 2);
  });
});

describe('B7 knurled knob', () => {
  /** The area two circles (radii `a`, `b`, centres `d` apart) share. */
  function lens(a: number, b: number, d: number) {
    const alpha = Math.acos((d * d + a * a - b * b) / (2 * d * a));
    const beta = Math.acos((d * d + b * b - a * a) / (2 * d * b));
    const k = Math.sqrt((-d + a + b) * (d + a - b) * (d - a + b) * (d + a + b));
    return a * a * alpha + b * b * beta - k / 2;
  }
  /**
   * The cylinder less the chamfer's ring, the grooves and the shaft hole.
   * Where a groove crosses the chamfer it removes less: under 1 mm³ each.
   */
  const knobVolume = (grooves: number, groove: number) =>
    Math.PI * 15 * 15 * 16 -
    2 * Math.PI * (15 - 1 / 3) * 0.5 -
    grooves * lens(15, groove / 2, 15) * 16 -
    Math.PI * 3 * 3 * 10;

  it('is one body: revolved, chamfered, 24 grooves, a shaft hole', async () => {
    const doc = load(b7);
    expect(doc.name).toBe('B7 Knurled knob');
    expect(featureNames(doc)).toEqual([
      'Sketch1',
      'Revolve1',
      'Chamfer1',
      'Cylinder1',
      'Circular Pattern1',
      'Hole1',
    ]);
    const result = await recompute(doc);
    expect(bodyNames(doc, result)).toEqual(['Knob']);
    const [knob] = bodies(result);
    // Top, bottom, chamfer, a rim piece and a groove wall per groove, the shaft's wall and floor.
    expect(knob?.faces).toBe(53);
    expect(knob?.size[2]).toBeCloseTo(16, 3);
    const volume = knob?.volume ?? 0;
    expect(volume).toBeGreaterThan(knobVolume(24, 1.6));
    expect(volume).toBeLessThan(knobVolume(24, 1.6) + 24);
  });

  it('follows the parameters the pattern and the groove read', async () => {
    const doc = withParameters(load(b7), { grooves: '18', groove: '1.8 mm' });
    const [knob] = bodies(await recompute(doc));
    expect(knob?.faces).toBe(3 + 2 * 18 + 2);
    const volume = knob?.volume ?? 0;
    expect(volume).toBeGreaterThan(knobVolume(18, 1.8));
    expect(volume).toBeLessThan(knobVolume(18, 1.8) + 18);
  });
});

/**
 * The wall hook's volume with its draft and without fillets: the plate, and
 * in front of it the arm and the lip, whose sides (and the arm's top) lean in
 * by `taper` from the plate's front face. Polynomials in x of degree two,
 * integrated exactly by Simpson's rule.
 */
function draftedHook(p: {
  wall: number;
  width: number;
  height: number;
  arm: number;
  reach: number;
  lip: number;
  taper: number;
}) {
  const t = Math.tan((p.taper * Math.PI) / 180);
  const width = (x: number) => p.arm - 2 * (x - p.wall) * t;
  const simpson = (a: number, b: number, f: (x: number) => number) =>
    ((b - a) / 6) * (f(a) + 4 * f((a + b) / 2) + f(b));
  const armEnd = p.reach - p.wall;
  return (
    p.wall * p.width * p.height +
    simpson(p.wall, armEnd, (x) => width(x) * (p.wall - (x - p.wall) * t)) +
    simpson(armEnd, p.reach, (x) => width(x) * p.lip)
  );
}

describe('B6 wall hook', () => {
  const sizes = { wall: 5, width: 30, height: 60, arm: 16, reach: 40, lip: 15, taper: 3 };

  it('is one body: three boxes joined, the arm drafted, fillets where edges meet', async () => {
    const doc = load(b6);
    expect(doc.name).toBe('B6 Wall hook');
    expect(featureNames(doc)).toEqual(['Box1', 'Box2', 'Box3', 'Draft1', 'Fillet1']);
    expect(doc.parameters.map((p) => [p.name, p.expression])).toEqual(
      expect.arrayContaining([
        ['reach', '40 mm'],
        ['taper', '3 deg'],
        ['radius', '2 mm'],
      ]),
    );
    // Before the draft: the three boxes make one body of 12 600 mm³.
    const [boxes, ...extra] = bodies(await recompute({ ...doc, timelineMarker: 3 }));
    expect(extra).toEqual([]);
    expect(boxes?.size.map((v) => Math.round(v * 10) / 10)).toEqual([40, 30, 60]);
    expect(boxes?.volume).toBeCloseTo(5 * 30 * 60 + 35 * 16 * 5 + 5 * 16 * 10, 3);
    // The draft keeps every face and narrows the arm towards its tip.
    const [drafted] = bodies(await recompute({ ...doc, timelineMarker: 4 }));
    expect(drafted?.faces).toBe(boxes?.faces);
    expect(drafted?.volume).toBeCloseTo(draftedHook(sizes), 3);
    // The fillets round the plate's top (four edges meeting at its corners) and fill the
    // corner under the arm: a few faces more, a little less matter.
    const [hook, ...others] = bodies(await recompute(doc));
    expect(others).toEqual([]);
    expect(hook?.size.map((v) => Math.round(v * 10) / 10)).toEqual([40, 30, 60]);
    expect(hook?.faces).toBeGreaterThan((drafted?.faces ?? 0) + 4);
    expect(Math.abs((hook?.volume ?? 0) / draftedHook(sizes) - 1)).toBeLessThan(0.01);
  });

  it('follows its parameters: a longer arm and a steeper draft', async () => {
    const doc = withParameters(load(b6), { reach: '50 mm', taper: '5 deg', radius: '1.5 mm' });
    const [hook, ...others] = bodies(await recompute(doc));
    expect(others).toEqual([]);
    expect(hook?.size.map((v) => Math.round(v * 10) / 10)).toEqual([50, 30, 60]);
    const [drafted] = bodies(await recompute({ ...doc, timelineMarker: 4 }));
    expect(drafted?.volume).toBeCloseTo(draftedHook({ ...sizes, reach: 50, taper: 5 }), 3);
  });
});
