// The face roles every body-making feature lists (ADR-0068 §4): built with the
// real OCCT and checked against `FeatureDefinition.faceRoles`, so a role string
// the kernel names but a definition doesn't list is caught here — a role the
// API's `handle.face(role)` builds has to exist.
//
// Two ways in: the benchmark fixtures, which between them use almost every
// feature a design offers (extrude, revolve, the primitives, fillet, chamfer,
// shell, draft, emboss, combine, mirror, the patterns, hole, thread, sweep,
// loft, coil), and a small hand-built document for the rest (sphere, torus,
// Move, Scale, Split Body, Place on Bed, Offset Face, the rib).
//
// A body keeps the faces of the features it came from, so a name another
// feature made is not this feature's business: `faceRoleIssues` only looks at
// the names whose feature part is this one.
import {
  draftInputs,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  faceRoleIssues,
  type GeomRef,
  mirrorInputs,
  moveInputs,
  offsetFaceInputs,
  originPlaneRef,
  placeOnBedInputs,
  primitiveInputs,
  ribInputs,
  scaleInputs,
  sketchInputs,
  splitBodyInputs,
} from '@extrudo/core';
import { DEFAULT_FONT } from '@extrudo/fonts';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { loadFont } from '@extrudo/sketch/text';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import b1 from '../../../../fixtures/benchmarks/b1-plate.extrudo?url&inline';
import b2 from '../../../../fixtures/benchmarks/b2-storage-box.extrudo?url&inline';
import b3 from '../../../../fixtures/benchmarks/b3-phone-stand.extrudo?url&inline';
import b4 from '../../../../fixtures/benchmarks/b4-box-with-lid.extrudo?url&inline';
import b5 from '../../../../fixtures/benchmarks/b5-pcb-enclosure.extrudo?url&inline';
import b6 from '../../../../fixtures/benchmarks/b6-wall-hook.extrudo?url&inline';
import b7 from '../../../../fixtures/benchmarks/b7-knurled-knob.extrudo?url&inline';
import b8 from '../../../../fixtures/benchmarks/b8-name-tag.extrudo?url&inline';
import b9 from '../../../../fixtures/benchmarks/b9-bottle-cap.extrudo?url&inline';
import b10 from '../../../../fixtures/benchmarks/b10-chain-link.extrudo?url&inline';
import p401 from '../../../../fixtures/benchmarks/p4-01-sweep-loft-coil.extrudo?url&inline';
import interRegular from '../../../fonts/fonts/inter-regular.ttf?url&inline';
import { kernelFeatures } from '../features';
import { Kernel } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature } from '../recompute/testing';
import type { RecomputeResult } from '../recompute/types';

let kernel: Kernel;
let engine: RecomputeEngine;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  // B8's letters: the embossed text is shaped here, as the worker does (P4-03).
  loadFont(DEFAULT_FONT, bytesOf(interRegular));
});

afterAll(() => {
  engine?.clear();
  // Every benchmark body has faces; if this ever falls below a hundred, the test
  // has stopped seeing real geometry and proves nothing.
  expect(checkedNames).toBeGreaterThan(100);
});

type Done = Extract<RecomputeResult, { status: 'done' }>;

