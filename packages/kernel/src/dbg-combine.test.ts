import {
  type AttachmentId,
  type BodyId,
  combineInputs,
  type ExtrudoDocument,
  importInputs,
  primitiveInputs,
} from '@extrudo/core';
import { beforeAll, expect, it } from 'vitest';
import cubeStl from '../../../fixtures/imports/cube.stl?url&inline';
import { kernelFeatures } from './features';
import { Kernel } from './kernel';
import { loadManifold } from './manifold';
import { loadOcct } from './occt/load';
import { RecomputeEngine } from './recompute/engine';
import { testDocument, testFeature } from './recompute/testing';

let kernel: Kernel;
let engine: RecomputeEngine;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  kernel.enableMeshes(await loadManifold());
  const bytes = Uint8Array.from(atob(cubeStl.slice(cubeStl.indexOf(',') + 1)), (c) =>
    c.charCodeAt(0),
  );
  engine = new RecomputeEngine(kernel, kernelFeatures(), {
    files: () => ({ bytes, mediaType: 'model/stl', fileName: 'cube.stl' }) as never,
  });
});

it('previews a combine of a solid target and a mesh tool', { timeout: 120_000 }, async () => {
  const doc: ExtrudoDocument = {
    ...testDocument([
      {
        ...testFeature('Import1', 'import'),
        inputs: importInputs({ file: 'file-1' as AttachmentId }),
      },
      {
        ...testFeature('Box1', 'box'),
        inputs: primitiveInputs('box', {
          numbers: { length: '10 mm', width: '10 mm', height: '10 mm', x: '20 mm', y: '10 mm' },
        }),
      },
    ]),
    attachments: {
      ['file-1' as AttachmentId]: {
        name: 'cube',
        fileName: 'cube.stl',
        mediaType: 'model/stl',
        sha256: 'c'.repeat(64),
        size: 10,
      },
    },
  };
  const done = await engine.recompute({ doc });
  if (done.status !== 'done') throw new Error('cancelled');
  console.warn('bodies', done.bodies.map((b) => b.id).join(' '));
  const draft = {
    ...testFeature('Combine1', 'combine'),
    inputs: combineInputs('Box1:0', ['Import1:0'], { operation: 'join' as const }),
  };
  const preview = await engine.preview({ doc, draft, index: doc.features.length });
  if (preview.status !== 'done') throw new Error('cancelled');
  console.warn('preview', JSON.stringify(preview.features));
  const committed = await engine.recompute({
    doc: { ...doc, features: [...doc.features, draft], timelineMarker: doc.features.length + 1 },
  });
  if (committed.status !== 'done') throw new Error('cancelled');
  console.warn('committed', JSON.stringify(committed.features));
  for (const body of committed.bodies) {
    const shape = engine.latestBody(body.id as BodyId);
    console.warn('body', body.id, kernel.measure(shape as never).volume);
  }
  expect(true).toBe(true);
});
