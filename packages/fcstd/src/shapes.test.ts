/**
 * The shapes-only import (P6-25 S3, ADR-0144): authored files through
 * `importFcstd` with a kernel in Node, and fake kernels for the failures.
 */

import { Design } from '@extrudo/api';
import { Kernel } from '@extrudo/kernel';
import { loadOcct } from '@extrudo/kernel/node';
import { MAX_ATTACHMENTS_BYTES } from '@extrudo/storage';
import { beforeAll, describe, expect, it } from 'vitest';
import { finalShapes, linkArrayProblem } from './final-shapes';
import { documentXml, fcstd, label, links, NO_HISTORY, placement, shape } from './fixtures';
import { importFcstd } from './import';
import type { ImportKernel, StoredShapeStep } from './import-kernel';
import { binaryFormProblem, readFcstd } from './model';
import { cleanName, clip, MAX_DETAIL_LENGTH, MAX_NAME_LENGTH, stepFileName } from './names';
import { nodeImportKernel } from './node-kernel-test-support';
import { BOX, noShapeFile, shapesFile } from './shape-fixtures';
import {
  disagreement,
  hexColour,
  importShapes,
  MAX_SOLIDS_PER_SHAPE,
  NONSENSE_REPLY,
  saneReply,
} from './shapes';

let measure: Kernel;
beforeAll(async () => {
  measure = new Kernel(await loadOcct());
});

/** The box, volume and solids of an attachment's STEP, read with a separate kernel. */
function stepBox(bytes: Uint8Array) {
  using scope = measure.scope();
  const shape = scope.track(measure.readStep(new TextDecoder('latin1').decode(bytes)));
  const { bbox, volume } = measure.properties(shape);
  const solids = measure.solids(shape);
  measure.release(...solids);
  return { box: [...bbox.min, ...bbox.max], volume, solids: solids.length };
}

const close = (a: number[], b: number[]) => {
  expect(a).toHaveLength(b.length);
  a.forEach((v, i) => {
    expect(v).toBeCloseTo(b[i] as number, 4);
  });
};

describe('importFcstd with a kernel in Node', () => {
  it('brings each final shape in as an import feature, named, coloured and placed', async () => {
    const kernel = nodeImportKernel();
    const progress: number[] = [];
    const { design, files, report } = await importFcstd(shapesFile(), 'Shapes', {
      kernel,
      onProgress: (done) => progress.push(done),
    });
    const doc = design.toJSON();
    expect(doc.name).toBe('Shapes');
    expect(report.finalShapes).toBe(11);
    // The body's one feature is walked first (S5), then the eleven shapes.
    expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(report.shapes.map((s) => [s.name, s.solids])).toEqual([
      ['Bracket', 1],
      ['Holed box', 1],
      ['Hidden box', 1],
      ['Red box', 1],
      ['Moved box', 1],
      ['Holed box copy', 1],
      ['Pair', 2],
      ['Twin A', 1],
      ['Twin B', 1],
    ]);
    expect(report.leftOut).toEqual([
      { object: 'Mesh', name: 'Scan', reason: 'mesh' },
      { object: 'Body001', name: 'Empty body', reason: 'empty' },
    ]);
    expect(report.restarts).toBe(0);
    expect(kernel.restarts).toBe(0);

    // One import feature per shape, in document order, each on its STEP attachment.
    const features = doc.features.filter((f) => f.type === 'import');
    expect(features.map((f) => f.name)).toEqual(report.shapes.map((s) => `Import ${s.name}`));
    const attachments = doc.attachments ?? {};
    const featureOf = (name: string) => features.find((x) => x.name === `Import ${name}`);
    const fileOf = (name: string) =>
      (featureOf(name)?.inputs.file as { id: string } | undefined)?.id ?? '';
    // The same shape twice shares one attachment; the rest have their own.
    expect(fileOf('Twin A')).toBe(fileOf('Twin B'));
    expect(fileOf('Hidden box')).toBe(fileOf('Twin A'));
    expect(Object.keys(attachments)).toHaveLength(files.size);
    // The box at the origin is five objects' shape: one file for them all.
    expect(files.size).toBe(5);
    for (const [id, bytes] of files) {
      expect(attachments[id]?.mediaType).toBe('model/step');
      expect(attachments[id]?.size).toBe(bytes.length);
    }

    // The bodies' metadata: name, colour, opacity, hidden.
    const body = (name: string, n = 0) =>
      doc.bodies[`${featureOf(name)?.id}:${n}` as keyof typeof doc.bodies];
    expect(body('Bracket')).toEqual({ name: 'Bracket', visible: true, color: '#3366cc' });
    // FreeCAD's default grey is no colour: the body takes Extrudo's own.
    expect(body('Hidden box')).toEqual({ name: 'Hidden box', visible: false });
    expect(body('Red box')).toEqual({
      name: 'Red box',
      visible: true,
      color: '#ff0000',
      opacity: 0.5,
    });
    expect(body('Pair')?.name).toBe('Pair');
    expect(body('Pair', 1)?.name).toBe('Pair 2');

    // Where the shapes landed.
    const at = (name: string) => stepBox(files.get(fileOf(name) as never) as Uint8Array);
    close(at('Bracket').box, [0, 0, 0, 10, 20, 30]);
    close(at('Moved box').box, [0, 0, 5, 10, 20, 35]);
    const cut = at('Holed box').box;
    close(at('Holed box copy').box, [
      (cut[0] as number) + 20,
      cut[1] as number,
      cut[2] as number,
      (cut[3] as number) + 20,
      cut[4] as number,
      cut[5] as number,
    ]);
    const pair = at('Pair');
    expect(pair.solids).toBe(2);
    expect(pair.volume).toBeCloseTo(12_000, 4);
    close(pair.box, [0, 0, 0, 60, 20, 30]);
  });

  it('opens a file with no shape as an empty design', async () => {
    const { design, files, report } = await importFcstd(noShapeFile(), 'Notes', {
      kernel: nodeImportKernel(),
    });
    expect(design.toJSON().features.filter((f) => f.type === 'import')).toEqual([]);
    expect(files.size).toBe(0);
    expect(report.finalShapes).toBe(0);
    expect(report.shapes).toEqual([]);
  });
});

