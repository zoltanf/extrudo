// Insert Design (P6-26, ADR-0140) with real OCCT: a copied design expands
// after its insert under IDs of its own, its numbers come from its own
// parameters, its features see only the bodies it made, and a change before
// the insert recomputes none of them.
import {
  type AttachmentId,
  applyCommand,
  type ComponentId,
  type ExtrudoDocument,
  extrudeInputs,
  type FeatureId,
  type GeomRef,
  insertDesign,
  insertDesignPayload,
  loadDocument,
  originPlaneRef,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { readArchive, writeArchive } from '@extrudo/storage';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import b4 from '../../../../fixtures/benchmarks/b4-box-with-lid.extrudo?url&inline';
import b5 from '../../../../fixtures/benchmarks/b5-pcb-enclosure.extrudo?url&inline';
import b10 from '../../../../fixtures/benchmarks/b10-chain-link.extrudo?url&inline';
import hinge from '../../../../fixtures/components/hinge.extrudo?url&inline';
import { Kernel } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature } from '../recompute/testing';
import type { RecomputeResult } from '../recompute/types';
import { kernelFeatures } from '.';

type Done = Extract<RecomputeResult, { status: 'done' }>;

let kernel: Kernel;
let engine: RecomputeEngine;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
});

afterAll(() => {
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

const INSERT = 'ins' as FeatureId;
const COMPONENT = 'cmp-ins' as ComponentId;

function fixture(dataUrl: string): ExtrudoDocument {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const files = unzipSync(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  const json = files['document.json'];
  if (!json) throw new Error('no document.json');
  return loadDocument(JSON.parse(strFromU8(json))).doc;
}

/** `host` with `source` inserted at its end. */
function inserted(host: ExtrudoDocument, source: ExtrudoDocument, name = 'Part'): ExtrudoDocument {
  const payload = insertDesignPayload(
    host,
    source,
    { feature: INSERT, component: COMPONENT, attachment: () => 'att-new' as AttachmentId },
    name,
  );
  return applyCommand(host, insertDesign(payload)).doc;
}

async function run(doc: ExtrudoDocument): Promise<Done> {
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error('cancelled');
  for (const [id, s] of Object.entries(result.features)) {
    if (s.status !== 'ok') throw new Error(`${id}: ${s.status} ${s.message ?? ''}`);
  }
  return result;
}

function volumes(result: Done): Record<string, number> {
  return Object.fromEntries(
    result.bodies.map(({ id }) => {
      const shape = engine.latestBody(id);
      if (!shape) throw new Error(`no body ${id}`);
      return [id, Math.round(kernel.measure(shape).volume)];
    }),
  );
}

/** A 60 × 40 block on XY, `height` high (sketch `S`, extrude `E`), then more features. */
function block(height: string, more: ReturnType<typeof testFeature>[] = []) {
  const b = new SketchBuilder();
  b.line(0, 0, 60, 0);
  b.line(60, 0, 60, 40);
  b.line(60, 40, 0, 40);
  b.line(0, 40, 0, 0);
  const [profile] = detectProfiles(b.sketch);
  if (!profile) throw new Error('no profile');
  const ref: GeomRef = { kind: 'profile', id: `S/${profile.id}` };
  return {
    ref,
    features: [
      {
        ...testFeature('S', 'sketch'),
        inputs: sketchInputs(originPlaneRef('origin:xy'), b.sketch),
      },
      { ...testFeature('E', 'extrude'), inputs: extrudeInputs([ref], { distance: height }) },
      ...more,
    ],
  };
}

describe('Insert Design (ADR-0140)', () => {
  // Faces, edges, a construction plane, holes, a mirror, patterns, a sweep and
  // components: every reference kind the copy rewrites, against the same IDs.
  it.each([
    ['B4 box with lid', b4],
    ['B5 PCB enclosure', b5],
    ['B10 chain link', b10],
    ['the hinge', hinge],
  ])(
    'inserts %s into itself: the same IDs and parameter names, every body twice',
    async (_name, file) => {
      const design = fixture(file);
      const own = volumes(await run(design));
      expect(Object.keys(own).length).toBeGreaterThan(0);
      const after = await run(inserted(design, design));
      const both = volumes(after);
      expect(Object.keys(both)).toHaveLength(Object.keys(own).length * 2);
      for (const [id, volume] of Object.entries(own)) {
        expect(volume).toBeGreaterThan(0);
        expect(both[id]).toBe(volume);
        expect(both[`${INSERT}.${id}`]).toBe(volume);
      }
      // The insert's own status lists what it made, each under the insert's ID.
      const status = after.features[INSERT];
      expect(status?.status).toBe('ok');
      expect(status?.script?.generated.map((g) => g.id)).toEqual(
        design.features.slice(0, design.timelineMarker).map((f) => `${INSERT}.${f.id}`),
      );
    },
  );

  it('comes back from a saved .extrudo file with the same bodies', async () => {
    const box = fixture(b4);
    const doc = inserted(box, box);
    const before = volumes(await run(doc));
    const reread = readArchive(writeArchive(doc, undefined, [], new Map())).doc;
    expect(reread).toEqual(doc);
    engine.clear();
    expect(volumes(await run(reread))).toEqual(before);
  });

  it("evaluates the copy's numbers with its own parameters, never the host's", async () => {
    const host = { ...testDocument(block('h').features, { h: '10 mm' }) };
    const source = { ...testDocument(block('h').features, { h: '30 mm' }), name: 'Tall' };
    const result = await run(inserted(host, source));
    expect(volumes(result)).toEqual({ 'E:0': 60 * 40 * 10, [`${INSERT}.E:0`]: 60 * 40 * 30 });
  });

  it("keeps the copy's features to its own bodies: a join never reaches the host's", async () => {
    const host = testDocument(block('10 mm').features);
    // The copy's second extrude joins whatever it touches: in the host, both blocks.
    const { ref, features } = block('10 mm');
    const join = {
      ...testFeature('J', 'extrude'),
      inputs: extrudeInputs([ref], { distance: '25 mm', operation: 'join' }),
    };
    const source = testDocument([...features, join]);
    const result = await run(inserted(host, source));
    expect(volumes(result)).toEqual({ 'E:0': 60 * 40 * 10, [`${INSERT}.E:0`]: 60 * 40 * 25 });
  });

  it('recomputes none of the copy when something before the insert changes', async () => {
    const host = testDocument(block('h').features, { h: '10 mm' });
    const doc = inserted(host, testDocument(block('20 mm').features));
    await run(doc);
    const changed = {
      ...doc,
      parameters: [{ ...(doc.parameters[0] as (typeof doc.parameters)[0]), expression: '12 mm' }],
    };
    const result = await run(changed);
    expect(result.stats.evaluated.filter((id) => id.startsWith(`${INSERT}.`))).toEqual([]);
    expect(volumes(result)).toEqual({ 'E:0': 60 * 40 * 12, [`${INSERT}.E:0`]: 60 * 40 * 20 });
  });
});