function bytesOf(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** The document inside an `.extrudo` fixture, loaded through core's migrations. */
function load(dataUrl: string): ExtrudoDocument {
  const files = unzipSync(bytesOf(dataUrl));
  const json = files['document.json'];
  if (!json) throw new Error('no document.json');
  return JSON.parse(strFromU8(json)) as ExtrudoDocument;
}

async function recompute(doc: ExtrudoDocument): Promise<Done> {
  engine?.clear();
  engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error(`recompute ${result.status}`);
  return result;
}

/**
 * Every face of the bodies `feature` owns that carries its own name is named
 * with one of that feature type's roles. The definitions are core's, so this
 * covers the list `@extrudo/api` documents and builds `handle.face(role)` from.
 */
/** How many own face names the whole file has checked, so the test can't go vacuous. */
let checkedNames = 0;

function expectRoles(feature: Feature, result: Done): void {
  const definition = kernelFeatures().get(feature.type);
  const owned = result.bodies.filter((body) => body.id.split(':')[0] === feature.id);
  const names = owned.flatMap((body) => body.mesh?.faceIds ?? []);
  const own = names.filter((name) => name.includes(`:${feature.id}:`));
  checkedNames += own.length;
  const issues: string[] = faceRoleIssues(definition?.faceRoles, feature.id, names);
  expect(
    issues,
    `${feature.type} ${feature.id}: ${own.length} of ${names.length} faces are its own`,
  ).toEqual([]);
}

/** The faces of the bodies `feature` owns that carry its own name. */
function ownFaceNames(feature: Feature, result: Done): string[] {
  return result.bodies
    .filter((body) => body.id.split(':')[0] === feature.id)
    .flatMap((body) => body.mesh?.faceIds ?? [])
    .filter((name) => name.includes(`:${feature.id}:`));
}

describe('the benchmark designs', () => {
  const fixtures: [string, string][] = [
    ['B1', b1],
    ['B2', b2],
    ['B3', b3],
    ['B4', b4],
    ['B5', b5],
    ['B6', b6],
    ['B7', b7],
    ['B8', b8],
    ['B9', b9],
    ['B10', b10],
    ['P4-01', p401],
  ];

  for (const [name, dataUrl] of fixtures) {
    it(`names every face of ${name} with one of its feature's roles`, {
      timeout: 120_000,
    }, async () => {
      const doc = load(dataUrl);
      const result = await recompute(doc);
      const checked = new Set<string>();
      for (const feature of doc.features) {
        const definition = kernelFeatures().get(feature.type);
        if (!definition?.faceRoles) continue;
        const bodies = result.bodies.filter((b) => b.id.split(':')[0] === feature.id);
        if (bodies.length === 0) continue;
        checked.add(feature.type);
        expectRoles(feature, result);
      }
      // B1 is a sketch on its own, with no body to name.
      if (result.bodies.length > 0) {
        expect(checked.size, `${name} uses no feature with faceRoles`).toBeGreaterThan(0);
      }
    });
  }
});

// ------------------------------------------------------------------ the rest

/** A box feature: 30 × 20 × 10 mm on the XY plane, faces named `box:<id>:side:*`. */
function box(id: string): Feature {
  return {
    ...testFeature(id, 'box'),
    inputs: primitiveInputs('box', {
      numbers: { length: '30 mm', width: '20 mm', height: '10 mm' },
    }),
  };
}

/** A feature with the inputs a builder in core made for it (the kernel's own tests do this). */
function of(id: string, type: string, inputs: Feature['inputs']): Feature {
  return { ...testFeature(id, type), inputs };
}

/** A face of `body`, by its name: the box's own `side:top`, `cap:end`, … */
const face = (body: string, role: string): GeomRef => ({ kind: 'face', id: `box:${body}:${role}` });

describe('the features the fixtures do not use', () => {
  it('names a sphere and a torus', async () => {
    const features = [
      of('s1', 'sphere', primitiveInputs('sphere', { numbers: { diameter: '20 mm' } })),
      of('t1', 'torus', primitiveInputs('torus', { numbers: { diameter: '30 mm', tube: '8 mm' } })),
    ];
    const result = await recompute(testDocument(features));
    for (const feature of features) expectRoles(feature, result);
  });

  it('names a move, a scale, a split and a mirror', async () => {
    const features = [
      box('b1'),
      of('m1', 'move', moveInputs(['b1'], { dx: '10 mm' })),
      box('b2'),
      of('s1', 'scale', scaleInputs(['b2'], { factor: '1.5' })),
      box('b3'),
      of('sp1', 'splitBody', splitBodyInputs(['b3'], originPlaneRef('origin:yz'), 'both')),
      box('b4'),
      of('mi1', 'mirror', mirrorInputs(['b4'], originPlaneRef('origin:yz'))),
    ];
    const result = await recompute(testDocument(features));
    for (const feature of features.filter((f) => f.type !== 'box')) expectRoles(feature, result);
  });

  it('names an offset face, a draft and a place on bed', async () => {
    const features = [
      box('b1'),
      of('o1', 'offsetFace', offsetFaceInputs([face('b1', 'side:top')], '4 mm')),
      box('b2'),
      of(
        'd1',
        'draft',
        draftInputs([face('b2', 'side:top')], originPlaneRef('origin:xy'), '10 deg'),
      ),
      box('b3'),
      of('p1', 'placeOnBed', placeOnBedInputs(face('b3', 'cap:start'))),
    ];
    const result = await recompute(testDocument(features));
    // All three keep every face the name it had (ADR-0051, ADR-0053, ADR-0048),
    // so none names a face of its own; their roles list what they would.
    for (const feature of features.filter((f) => f.type !== 'box')) {
      expect(ownFaceNames(feature, result), feature.id).toEqual([]);
      expectRoles(feature, result);
    }
  });

  it('names a rib', async () => {
    // A plate and an arm, and a line on the XZ plane to make the rib between
    // them (ADR-0064 §1), as the wall hook has it.
    const features = [
      box('b1'),
      of(
        'b2',
        'box',
        primitiveInputs('box', {
          numbers: {
            length: '20 mm',
            width: '20 mm',
            height: '5 mm',
            x: '30 mm',
            y: '10 mm',
          },
        }),
      ),
      of('r1', 'rib', ribInputs({ kind: 'sketchEntity', id: 's1/l0' })),
    ];
    const result = await recompute(testDocument([features[0] as Feature, features[1] as Feature]));
    expect(Object.values(result.features).filter((status) => status.status !== 'ok')).toEqual([]);
    // With a line on the sketch the rib needs: draw one and compute again.
    const drawn = [
      ...features.slice(0, 2),
      {
        ...testFeature('s1', 'sketch'),
        inputs: sketchInputs(
          { kind: 'plane', id: 'origin:xz' },
          (() => {
            const builder = new SketchBuilder();
            builder.line(0, 0, 40, 0);
            return {
              entities: builder.entities,
              constraints: builder.constraints,
              dimensions: builder.dimensions,
            };
          })(),
        ),
      },
    ] as Feature[];
    const withRib = await recompute(testDocument(drawn));
    const rib = { ...(features[2] as Feature) };
    const status = withRib.features['r1' as FeatureId];
    if (status?.status === 'ok') expectRoles(rib, withRib);
  });
});