/** A file with the box `count` times, as plain Part features. */
function boxes(count: number): Uint8Array {
  const objects = Array.from({ length: count }, (_, i) => ({
    name: `B${i}`,
    type: 'Part::Feature',
    props: [label(`Box ${i}`), placement(), shape(`B${i}.brp`)],
  }));
  return fcstd({
    'Document.xml': documentXml(objects),
    ...Object.fromEntries(objects.map((o) => [`${o.name}.brp`, BOX])),
  });
}

const measured = {
  solids: 1,
  volume: 6000,
  area: 2200,
  box: { min: [0, 0, 0], max: [10, 20, 30] },
  centre: [5, 10, 15],
};
const good = { ...measured, step: 'ISO-10303-21;', read: measured } as unknown as StoredShapeStep;

type Behaviour = 'ok' | 'throw' | 'hang' | 'garbage' | 'drift' | 'lost' | 'none';

/** A fake kernel that answers each call with the next behaviour, `ok` after the list. */
function scripted(behaviours: Behaviour[]) {
  let generation = 0;
  const k = {
    calls: 0,
    restarts: 0,
    generation: [] as number[],
    storedShapeToStep: async (): Promise<StoredShapeStep> => {
      const b = behaviours[k.calls++] ?? 'ok';
      k.generation.push(generation);
      switch (b) {
        case 'throw':
          throw new Error('The kernel stopped: unreachable');
        case 'hang':
          return new Promise<StoredShapeStep>(() => {});
        case 'garbage':
          return { ...good, volume: Number.NaN, step: 'x' };
        case 'drift':
          return { ...good, volume: 6000 * 1.01 };
        case 'lost':
          return { ...good, solids: 0 };
        case 'none':
          return { ...good, step: '', solids: 0, read: { ...good.read, solids: 0 } };
        default:
          return { ...good, step: `ISO-10303-21; ${k.calls}` };
      }
    },
    ...NO_HISTORY,
    restart: async () => {
      k.restarts++;
      generation++;
    },
  };
  return k;
}

