// The P4-01 fixture for the fuzzer (`fixtures/benchmarks/p4-01-sweep-loft-coil.extrudo`):
// a sweep along a line-arc-line path with a twist and a scale, a loft from a
// square to a circle on an offset plane, a coil sized by parameters (`wire`,
// `pitch`) cut into a cylinder, and a pattern of that cut. This test checks the
// document recomputes cleanly; with `WRITE_FIXTURES=1` it (re)writes the file,
// which `fuzz.test.ts` then edits at random like the benchmark fixtures.
import {
  coilInputs,
  constructionRef,
  type Feature,
  FORMAT_NAME,
  FORMAT_VERSION,
  type GeomRef,
  loftInputs,
  originAxisRef,
  originPlaneRef,
  primitiveInputs,
  rectangularPatternInputs,
  type SketchData,
  sketchInputs,
  sweepInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { strToU8, zipSync } from 'fflate';
import { expect, it } from 'vitest';
import { Kernel } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature } from '../recompute/testing';
import { kernelFeatures } from '.';

const env =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

const sketch = (id: string, data: SketchData, plane: GeomRef): Feature => ({
  ...testFeature(id, 'sketch'),
  inputs: sketchInputs(plane, data),
});
const profileOf = (id: string, data: SketchData): GeomRef => {
  const [largest] = detectProfiles(data).sort((a, b) => b.area - a.area);
  if (!largest) throw new Error('no profile');
  return { kind: 'profile', id: `${id}/${largest.id}` };
};
const feature = (id: string, type: string, inputs: Feature['inputs']): Feature => ({
  ...testFeature(id, type),
  inputs,
});

function p401Document() {
  const disc = new SketchBuilder();
  disc.circle(0, 0, 3);
  const path = new SketchBuilder();
  const up = path.line(0, 0, 0, 30).id;
  const arc = path.arc(20, 30, 20, 90, 180).id;
  const along = path.line(20, 50, 60, 50).id;
  const square = new SketchBuilder();
  square.line(50, -10, 70, -10);
  square.line(70, -10, 70, 10);
  square.line(70, 10, 50, 10);
  square.line(50, 10, 50, -10);
  const top = new SketchBuilder();
  top.circle(60, 0, 6);
  const plane = feature('Plane', 'offsetPlane', {
    plane: { kind: 'ref', refs: [originPlaneRef('origin:xy')] },
    distance: { kind: 'expr', expr: '25 mm', unit: 'length' },
  });
  const entity = (id: string): GeomRef => ({ kind: 'sketchEntity', id: `Path/${id}` });
  const features: Feature[] = [
    sketch('Disc', disc.sketch, originPlaneRef('origin:xy')),
    sketch('Path', path.sketch, originPlaneRef('origin:xz')),
    feature(
      'Sweep',
      'sweep',
      sweepInputs([profileOf('Disc', disc.sketch)], [entity(up), entity(arc), entity(along)], {
        twist: '30 deg',
        scale: '0.6',
      }),
    ),
    sketch('Square', square.sketch, originPlaneRef('origin:xy')),
    plane,
    sketch('Top', top.sketch, constructionRef(plane) as GeomRef),
    feature(
      'Loft',
      'loft',
      loftInputs([profileOf('Square', square.sketch), profileOf('Top', top.sketch)]),
    ),
    feature(
      'Post',
      'cylinder',
      primitiveInputs('cylinder', {
        numbers: { x: '-40 mm', diameter: '20 mm', height: '40 mm' },
      }),
    ),
    feature(
      'Groove',
      'coil',
      coilInputs({
        type: 'revolutions-pitch',
        section: 'triangle-in',
        position: 'inside',
        numbers: {
          x: '-40 mm',
          offset: '4 mm',
          diameter: '20 mm',
          revolutions: '2',
          pitch: 'pitch',
          size: 'wire',
        },
        operation: 'cut',
      }),
    ),
    feature(
      'Grooves',
      'rectangularPattern',
      rectangularPatternInputs({
        features: ['Groove'],
        direction1: originAxisRef('origin:z'),
        count1: '2',
        distance1: '18 mm',
      }),
    ),
  ];
  return testDocument(features, { wire: '2 mm', pitch: '4 mm' });
}

it('the P4-01 fixture recomputes cleanly', { timeout: 120_000 }, async () => {
  const kernel = new Kernel(await loadOcct());
  const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
  const doc = p401Document();
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error('cancelled');
  for (const [id, s] of Object.entries(result.features)) {
    expect(s.status, `${id}: ${s.message ?? ''}`).toBe('ok');
  }
  expect(result.bodies.map((b) => b.id)).toEqual(['Sweep:0', 'Loft:0', 'Post:0']);
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
  if (env.WRITE_FIXTURES === '1') {
    // The kernel's tsconfig has no Node types: a module name in a variable keeps tsc out of it.
    const nodeFs = 'node:fs';
    const fs = (await import(/* @vite-ignore */ nodeFs)) as {
      writeFileSync(path: URL, data: Uint8Array): void;
    };
    const json = (value: unknown) => strToU8(`${JSON.stringify(value, null, 2)}\n`);
    const manifest = {
      format: FORMAT_NAME,
      formatVersion: FORMAT_VERSION,
      appVersion: doc.meta.appVersion,
      created: doc.meta.created,
      units: doc.settings.units,
    };
    const bytes = zipSync({ 'manifest.json': json(manifest), 'document.json': json(doc) });
    fs.writeFileSync(
      new URL('../../../../fixtures/benchmarks/p4-01-sweep-loft-coil.extrudo', import.meta.url),
      bytes,
    );
  }
});
