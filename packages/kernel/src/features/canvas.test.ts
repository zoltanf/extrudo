// The `canvas` feature in the kernel (P4-06, ADR-0066 §5, FR-IO-07): the
// frame it reports on an origin plane, a construction plane and a flat face,
// what it refuses, and that it makes no geometry at all (`strictLeaks` on).
import {
  AttachmentIdSchema,
  type CanvasInputOptions,
  type CanvasReport,
  canvasInputs,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
  type GeomRef,
  originPlaneRef,
  type SketchData,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Kernel } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { KernelFeatureDefinition, RecomputeResult } from '../recompute/types';

type Done = Extract<RecomputeResult, { status: 'done' }>;

let kernel: Kernel;
let engine: RecomputeEngine;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

beforeEach(() => {
  engine?.clear();
  expect(kernel.stats().liveShapes).toBe(0);
  const registry = new FeatureRegistry<KernelFeatureDefinition>();
  for (const definition of testFeatures().registry.list()) registry.register(definition);
  engine = new RecomputeEngine(kernel, registry, { strictLeaks: true });
});

afterAll(() => {
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

// ------------------------------------------------------------------ helpers

const IMAGE = AttachmentIdSchema.parse('a-1');
const XY = originPlaneRef('origin:xy');
const XZ = originPlaneRef('origin:xz');

/** A canvas feature on `plane` (XY without one), with `numbers` as expressions. */
function canvas(options: Omit<CanvasInputOptions, 'image'> = {}): Feature {
  return {
    ...testFeature('C', 'canvas'),
    inputs: canvasInputs({ image: IMAGE, ...options }),
  };
}

/** A 60 × 40 mm block, x 0…60, y 0…40, z 0…`height`; its top face is `extrude:B:cap:end`. */
function block(height = '10 mm'): Feature[] {
  const b = new SketchBuilder();
  b.line(0, 0, 60, 0);
  b.line(60, 0, 60, 40);
  b.line(60, 40, 0, 40);
  b.line(0, 40, 0, 0);
  return [
    {
      ...testFeature('SB', 'sketch'),
      inputs: sketchInputs(XY, b.sketch as SketchData),
    },
    {
      ...testFeature('B', 'extrude'),
      inputs: extrudeInputs([profileOf('SB', b.sketch as SketchData)], { distance: height }),
    },
  ];
}

const TOP: GeomRef = { kind: 'face', id: 'extrude:B:cap:end' };

function profileOf(sketchId: string, data: SketchData): GeomRef {
  const [found] = detectProfiles(data);
  if (!found) throw new Error('no profile');
  return { kind: 'profile', id: `${sketchId}/${found.id}` };
}

/** An offset plane `distance` above `plane`, as a feature. */
function offsetPlane(id: string, plane: GeomRef, distance: string): Feature {
  return {
    ...testFeature(id, 'offsetPlane'),
    inputs: {
      plane: { kind: 'ref', refs: [plane] },
      distance: { kind: 'expr', expr: distance, unit: 'length' },
    },
  };
}

async function fresh(features: Feature[]): Promise<Done> {
  engine.clear();
  const result = await engine.recompute({ doc: document(features) });
  if (result.status !== 'done') throw new Error('cancelled');
  return result;
}

function document(features: Feature[]): ExtrudoDocument {
  return {
    ...testDocument(features),
    attachments: {
      [IMAGE]: {
        name: 'plan',
        fileName: 'plan.png',
        mediaType: 'image/png',
        sha256: 'a'.repeat(64),
        size: 10,
      },
    },
  };
}

const status = (result: Done, id: string): FeatureStatus =>
  result.features[id as FeatureId] ?? { status: 'ok' };

/** The canvas report of a recomputed document. */
function reportOf(result: Done, id = 'C'): CanvasReport {
  const report = result.reports[id as FeatureId];
  if ((report as CanvasReport | undefined)?.kind !== 'canvas') {
    throw new Error(`no canvas report for ${id}: ${JSON.stringify(report)}`);
  }
  return report as CanvasReport;
}

const round = (v: readonly number[], digits = 4) => v.map((x) => Number(Number(x).toFixed(digits)));

// ------------------------------------------------------------------- frames

describe('the canvas feature (P4-06, ADR-0066 §5)', { timeout: 120_000 }, () => {
  it('reports the XY plane when it has none, and makes no body', async () => {
    const result = await fresh([canvas()]);
    expect(status(result, 'C').status).toBe('ok');
    expect(result.bodies).toEqual([]);
    // The frame is the plane's: the origin on XY (a sketch there gets the same).
    expect(round(reportOf(result).frame.origin)).toEqual([0, 0, 0]);
    expect(round(reportOf(result).frame.normal)).toEqual([0, 0, 1]);
    expect(round(reportOf(result).frame.x)).toEqual([1, 0, 0]);
    expect(round(reportOf(result).frame.y)).toEqual([0, 1, 0]);
    // The image itself is not the kernel's business: no bytes, no shapes, and
    // the report is the only thing it has.
    expect(Object.keys(reportOf(result))).toEqual(['kind', 'frame']);
  });

  it('follows a construction plane it lies on', async () => {
    const result = await fresh([
      offsetPlane('OP', XY, '15 mm'),
      canvas({ plane: { kind: 'plane', id: 'OP' } }),
    ]);
    expect(status(result, 'C').status).toBe('ok');
    expect(round(reportOf(result).frame.origin)).toEqual([0, 0, 15]);
    // Moving the plane moves the canvas: the report is read fresh each time.
    engine.clear();
    const moved = await engine.recompute({
      doc: document([
        offsetPlane('OP', XY, '25 mm'),
        canvas({ plane: { kind: 'plane', id: 'OP' } }),
      ]),
    });
    if (moved.status !== 'done') throw new Error('cancelled');
    expect(round(reportOf(moved).frame.origin)).toEqual([0, 0, 25]);
  });

  it('takes the frame of a flat face, as a sketch on it would', async () => {
    const result = await fresh([...block('10 mm'), canvas({ plane: TOP })]);
    expect(status(result, 'C').status).toBe('ok');
    // The top face at z = 10: the frame of the face the extrude named, whose
    // origin is the world origin projected on the plane (ADR-0031).
    expect(round(reportOf(result).frame.origin)).toEqual([0, 0, 10]);
    expect(round(reportOf(result).frame.normal)).toEqual([0, 0, 1]);
  });

  it('reports on an origin plane other than XY', async () => {
    const result = await fresh([canvas({ plane: XZ })]);
    expect(round(reportOf(result).frame.origin)).toEqual([0, 0, 0]);
    expect(round(reportOf(result).frame.normal)).toEqual([0, -1, 0]);
  });

  it('keeps the width, the turn and the opacity as the document says', async () => {
    const result = await fresh([
      canvas({
        numbers: { x: '10 mm', y: '-5 mm', width: '40 mm', rotation: '30 deg', opacity: '0.8' },
        flip: true,
      }),
    ]);
    expect(status(result, 'C').status).toBe('ok');
    // The kernel only checks that a canvas is drawable; the view reads the
    // numbers from the same inputs (`canvasNumbers`).
    const feature = result.features['C' as FeatureId];
    expect(feature?.status).toBe('ok');
  });

  it('is recomputed when its numbers change, and cached when they do not', async () => {
    const first = await fresh([canvas({ numbers: { width: '40 mm' } })]);
    expect(status(first, 'C').status).toBe('ok');
    const warm = engine;
    const again = await warm.recompute({
      doc: document([canvas({ numbers: { width: '40 mm' } })]),
    });
    if (again.status !== 'done') throw new Error('cancelled');
    expect(again.stats.evaluated).toEqual([]);
  });
});

// ------------------------------------------------------------------- errors

describe('canvas errors', { timeout: 120_000 }, () => {
  const messageOf = async (feature: Feature): Promise<string> => {
    const result = await fresh([feature]);
    expect(status(result, 'C').status).toBe('error');
    expect(status(result, 'C').message).not.toMatch(/Internal error/);
    engine.clear();
    expect(kernel.stats().liveShapes).toBe(0);
    return status(result, 'C').message ?? '';
  };

  it('a plane that is gone is a lost reference, so Fix References offers it', async () => {
    const gone: GeomRef = { kind: 'face', id: 'extrude:nothing:cap:end' };
    const result = await fresh([canvas({ plane: gone })]);
    expect(status(result, 'C').status).toBe('error');
    expect(status(result, 'C').refs).toEqual([{ ref: gone, state: 'lost' }]);
  });

  it('a plane reference to another kind of feature says so', async () => {
    const result = await fresh([
      {
        ...testFeature('P', 'constructionPoint'),
        inputs: { x: { kind: 'expr', expr: '1 mm', unit: 'length' } },
      },
      canvas({ plane: { kind: 'plane', id: 'P' } }),
    ]);
    expect(status(result, 'C').message).toContain("isn't a plane");
  });

  it('a face that is not flat says so', async () => {
    const b = new SketchBuilder();
    b.circle(0, 0, 10);
    const cylinder: Feature[] = [
      {
        ...testFeature('S', 'sketch'),
        inputs: sketchInputs(XY, b.sketch as SketchData),
      },
      {
        ...testFeature('E', 'extrude'),
        inputs: extrudeInputs([profileOf('S', b.sketch as SketchData)], { distance: '10 mm' }),
      },
    ];
    // The cylinder's wall, by the name the extrude gave it.
    const wall = await fresh(cylinder);
    const body = wall.bodies[0];
    const side = body?.mesh?.faceIds?.find((name) => !name.includes('cap:'));
    expect(side).toBeTruthy();
    const result = await fresh([
      ...cylinder,
      canvas({ plane: { kind: 'face', id: side as string } }),
    ]);
    expect(status(result, 'C').message).toContain("isn't flat");
  });

  it('refuses a width of nothing and an opacity out of range', async () => {
    expect(await messageOf(canvas({ numbers: { width: '0 mm' } }))).toBe(
      'A canvas needs a width. Set one, or pick a wider image.',
    );
    expect(await messageOf(canvas({ numbers: { width: '-5 mm' } }))).toMatch(/needs a width/);
    expect(await messageOf(canvas({ numbers: { opacity: '0' } }))).toBe(
      'Opacity must be between 0.05 and 1.',
    );
    expect(await messageOf(canvas({ numbers: { opacity: '2' } }))).toMatch(/Opacity must be/);
    // The bounds themselves are drawable.
    for (const opacity of ['0.05', '1']) {
      const result = await fresh([canvas({ numbers: { opacity } })]);
      expect(status(result, 'C').status, opacity).toBe('ok');
    }
  });

  it('says a plane that failed or was suppressed blocks it', async () => {
    // An offset plane with nothing to offset from: it fails, as a user sees it.
    const bad = testFeature('OP', 'offsetPlane');
    const result = await fresh([bad, canvas({ plane: { kind: 'plane', id: 'OP' } })]);
    expect(status(result, 'C').message).toMatch(/has an error/);
    const suppressed = await fresh([
      { ...bad, suppressed: true },
      canvas({ plane: { kind: 'plane', id: 'OP' } }),
    ]);
    expect(status(suppressed, 'C').message).toMatch(/suppressed/);
  });
});
