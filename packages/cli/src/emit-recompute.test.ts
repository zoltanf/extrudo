/**
 * The macro emitter recomputed (P5-05 slice 1, ADR-0073 §3): every benchmark
 * fixture and the script fixture is emitted, the code is run to build a new
 * design, and both designs are recomputed with the real OCCT kernel and
 * compared body by body. The document round trip itself is the API package's
 * own `emit.test.ts`; this is the proof that the geometry the emitted code
 * describes is the same geometry, including the script fixture, which needs
 * the runner this package may hold (ADR-0070).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Design, emitScript } from '@extrudo/api';
import type { ExtrudoDocument } from '@extrudo/core';
import { readArchive } from '@extrudo/storage';
import { describe, expect, it } from 'vitest';
import { type BodyReport, openDesign } from './headless';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Every fixture design, loaded through the archive reader. */
function fixtures(): [name: string, path: string, doc: ExtrudoDocument][] {
  const read = (folder: string) =>
    readdirSync(join(ROOT, 'fixtures', folder))
      .filter((name) => name.endsWith('.extrudo'))
      .sort()
      .map((name) => {
        const path = join(ROOT, 'fixtures', folder, name);
        return [name, path, readArchive(readFileSync(path)).doc] as [
          string,
          string,
          ExtrudoDocument,
        ];
      });
  return [...read('benchmarks'), ...read('scripts'), ...read('components')];
}

/** Runs emitted code to build the design it describes. */
async function recreated(doc: ExtrudoDocument, code: string) {
  const design = Design.create({ units: doc.settings.units, now: '2026-10-06T00:00:00.000Z' });
  const call = new Function('design', code) as (design: Design) => void;
  call(design);
  return { design, bytes: await design.toFile() };
}

/** A body's box and face count, for the comparison (volume is compared relatively). */
const shapeOf = (body: BodyReport) => ({
  min: body.min.map((v) => Number(v.toFixed(4))),
  size: body.size.map((v) => Number(v.toFixed(4))),
  faces: body.faces,
});

describe.each(fixtures())('%s', (name, path, doc) => {
  it('emits, runs and recomputes to the same bodies', { timeout: 300_000 }, async () => {
    const started = Date.now();
    const code = emitScript(doc);
    const emitMs = Date.now() - started;
    const { bytes } = await recreated(doc, code);

    const original = (await openDesign(path)).job;
    const emitted = (await openDesign(bytes)).job;
    try {
      const before = await original.compute();
      const after = await emitted.compute();
      expect(
        after.errors,
        `${name}: ${JSON.stringify(after.features.filter((f) => f.status === 'error'))}`,
      ).toBe(0);
      expect(after.bodies.length).toBe(before.bodies.length);
      before.bodies.forEach((body, index) => {
        const other = after.bodies[index] as BodyReport;
        // A relative check: `toBeCloseTo` is absolute.
        expect(
          Math.abs(other.volume - body.volume) / Math.max(body.volume, 1),
          `${name} body ${index}`,
        ).toBeLessThan(1e-6);
        expect(shapeOf(other)).toEqual(shapeOf(body));
      });
      console.log(
        `${name}: emitted in ${emitMs} ms, recomputed ${before.ms.toFixed(0)} / ${after.ms.toFixed(0)} ms`,
      );
    } finally {
      await original.dispose();
      await emitted.dispose();
    }
  });
});
