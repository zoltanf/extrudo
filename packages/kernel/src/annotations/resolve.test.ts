// Annotations at the marker (P6-23, ADR-0126 §4): the engine's annotation pass
// on a box whose height is a parameter, with real OCCT and strict leaks.
import {
  type Annotation,
  type AnnotationId,
  type ExtrudoDocument,
  primitiveInputs,
} from '@extrudo/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
});

afterAll(() => {
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

type Done = Extract<RecomputeResult, { status: 'done' }>;

async function recompute(doc: ExtrudoDocument): Promise<Done> {
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error('cancelled');
  return result;
}

const N1 = 'n1' as AnnotationId;

/** A 40 × 20 × `h` box at the origin (`Plate`) and a second one beside it (`Other`). */
function plate(h = '10 mm', annotations: Annotation[] = []): ExtrudoDocument {
  const doc = testDocument(
    [
      {
        ...testFeature('Plate', 'box'),
        inputs: primitiveInputs('box', {
          numbers: { length: '40 mm', width: '20 mm', height: 'h' },
        }),
      },
      {
        ...testFeature('Other', 'box'),
        inputs: primitiveInputs('box', { numbers: { x: '100 mm' } }),
      },
    ],
    { h },
  );
  return {
    ...doc,
    ...(annotations.length > 0 && { annotations, annotationCounter: annotations.length }),
  };
}

/** An annotation on the plate's top face, 5 mm off its centre. */
function onTop(fingerprintAt: [number, number, number]): Annotation {
  return {
    id: N1,
    number: 1,
    text: 'Hole M4 here',
    anchor: {
      kind: 'model',
      ref: {
        kind: 'face',
        id: 'box:Plate:cap:end',
        fingerprint: { type: 'plane', at: fingerprintAt, dir: [0, 0, 1], size: 800 },
      },
      at: [fingerprintAt[0] + 5, fingerprintAt[1], fingerprintAt[2]],
    },
  };
}

/** The top face's centre at height 10, read as the agent tools read it (`resolveAnnotation`). */
async function topCentre(): Promise<[number, number, number]> {
  await recompute(plate());
  const fresh = engine.resolveAnnotation({
    ...onTop([0, 0, 0]),
    anchor: { kind: 'model', ref: { kind: 'face', id: 'box:Plate:cap:end' }, at: [0, 0, 0] },
  });
  expect(fresh.status).toBe('ok');
  return fresh.resolved?.ref.fingerprint?.at as [number, number, number];
}

describe('the annotation pass (ADR-0126 §4)', () => {
  it('resolves a face annotation where it was made, with the normal and the body', {
    timeout: 60_000,
  }, async () => {
    const centre = await topCentre();
    expect(centre[2]).toBeCloseTo(10, 6);
    const result = await recompute(plate('10 mm', [onTop(centre)]));
    const report = result.annotations?.[N1];
    expect(report).toMatchObject({ id: N1, status: 'ok', normal: [0, 0, 1] });
    expect(report?.at?.[0]).toBeCloseTo(centre[0] + 5, 6);
    expect(report?.at?.[2]).toBeCloseTo(10, 6);
    expect(report?.resolved?.ref.id).toBe('box:Plate:cap:end');
    expect(report?.resolved?.body).toBe('Plate:0');
  });

  it('follows the face when a parameter moves it', async () => {
    const centre = await topCentre();
    const result = await recompute(plate('25 mm', [onTop(centre)]));
    const report = result.annotations?.[N1];
    expect(report?.status).toBe('ok');
    expect(report?.at?.[0]).toBeCloseTo(centre[0] + 5, 6);
    expect(report?.at?.[2]).toBeCloseTo(25, 6);
  });

  it('is detached when the marker is before its feature, or the feature is gone', async () => {
    const note = onTop([20, 10, 10]);
    const before = await recompute({ ...plate('10 mm', [note]), timelineMarker: 0 });
    expect(before.annotations?.[N1]).toEqual({ id: N1, status: 'detached' });
    const doc = plate('10 mm', [note]);
    const gone = await recompute({
      ...doc,
      features: doc.features.filter((f) => f.id !== 'Plate'),
      timelineMarker: 1,
    });
    expect(gone.annotations?.[N1]).toEqual({ id: N1, status: 'detached' });
  });

  it('a lost name found by its fingerprint is moved; a body and the origin resolve', async () => {
    const top = onTop(await topCentre());
    const moved: Annotation = {
      ...top,
      anchor: {
        ...top.anchor,
        ref: { ...(top.anchor as { ref: object }).ref, id: 'box:Gone:cap:end' },
      } as Annotation['anchor'],
    };
    const body: Annotation = {
      ...onTop([0, 0, 0]),
      id: 'n2' as AnnotationId,
      number: 2,
      anchor: { kind: 'model', ref: { kind: 'body', id: 'Other:0' }, at: [1, 2, 3] },
    };
    const origin: Annotation = {
      ...onTop([0, 0, 0]),
      id: 'n3' as AnnotationId,
      number: 3,
      anchor: { kind: 'model', ref: { kind: 'plane', id: 'origin:xy' }, at: [4, 5, 0] },
    };
    const free: Annotation = {
      ...onTop([0, 0, 0]),
      id: 'n4' as AnnotationId,
      number: 4,
      anchor: { kind: 'free', at: [0, 0, 0] },
    };
    const result = await recompute(plate('10 mm', [moved, body, origin, free]));
    expect(result.annotations?.[N1]?.status).toBe('moved');
    expect(result.annotations?.[N1]?.resolved?.ref.id).toBe('box:Plate:cap:end');
    expect(result.annotations?.['n2' as AnnotationId]).toMatchObject({
      status: 'ok',
      at: [1, 2, 3],
      resolved: { ref: { kind: 'body', id: 'Other:0' }, body: 'Other:0' },
    });
    expect(result.annotations?.['n3' as AnnotationId]).toMatchObject({
      status: 'ok',
      at: [4, 5, 0],
      normal: [0, 0, 1],
    });
    // A free annotation is the app's to place: the kernel reports nothing.
    expect(result.annotations?.['n4' as AnnotationId]).toBeUndefined();
  });

  it('is in no cache key: editing an annotation recomputes nothing', async () => {
    await recompute(plate('10 mm', [onTop([20, 10, 10])]));
    const edited = await recompute(
      plate('10 mm', [{ ...onTop([20, 10, 10]), text: 'Something else' }]),
    );
    expect(edited.stats.evaluated).toEqual([]);
  });
});
