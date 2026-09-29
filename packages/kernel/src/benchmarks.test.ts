// The benchmark designs of requirements §7 as fixtures (P2-17): the
// `.extrudo` files under `fixtures/benchmarks/` are what the e2e specs
// (`e2e/benchmark-b1.spec.ts` to `-b3`) build through the UI and export
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
import { kernelFeatures } from './features';
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

/** Size, volume and face count of each body, in creation order. */
function bodies(result: Done) {
  return result.bodies.map(({ id, mesh }) => {
    const shape = engine.latestBody(id);
    if (!shape || !mesh) throw new Error(`no body ${id}`);
    const { volume, bbox } = kernel.measure(shape);
    return {
      size: bbox.max.map((v, k) => Number((v - (bbox.min[k] as number)).toFixed(3))),
      min: bbox.min.map((v) => Number(v.toFixed(3)) + 0),
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
  it('is two bodies joined into one: 60 wide, 70 tall, the rest leaning back', async () => {
    const doc = load(b3);
    expect(doc.name).toBe('B3 Phone stand');
    expect(featureNames(doc)).toEqual([
      'Sketch1',
      'Extrude1',
      'Sketch2',
      'Extrude2',
      'Sketch3',
      'Extrude3',
    ]);
    // Rolled back before the joining extrude, the base and the rest are two bodies.
    const beforeJoin = { ...doc, timelineMarker: 4 };
    const two = bodies(await recompute(beforeJoin));
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
    expect(stand?.faces).toBe(14);
    // Base plate + back rest + the strip across its foot, less where they overlap.
    expect(stand?.volume).toBeCloseTo(60 * 80 * 10 + 60 * 10 * 60 + 60 * 30 * 4 - 60 * 10 * 4, 3);
  });

  it('follows the parameters the extrudes read', async () => {
    const doc = withParameters(load(b3), { width: '80 mm', brace: '6 mm' });
    const [stand, ...others] = bodies(await recompute(doc));
    expect(others).toEqual([]);
    expect(stand?.size[0]).toBe(80);
    expect(stand?.faces).toBeGreaterThan(0);
    // The rest is 80 wide now; the strip stays as wide as the base (60).
    expect(stand?.volume).toBeCloseTo(60 * 80 * 10 + 80 * 10 * 60 + 60 * 30 * 6 - 60 * 10 * 6, 3);
  });
});
