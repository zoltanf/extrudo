// The annotations example (ADR-0126 S4): a small bracket plate with four notes, on a face, on
// an edge, on a sketch circle (done) and in space, built through the API with the kernel's
// fingerprints so each note follows its geometry. With `WRITE_FIXTURES=1` this test (re)writes
// `fixtures/benchmarks/annotated-plate.extrudo` (the examples gallery bundles that folder);
// without it, it checks the file holds the same timeline and notes the code builds.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Design } from '@extrudo/api';
import type { AnnotationId, GeomFingerprint, GeomRef } from '@extrudo/core';
import { Kernel } from '@extrudo/kernel';
import { kernelFeatures, loadOcct, RecomputeEngine } from '@extrudo/kernel/node';
import { readArchive } from '@extrudo/storage';
import { describe, expect, it } from 'vitest';
import { openDesign } from './headless';

const FILE = fileURLToPath(
  new URL('../../../fixtures/benchmarks/annotated-plate.extrudo', import.meta.url),
);

/** The plate, a boss's sketch on its top, and the notes' references (no fingerprints yet). */
function plate(fingerprints: Record<string, GeomFingerprint> = {}) {
  // UUID-shaped IDs as the app makes them, but the same every run (the fixture is compared).
  let n = 0;
  const ids = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const d = Design.create({
    name: 'Annotated plate',
    units: 'mm',
    now: '2026-11-04T00:00:00.000Z',
    ids,
  });
  d.parameter('thickness', '6 mm');
  const box = d.box({ length: '60 mm', width: '40 mm', height: 'thickness' }, { name: 'Plate' });
  const top = box.face('cap:end');
  let boss = '';
  const sketch = d.sketch(
    top,
    (k) => {
      boss = k.circle([15, 0], 3).id;
    },
    { name: 'Boss' },
  );
  const edge = box.edge([box.faceName('cap:end'), box.faceName('side:front')]);
  const refs: Record<string, GeomRef> = { top, edge };
  d.annotate('Countersink the screw holes for M4.', top, {
    at: [-15, 0, 6],
    ...(fingerprints.top && { fingerprint: fingerprints.top }),
  });
  d.annotate('Round this edge, 2 mm.', edge, {
    ...(fingerprints.edge ? { fingerprint: fingerprints.edge } : { at: [0, -20, 6] }),
  });
  d.annotate(
    'Boss here: 6 mm across, 8 mm tall.',
    { sketch, at: [0, 0], entity: boss },
    { done: true },
  );
  d.annotate('Print with this side down.', [0, 0, -12]);
  return { d, refs };
}

describe('the annotations example', () => {
  it('builds, computes, every note on its geometry, and matches the fixture', {
    timeout: 120_000,
  }, async () => {
    // The kernel's fingerprints for the face and the edge, as the app stores them.
    const { d: draft, refs } = plate();
    const engine = new RecomputeEngine(new Kernel(await loadOcct()), kernelFeatures());
    const fingerprints: Record<string, GeomFingerprint> = {};
    try {
      const result = await engine.recompute({ doc: draft.toJSON() });
      expect(result.status).toBe('done');
      for (const [key, ref] of Object.entries(refs)) {
        const report = engine.resolveAnnotation({
          id: 'probe' as AnnotationId,
          number: 1,
          text: 'probe',
          anchor: { kind: 'model', ref: ref as never, at: [0, 0, 0] },
        });
        expect(report.status, key).toBe('ok');
        const print = report.resolved?.ref.fingerprint;
        if (!print) throw new Error(`no fingerprint for ${key}`);
        fingerprints[key] = print;
      }
    } finally {
      engine.clear();
    }
    const { d } = plate(fingerprints);
    const bytes = await d.toFile();
    if (process.env.WRITE_FIXTURES) await writeFile(FILE, bytes);
    // The checked-in file: the document the code builds (its dates aside), and on opening,
    // every feature computes and every note sits on its geometry.
    const checkedIn = new Uint8Array(await readFile(FILE));
    const { meta: _stored, ...stored } = readArchive(checkedIn).doc;
    const { meta: _built, ...built } = d.toJSON();
    expect(stored).toEqual(built);
    const { job } = await openDesign(checkedIn);
    try {
      const computed = await job.compute();
      expect(computed.features.filter((f) => f.status !== 'ok')).toEqual([]);
      expect(computed.annotations.map((a) => `${a.number}:${a.status}`)).toEqual([
        '1:ok',
        '2:ok',
        '3:ok',
        '4:ok',
      ]);
    } finally {
      await job.dispose();
    }
  });
});
