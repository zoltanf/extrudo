// STEP colours (P4-12, ADR-0034's amendment): the facade's coloured
// `writeStep` (XDE's writer) and `readStepColors` (XDE's reader, an XCAF
// document per call), and the `import` feature's `ImportReport`. Real OCCT,
// `strictLeaks` on.
import {
  type AttachmentId,
  type BodyId,
  type ExtrudoDocument,
  type FeatureId,
  type ImportReport,
  importInputs,
  isImportReport,
} from '@extrudo/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Kernel, rgbToHex, type ShapeHandle } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature } from '../recompute/testing';
import type { ImportedFile } from '../recompute/types';
import { kernelFeatures } from '.';

let kernel: Kernel;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

afterEach(() => {
  expect(kernel.stats().liveShapes).toBe(0);
});

/** Three boxes of different sizes side by side, so each solid tells itself apart. */
function threeBoxes(): ShapeHandle[] {
  return [
    kernel.box([10, 10, 10], [0, 0, 0]),
    kernel.box([20, 10, 10], [30, 0, 0]),
    kernel.box([10, 10, 30], [60, 0, 0]),
  ];
}

/** Volumes of `readStep(text)`'s solids, in `solids()` order. */
function solidVolumes(text: string): number[] {
  const read = kernel.readStep(text);
  const solids = kernel.solids(read);
  try {
    return solids.map((s) => Math.round(kernel.measure(s).volume));
  } finally {
    kernel.release(...solids, read);
  }
}

describe('STEP colours in the kernel (P4-12)', () => {
  it('writes body colours and reads them back per solid, in readStep order', () => {
    const boxes = threeBoxes();
    try {
      const text = kernel.writeStep([
        { shape: boxes[0] as ShapeHandle, name: 'Red', color: '#c81e28' },
        { shape: boxes[1] as ShapeHandle, name: 'Plain' },
        { shape: boxes[2] as ShapeHandle, name: 'Blüe', color: '#1080FF' },
      ]);
      expect(text).toContain('COLOUR_RGB');
      // Products keep their names, a non-ASCII one encoded (ADR-0034).
      expect(text).toContain("PRODUCT('Red'");
      expect(text).toContain("PRODUCT('Plain'");
      expect(text).toContain("PRODUCT('Bl\\X2\\00FC\\X0\\e'");
      expect(text).toContain('SI_UNIT(.MILLI.,.METRE.)');
      const colors = kernel.readStepColors(text);
      expect(colors).toEqual({ solids: ['#c81e28', undefined, '#1080ff'], coloredFaces: 0 });
      expect(solidVolumes(text)).toEqual([1000, 2000, 3000]);
    } finally {
      kernel.release(...boxes);
    }
  });

  it('a file without colours reads as none, and keeps the plain writer', () => {
    const boxes = threeBoxes();
    try {
      const parts = boxes.map((shape, i) => ({ shape, name: `Body${i + 1}` }));
      const plain = kernel.writeStep(parts);
      expect(plain).not.toContain('COLOUR_RGB');
      // A part with no colour is the same as one never given one.
      const unset = kernel.writeStep(parts.map((p) => ({ ...p, color: 'none' })));
      expect(unset.slice(unset.indexOf('DATA;'))).toBe(plain.slice(plain.indexOf('DATA;')));
      expect(kernel.readStepColors(plain)).toEqual({
        solids: [undefined, undefined, undefined],
        coloredFaces: 0,
      });
    } finally {
      kernel.release(...boxes);
    }
  });

  it('rounds colours to the nearest of 255 steps both ways', () => {
    expect(rgbToHex(200 / 255, 30 / 255, 40 / 255)).toBe('#c81e28');
    expect(rgbToHex(1.2, -0.1, 0.5)).toBe('#ff0080');
  });
});

describe("the import feature's colours (P4-12)", () => {
  const IMPORT_ID = 'Import1' as FeatureId;
  const file = 'file-1' as AttachmentId;
  let engine: RecomputeEngine | undefined;
  const held = new Map<AttachmentId, ImportedFile>();

  afterEach(() => {
    engine?.clear();
    engine = undefined;
    held.clear();
  });

  function design(text: string, up?: 'y'): ExtrudoDocument {
    const bytes = new TextEncoder().encode(text);
    held.set(file, { bytes, mediaType: 'model/step' });
    return {
      ...testDocument([
        {
          ...testFeature('Import1', 'import'),
          inputs: importInputs({ file, ...(up && { up }) }),
        },
      ]),
      attachments: {
        [file]: {
          name: 'parts',
          fileName: 'parts.step',
          mediaType: 'model/step',
          sha256: 'c'.repeat(64),
          size: bytes.length,
        },
      },
    };
  }

  async function report(doc: ExtrudoDocument) {
    engine ??= new RecomputeEngine(kernel, kernelFeatures(), {
      strictLeaks: true,
      files: (id) => held.get(id),
    });
    const result = await engine.recompute({ doc });
    if (result.status !== 'done') throw new Error('cancelled');
    expect(result.features[IMPORT_ID]?.status).toBe('ok');
    const own = result.reports[IMPORT_ID];
    const volumes = Object.fromEntries(
      result.bodies.map(({ id }) => [
        id,
        Math.round(kernel.measure(engine?.latestBody(id as BodyId) as ShapeHandle).volume),
      ]),
    );
    return { report: isImportReport(own) ? (own as ImportReport) : undefined, volumes };
  }

  function written(withColors: boolean): string {
    const boxes = threeBoxes();
    try {
      const colors = ['#c81e28', undefined, '#1080ff'];
      return kernel.writeStep(
        boxes.map((shape, i) => {
          const color = withColors ? colors[i] : undefined;
          return { shape, name: `Part${i + 1}`, ...(color && { color }) };
        }),
      );
    } finally {
      kernel.release(...boxes);
    }
  }

  it("reports each body's colour by the solid it came from", { timeout: 60_000 }, async () => {
    const { report: got, volumes } = await report(design(written(true)));
    if (!got) throw new Error('no import report');
    // splitSolids orders bodies by size (the largest keeps the feature's ID),
    // not by the file: the colour follows the solid, read by its faces.
    const byVolume = Object.fromEntries(
      Object.entries(got.colors).map(([id, color]) => [volumes[id], color]),
    );
    expect(byVolume).toEqual({ 1000: '#c81e28', 3000: '#1080ff' });
    expect(Object.keys(volumes)).toHaveLength(3);
    expect(got.coloredFaces).toBe(0);
    // Turned with Up: the same bodies, the same colours.
    const turned = await report(design(written(true), 'y'));
    expect(turned.report?.colors).toEqual(got.colors);
  });

  it('a file without colours has no report', { timeout: 60_000 }, async () => {
    const { report: got, volumes } = await report(design(written(false)));
    expect(got).toBeUndefined();
    expect(Object.keys(volumes)).toHaveLength(3);
  });
});