describe('importFcstd: failures, budgets and limits', () => {
  it('leaves out a shape the kernel throws on, returns garbage for or hangs on, and restarts it', async () => {
    const kernel = scripted(['throw', 'garbage', 'hang', 'ok']);
    const { report } = await importFcstd(boxes(4), 'X', { kernel, shapeTimeoutMs: 50 });
    expect(report.leftOut.map((l) => [l.name, l.reason])).toEqual([
      ['Box 0', 'kernel'],
      ['Box 1', 'kernel'],
      ['Box 2', 'time'],
    ]);
    expect(report.leftOut[0]?.detail).toMatch(/unreachable/);
    expect(report.leftOut[1]?.detail).toBe(NONSENSE_REPLY);
    expect(report.shapes.map((s) => s.name)).toEqual(['Box 3']);
    // A throw, a reply that makes no sense and a hang each cost the kernel.
    expect(kernel.restarts).toBe(3);
    expect(report.restarts).toBe(3);
    expect(kernel.generation).toEqual([0, 1, 2, 3]);
  });

  it('refuses a reply whose numbers or types make no sense, as a kernel failure', async () => {
    const replies: unknown[] = [
      { ...good, solids: 1e9 },
      { ...good, read: { ...good.read, solids: 1.5 } },
      { ...good, volume: Number.NaN },
      { ...good, box: { min: [0, 0, 0], max: [10, Number.POSITIVE_INFINITY, 30] } },
      { ...good, step: 42 },
      { ...good, read: undefined },
      null,
    ];
    let restarts = 0;
    const kernel: ImportKernel = {
      storedShapeToStep: async () => replies.shift() as StoredShapeStep,
      ...NO_HISTORY,
      restart: async () => {
        restarts++;
      },
    };
    const { report } = await importFcstd(boxes(7), 'X', { kernel, maxRestarts: 10 });
    expect(report.leftOut.map((l) => [l.reason, l.detail])).toEqual(
      Array.from({ length: 7 }, () => ['kernel', NONSENSE_REPLY]),
    );
    expect(restarts).toBe(7);
    expect(saneReply(good)).toBe(true);
    expect(saneReply({ ...good, solids: MAX_SOLIDS_PER_SHAPE })).toBe(true);
    expect(saneReply({ ...good, solids: MAX_SOLIDS_PER_SHAPE + 1 })).toBe(false);
  });

  it("cuts a long kernel message to the report's length", async () => {
    const kernel: ImportKernel = {
      storedShapeToStep: async () => {
        throw new Error('x'.repeat(5000));
      },
      ...NO_HISTORY,
      restart: async () => {},
    };
    const { report } = await importFcstd(boxes(1), 'X', { kernel });
    expect([...(report.leftOut[0]?.detail ?? '')]).toHaveLength(MAX_DETAIL_LENGTH);
  });

  it('gives up after three restarts and leaves the rest out', async () => {
    const kernel = scripted(['throw', 'throw', 'throw', 'throw', 'ok']);
    const { report } = await importFcstd(boxes(6), 'X', { kernel });
    expect(report.leftOut.map((l) => l.reason)).toEqual([
      'kernel',
      'kernel',
      'kernel',
      'kernel',
      'restarts',
      'restarts',
    ]);
    expect(kernel.restarts).toBe(3);
    expect(kernel.calls).toBe(4);
  });

  it('checks solids, volume and box against the stored shape', async () => {
    const kernel = scripted(['drift', 'lost', 'none']);
    const { report } = await importFcstd(boxes(3), 'X', { kernel });
    expect(report.leftOut.map((l) => [l.reason, l.detail])).toEqual([
      ['check', 'the volume differs by 0.99 %'],
      ['check', '1 solid stored, 0 after STEP'],
      ['no-solid', undefined],
    ]);
    expect(kernel.restarts).toBe(0);
  });

  it('stops at the whole import budget', async () => {
    let clock = 0;
    const kernel = scripted([]);
    const wrapped: ImportKernel = {
      storedShapeToStep: async () => {
        clock += 600;
        return kernel.storedShapeToStep();
      },
      ...NO_HISTORY,
      restart: () => kernel.restart(),
    };
    const { report } = await importFcstd(boxes(4), 'X', {
      kernel: wrapped,
      importTimeoutMs: 1000,
      now: () => clock,
    });
    expect(report.shapes.map((s) => s.name)).toEqual(['Box 0', 'Box 1']);
    expect(report.leftOut.map((l) => [l.name, l.reason])).toEqual([
      ['Box 2', 'import-time'],
      ['Box 3', 'import-time'],
    ]);
  });

  it('keeps each attachment under 25 MB and the design under 100 MB', async () => {
    let n = 0;
    const kernel: ImportKernel = {
      storedShapeToStep: async () => {
        n++;
        const size = n === 1 ? 26 : 20;
        return { ...good, step: `${n}`.padEnd(size * 1024 * 1024, ' ') };
      },
      ...NO_HISTORY,
      restart: async () => {},
    };
    const { report, files } = await importFcstd(boxes(7), 'X', { kernel });
    expect(report.leftOut.map((l) => [l.name, l.reason])).toEqual([
      ['Box 0', 'too-large'],
      ['Box 6', 'design-full'],
    ]);
    expect(files.size).toBe(5);
  }, 120_000);

  it('holds no more bytes while converting than the design may hold plus one shape', async () => {
    const MB = 1024 * 1024;
    let n = 0;
    // Twelve different 20 MB files and, in between, copies of the first.
    const kernel: ImportKernel = {
      storedShapeToStep: async () => {
        n++;
        const id = n % 3 === 0 ? 1 : n;
        return { ...good, step: `${id}`.padEnd(20 * MB, ' ') };
      },
      ...NO_HISTORY,
      restart: async () => {},
    };
    const doc = readFcstd(boxes(18));
    const design = Design.create({ name: 'X' });
    const result = await importShapes(doc, finalShapes(doc), design, { kernel });
    expect(result.peakBytes).toBeLessThanOrEqual(MAX_ATTACHMENTS_BYTES + 20 * MB);
    expect([...result.files.values()].reduce((a, b) => a + b.length, 0)).toBeLessThanOrEqual(
      MAX_ATTACHMENTS_BYTES,
    );
    // The copies of a kept file cost nothing: they still come in once the design is full.
    expect(result.imported.length).toBe(5 + 6);
    expect(result.leftOut.every((l) => l.reason === 'design-full')).toBe(true);
  }, 240_000);
});

