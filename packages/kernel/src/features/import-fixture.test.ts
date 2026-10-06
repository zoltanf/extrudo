// The P4-06 STEP fixture (`fixtures/imports/b3.step`): the two bodies of the
// B3 phone stand (ADR-0039), written through the kernel's own `writeStep`, so
// `features/import.test.ts` and `e2e/import-step.spec.ts` import a real STEP
// file that Extrudo wrote of its own geometry. Rolled back before the Combine,
// it is two bodies that only touch — which is what makes an import worth
// testing: `splitSolids` gives one body per solid.
//
// This test recomputes B3, checks the two bodies it writes, and with
// `WRITE_FIXTURES=1` rewrites the file.
import { type ExtrudoDocument, loadDocument } from '@extrudo/core';
import { strFromU8, unzipSync } from 'fflate';
import { expect, it } from 'vitest';
import b3 from '../../../../fixtures/benchmarks/b3-phone-stand.extrudo?url&inline';
import b3Step from '../../../../fixtures/imports/b3.step?url&inline';
import { Kernel } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { kernelFeatures } from '.';

const env =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** The bytes of a `data:` URL (Vite's `?url&inline` import of a binary file). */
function bytesOf(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** A STEP file's DATA section: everything but the header's time stamp. */
function dataSection(text: string): string {
  return text.slice(text.indexOf('DATA;'));
}

/** The document inside an `.extrudo` fixture, loaded through core's migrations. */
function load(dataUrl: string): ExtrudoDocument {
  const files = unzipSync(bytesOf(dataUrl));
  const json = files['document.json'];
  if (!json) throw new Error('no document.json');
  return loadDocument(JSON.parse(strFromU8(json))).doc;
}

it("writes the P4-06 STEP fixture from B3's two bodies", { timeout: 120_000 }, async () => {
  const kernel = new Kernel(await loadOcct());
  const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
  // Rolled back before the Combine: the base plate and the back rest, two
  // separate bodies.
  const doc: ExtrudoDocument = { ...load(b3), timelineMarker: 4 };
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error('cancelled');
  const byName = (id: string) => {
    const feature = doc.features.find((f) => f.name === id);
    const body = result.bodies.find((b) => b.id.startsWith(`${feature?.id}:`));
    if (!feature || !body) throw new Error(`no body from ${id}`);
    return body.id;
  };
  expect(result.bodies.map((b) => b.id)).toEqual([byName('Extrude1'), byName('Extrude2')]);
  const shapes = result.bodies.map(({ id }) => {
    const shape = engine.latestBody(id);
    if (shape === undefined) throw new Error(`no body ${id}`);
    return shape;
  });
  // The base plate and the back rest: 60 x 80 x 10 and 60 x 10 x 60 mm.
  const volumes = shapes.map((shape) => kernel.measure(shape).volume);
  expect(volumes[0]).toBeCloseTo(60 * 80 * 10, 6);
  expect(volumes[1]).toBeCloseTo(60 * 10 * 60, 6);

  const text = kernel.writeStep(
    shapes.map((shape, i) => ({ shape, name: i === 0 ? 'Stand base' : 'Stand rest' })),
  );
  expect(text).toContain('ISO-10303-21');
  // Uncoloured bodies take the plain writer, byte for byte what it wrote
  // before STEP colours (P4-12): the fixture's data section is the old
  // writer's (the header carries the time it was written).
  expect(text).not.toContain('COLOUR_RGB');
  expect(dataSection(text)).toBe(dataSection(new TextDecoder('latin1').decode(bytesOf(b3Step))));
  if (env.WRITE_FIXTURES === '1') {
    // The kernel's tsconfig has no Node types: a module name in a variable
    // keeps tsc out of it.
    const nodeFs = 'node:fs';
    const fs = (await import(/* @vite-ignore */ nodeFs)) as {
      writeFileSync(path: URL, data: Uint8Array): void;
    };
    fs.writeFileSync(
      new URL('../../../../fixtures/imports/b3.step', import.meta.url),
      new TextEncoder().encode(text),
    );
  }
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});
