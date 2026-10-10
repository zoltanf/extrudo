// The hinge fixture of P6-05's joints (`fixtures/components/hinge.extrudo`,
// ADR-0081 §4): two components and a revolute joint between the leaf's hole
// wall and the pin's wall. This test checks the document recomputes cleanly
// and the joint resolves; with `WRITE_FIXTURES=1` it (re)writes the file, with
// the frames' fingerprints, which the e2e spec opens and the fuzzer edits.
import { FORMAT_NAME, FORMAT_VERSION, type GeomRef, loadDocument } from '@extrudo/core';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { expect, it } from 'vitest';
import fixture from '../../../../fixtures/components/hinge.extrudo?url&inline';
import { kernelFeatures } from '../features';
import { Kernel } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { HINGE, HOLE_WALL, hingeDocument, PIN_WALL } from './testing';

const env =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

it('the hinge fixture recomputes cleanly and its joint resolves', {
  timeout: 120_000,
}, async () => {
  const kernel = new Kernel(await loadOcct());
  const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
  const doc = hingeDocument();
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error('cancelled');
  for (const [id, s] of Object.entries(result.features)) {
    expect(s.status, `${id}: ${s.message ?? ''}`).toBe('ok');
  }
  expect(result.bodies.map((b) => b.id)).toEqual(['LeafPlate:0', 'BasePlate:0']);
  expect(result.joints?.[HINGE.id]?.status).toBe('ok');
  // The frames as a pick stores them: the persistent name and a fingerprint.
  const pick = (body: 'LeafPlate:0' | 'BasePlate:0', ref: GeomRef): GeomRef => {
    const mesh = result.bodies.find((b) => b.id === body)?.mesh;
    const index = mesh?.faceIds?.indexOf(ref.id) ?? -1;
    const picked = engine.reference(body as never, 'face', index);
    if (!picked) throw new Error(`no ${ref.id}`);
    return picked;
  };
  const stored = {
    ...doc,
    joints: [
      {
        ...HINGE,
        a: { ...HINGE.a, ref: pick('LeafPlate:0', HOLE_WALL) },
        b: { ...HINGE.b, ref: pick('BasePlate:0', PIN_WALL) },
      },
    ],
  };
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
  const json = (value: unknown) => strToU8(`${JSON.stringify(value, null, 2)}\n`);
  if (env.WRITE_FIXTURES === '1') {
    // The kernel's tsconfig has no Node types: a module name in a variable keeps tsc out of it.
    const nodeFs = 'node:fs';
    const fs = (await import(/* @vite-ignore */ nodeFs)) as {
      writeFileSync(path: URL, data: Uint8Array): void;
    };
    const manifest = {
      format: FORMAT_NAME,
      formatVersion: FORMAT_VERSION,
      appVersion: stored.meta.appVersion,
      created: stored.meta.created,
      units: stored.settings.units,
    };
    const bytes = zipSync({ 'manifest.json': json(manifest), 'document.json': json(stored) });
    fs.writeFileSync(
      new URL('../../../../fixtures/components/hinge.extrudo', import.meta.url),
      bytes,
    );
    return;
  }
  // The checked-in file is this document.
  const binary = atob(fixture.slice(fixture.indexOf(',') + 1));
  const files = unzipSync(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  const text = files['document.json'];
  if (!text) throw new Error('no document.json');
  expect(loadDocument(JSON.parse(strFromU8(text))).doc).toEqual(stored);
});