describe("the reader's own words", () => {
  it("knows a binary stored shape by the reader's problem line, and lists link arrays apart", async () => {
    const file = fcstd({
      'Document.xml': documentXml([
        {
          name: 'B0',
          type: 'PartDesign::Body',
          props: [label('Bin'), links('Group', []), placement(), shape('B0.brp')],
        },
      ]),
      // FreeCAD's binary shape form under a .brp name.
      'B0.brp': 'Open CASCADE Topology V3 (c) binary',
    });
    const kernel = scripted([]);
    const { report } = await importFcstd(file, 'X', { kernel });
    expect(report.leftOut.map((l) => [l.name, l.reason])).toEqual([['Bin', 'binary']]);
    expect(kernel.calls).toBe(0);
    expect(binaryFormProblem('B0.Shape')).toMatch(/binary form/);
    expect(linkArrayProblem('Link')).toMatch(/^Link: a link array/);
  });
});

describe('names from the file', () => {
  it('cleans a label: control characters, white space, length, fallback', () => {
    expect(cleanName('  A\tB\n\u0000C\u007f  D ', 'Box')).toBe('A B C D');
    expect(cleanName('\u0001 \t', 'Box001')).toBe('Box001');
    expect([...cleanName('é'.repeat(300), 'Box')]).toHaveLength(MAX_NAME_LENGTH);
  });

  it('makes a file name by the export rule', () => {
    expect(stepFileName('a/b\\c: d*?"<>|e')).toBe('a b c d e.step');
    expect(stepFileName('..hidden')).toBe('hidden.step');
    expect(stepFileName('///')).toBe('Shape.step');
  });

  it('cuts details with an ellipsis', () => {
    expect(clip('short')).toBe('short');
    const long = clip('y'.repeat(400));
    expect([...long]).toHaveLength(MAX_DETAIL_LENGTH);
    expect(long.endsWith('…')).toBe(true);
  });

  it('writes cleaned names to bodies, features, attachments and the report', async () => {
    const odd = `Lid/\tside  ${'x'.repeat(200)}`;
    const file = fcstd({
      'Document.xml': documentXml([
        { name: 'B0', type: 'Part::Feature', props: [label(odd), placement(), shape('B0.brp')] },
        { name: 'B1', type: 'Part::Feature', props: [label(' \t '), placement(), shape('B1.brp')] },
      ]),
      'B0.brp': BOX,
      'B1.brp': BOX,
    });
    const { design, report } = await importFcstd(file, 'X', { kernel: scripted([]) });
    const doc = design.toJSON();
    const name0 = cleanName(odd, 'B0');
    expect(name0.startsWith('Lid/ side xxx')).toBe(true);
    expect([...name0]).toHaveLength(MAX_NAME_LENGTH);
    expect(report.shapes.map((s) => s.name)).toEqual([name0, 'B1']);
    const features = doc.features.filter((f) => f.type === 'import');
    expect(features.map((f) => f.name)).toEqual([`Import ${name0}`, 'Import B1']);
    expect(doc.bodies[`${features[1]?.id}:0` as never]).toMatchObject({ name: 'B1' });
    const attachment = Object.values(doc.attachments ?? {})[0];
    expect(attachment?.name).toBe(name0);
    expect(attachment?.fileName).toBe(stepFileName(name0));
    expect(attachment?.fileName.includes('/')).toBe(false);
  });
});

describe('the check and the colours', () => {
  it('allows a drift within the tolerance and refuses a moved box', () => {
    const read = good.read;
    expect(disagreement(read, { ...read, volume: 6000 * (1 + 2e-4) })).toBeUndefined();
    expect(disagreement(read, { ...read, box: { min: [0, 0, 0.1], max: [10, 20, 30.1] } })).toMatch(
      /bounding box moved by 0\.100 mm/,
    );
  });

  it('writes 0–1 channels as #rrggbb', () => {
    expect(hexColour([1, 0.5, 0])).toBe('#ff8000');
    expect(hexColour([2, -1, 0.2])).toBe('#ff0033');
  });
});
