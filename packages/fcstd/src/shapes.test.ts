/**
 * The shapes-only import (P6-25 S3, ADR-0144): authored files through
 * `importFcstd` with a kernel in Node, and fake kernels for the failures.
 */
import { Kernel } from '@extrudo/kernel';
import { loadOcct } from '@extrudo/kernel/node';
import { beforeAll, describe, expect, it } from 'vitest';
import { documentXml, fcstd, label, placement, shape } from './fixtures';
import { importFcstd } from './import';
import type { ImportKernel, StoredShapeStep } from './import-kernel';
import { nodeImportKernel } from './node-kernel-test-support';
import { BOX, noShapeFile, shapesFile } from './shape-fixtures';
import { disagreement, hexColour } from './shapes';

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
    expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
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
      ['Box 1', 'check'],
      ['Box 2', 'time'],
    ]);
    expect(report.leftOut[0]?.detail).toMatch(/unreachable/);
    expect(report.shapes.map((s) => s.name)).toEqual(['Box 3']);
    // A throw and a hang each cost the kernel; garbage that came back is only refused.
    expect(kernel.restarts).toBe(2);
    expect(report.restarts).toBe(2);
    expect(kernel.generation).toEqual([0, 1, 1, 2]);
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
      restart: async () => {},
    };
    const { report, files } = await importFcstd(boxes(7), 'X', { kernel });
    expect(report.leftOut.map((l) => [l.name, l.reason])).toEqual([
      ['Box 0', 'too-large'],
      ['Box 6', 'design-full'],
    ]);
    expect(files.size).toBe(5);
  }, 120_000);
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
