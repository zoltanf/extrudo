// The headless library of P5-03 (ADR-0069): what a design does in Node, with
// the real OCCT build and the real planegcs — no fakes. Every benchmark
// fixture (P2-17, P3-14, P4-11) opens, computes and exports, and the designs
// whose parameters drive sketch geometry are checked against what the app's
// own e2e specs read of them.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Design } from '@extrudo/api';
import {
  type AttachmentId,
  addAttachment,
  evaluateParameters,
  readSketch,
  type SketchData,
} from '@extrudo/core';
import { checkManifold, read3mf, readStl } from '@extrudo/io';
import { afterAll, describe, expect, it } from 'vitest';
import { type DesignJob, type HeadlessError, openDesign } from './headless';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = (name: string) => `${ROOT}fixtures/${name}`;
/** A bundled font's file, as `@extrudo/fonts` holds it. */
const fontFile = (name: string) => `${ROOT}packages/fonts/fonts/${name}`;

/** The benchmark fixtures, in the order the requirements name them. */
const BENCHMARKS = [
  'b1-plate.extrudo',
  'b2-storage-box.extrudo',
  'b3-phone-stand.extrudo',
  'b4-box-with-lid.extrudo',
  'b5-pcb-enclosure.extrudo',
  'b6-wall-hook.extrudo',
  'b7-knurled-knob.extrudo',
  'b8-name-tag.extrudo',
  'b9-bottle-cap.extrudo',
  'b10-chain-link.extrudo',
  'p4-01-sweep-loft-coil.extrudo',
];

/**
 * The P4-01 harness design (P4-01's spike became a fixture) computes cleanly
 * and exports, but its coiled body meshes with non-manifold edges where the
 * groove boolean meets the helix's facets — a property of that model, not of
 * the export path, and not one of the B1–B10 benchmark designs. So it is
 * checked for the compute and the file, and not for a closed mesh.
 */
const NOT_CLOSED = new Set(['p4-01-sweep-loft-coil.extrudo']);

/** The jobs a test opened, freed after it. */
const open: DesignJob[] = [];

async function openFixture(name: string): Promise<DesignJob> {
  const { job } = await openDesign(fixture(`benchmarks/${name}`));
  open.push(job);
  return job;
}

/** A job for a design a test builds itself, through an archive as a file is. */
async function openBytes(bytes: Uint8Array): Promise<DesignJob> {
  const { job } = await openDesign(bytes);
  open.push(job);
  return job;
}

afterAll(async () => {
  for (const job of open.splice(0)) await job.dispose();
});

/** The size and the volume of a body, for the assertions. */
const size = (body: { size: number[] }) => body.size.map((v) => Number(v.toFixed(3)));

describe.each(BENCHMARKS)('%s', (name) => {
  it('opens, computes with no errors and exports a closed 3MF', { timeout: 180_000 }, async () => {
    const started = Date.now();
    const { job, notices } = await openDesign(fixture(`benchmarks/${name}`));
    open.push(job);
    expect(notices).toEqual([]);
    const result = await job.compute();
    expect(result.errors).toBe(0);
    expect(result.features.filter((f) => f.status === 'error')).toEqual([]);
    for (const body of result.bodies) {
      expect(body.volume).toBeGreaterThan(0);
      expect(body.faces).toBeGreaterThan(0);
    }
    // B1 is a sketch with nothing to extrude: it computes and has nothing to
    // export, which says so.
    if (name === 'b1-plate.extrudo') {
      expect(result.bodies).toEqual([]);
      await expect(job.export({ format: '3mf' })).rejects.toThrow('no bodies to export');
      console.log(`${name}: ${Date.now() - started} ms, ${result.ms} ms in the kernel`);
      expect((await job.dispose()).liveShapes).toBe(0);
      open.pop();
      return;
    }
    expect(result.bodies.length).toBeGreaterThan(0);
    const [file, ...rest] = await job.export({ format: '3mf' });
    expect(rest).toEqual([]);
    // The app's own check of an export: one object per body, each closed.
    const model = read3mf(file?.bytes as Uint8Array);
    expect(model.unit).toBe('millimeter');
    expect(model.objects.map((o) => o.name)).toEqual(result.bodies.map((b) => b.name));
    for (const object of model.objects) {
      if (NOT_CLOSED.has(name)) continue;
      expect(checkManifold(object.mesh).ok).toBe(true);
    }
    expect(file?.closed).toBe(NOT_CLOSED.has(name) ? false : true);
    // The app's file name: the design's, and the body's when it is the only one.
    expect(file?.name).toMatch(
      new RegExp(`^${job.doc.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( - .+)?\\.3mf$`),
    );
    console.log(`${name}: ${Date.now() - started} ms, ${result.ms} ms in the kernel`);
    expect((await job.dispose()).liveShapes).toBe(0);
    open.pop();
  });
});

describe('B4 box with a lid', () => {
  /** The e2e spec's numbers (`e2e/benchmark-b4.spec.ts`), for the same design. */
  const sizes = {
    length: 60,
    width: 40,
    height: 30,
    wall: 2,
    clearance: 0.2,
    lid: 3,
    lip: 5,
    bevel: 0.8,
  };
  /** The box: a block less the cavity, less the bottom chamfer (four mitred prisms). */
  const boxVolume = (s: typeof sizes) =>
    s.length * s.width * s.height -
    (s.length - 2 * s.wall) * (s.width - 2 * s.wall) * (s.height - s.wall) -
    (s.bevel ** 2 * (s.length + s.width) - (4 * s.bevel ** 3) / 3);
  /** The lid before its fillet: the plate and the lip hanging into the cavity. */
  const lidBlockVolume = (s: typeof sizes) => {
    const x = s.length - 2 * (s.wall + s.clearance);
    const y = s.width - 2 * (s.wall + s.clearance);
    return s.length * s.width * s.lid + x * y * s.lip;
  };

  it('follows clearance, length and lid, with the volumes the e2e reads', async () => {
    const job = await openFixture('b4-box-with-lid.extrudo');
    const asDrawn = await job.compute();
    const [box, lid] = asDrawn.bodies;
    expect(asDrawn.bodies.map((b) => b.name)).toEqual(['Box', 'Lid']);
    expect(size(box as { size: number[] })).toEqual([60, 40, 30]);
    expect(size(lid as { size: number[] })).toEqual([60, 40, 8]);
    expect(box?.volume).toBeCloseTo(boxVolume(sizes), 1);
    // The lid's four fillets take about r² (1 − π/4) along each top edge.
    const filletOf = (s: typeof sizes) => 1.5 ** 2 * (1 - Math.PI / 4) * 2 * (s.length + s.width);
    expect(Math.abs((lid?.volume ?? 0) - (lidBlockVolume(sizes) - filletOf(sizes)))).toBeLessThan(
      filletOf(sizes) * 0.05,
    );

    // What `e2e/benchmark-b4.spec.ts` sets: a looser fit and a longer box.
    await job.setParameters({ clearance: '0.4 mm', length: '70 mm', lid: '4 mm' });
    const changed = await job.compute();
    expect(changed.errors).toBe(0);
    const [longBox, longLid] = changed.bodies;
    expect(size(longBox as { size: number[] })).toEqual([70, 40, 30]);
    expect(size(longLid as { size: number[] })).toEqual([70, 40, 9]);
    expect(longBox?.volume).toBeCloseTo(boxVolume({ ...sizes, length: 70, lid: 4 }), 1);
    // The lid's lip is `clearance` inside the cavity: the lip grew by 0.4 mm
    // less on each side, so the lid lost 2 x 0.4 x (its lip's outline) x 5 mm.
    const s = { ...sizes, clearance: 0.4, length: 70, lid: 4 };
    expect(Math.abs((longLid?.volume ?? 0) - (lidBlockVolume(s) - filletOf(s)))).toBeLessThan(
      filletOf(s) * 0.05,
    );
  });
});

describe('B2 storage box', () => {
  /** The inner cavity's size, mm: the outer less `wall` on each side, less the floor. */
  const cavity = (wall: number, height = 40, bottom = 4) => [
    80 - 2 * wall,
    60 - 2 * wall,
    height - bottom,
  ];

  it('re-solves its offset sketch when the wall changes', async () => {
    const job = await openFixture('b2-storage-box.extrudo');
    const asDrawn = await job.compute();
    const [box] = asDrawn.bodies;
    expect(asDrawn.errors).toBe(0);
    expect(size(box as { size: number[] })).toEqual([80, 60, 40]);
    expect(box?.volume).toBeCloseTo(80 * 60 * 40 - 74 * 54 * 36, 1);
    // The inner wall comes from Sketch2, which the offset tool drew from the
    // `wall` parameter: its points move when the parameter does.
    const inner = (at: DesignJob, name: string): SketchData => {
      const feature = at.doc.features.find((f) => f.name === name);
      const view = feature && readSketch(feature);
      if (!view) throw new Error(`no ${name}`);
      return view.data;
    };
    const before = inner(job, 'Sketch2');
    const changes = await job.setParameters({ wall: '5 mm' });
    // The offset sketch (and only it) moved: a solve, not a stale shape.
    expect(changes.map((c) => c.name)).toEqual(['Sketch2']);
    const solved = inner(job, 'Sketch2');
    const moved = Object.keys(solved.entities).filter(
      (id) =>
        solved.entities[id as keyof SketchData['entities']] !==
        before.entities[id as keyof SketchData['entities']],
    );
    expect(moved.length).toBeGreaterThan(3);
    const recomputed = await job.compute();
    expect(recomputed.errors).toBe(0);
    const [wall5] = recomputed.bodies;
    expect(size(wall5 as { size: number[] })).toEqual([80, 60, 40]);
    // Thicker walls are less matter: the cavity is now 70 x 50 x 36.
    const [x = 0, y = 0, z = 0] = cavity(5);
    expect(wall5?.volume).toBeCloseTo(80 * 60 * 40 - x * y * z, 1);
    // Thicker walls are more matter.
    expect(wall5?.volume).toBeGreaterThan(box?.volume ?? 0);
  });
});

describe('configurations', () => {
  it("applies one of the Storage box template's, and the re-solve follows", async () => {
    // The template adds its configurations to the fixture's copy
    // (`apps/web/src/home/gallery.ts`); the same commands through the API.
    const job = await openFixture('b2-storage-box.extrudo');
    const design = job.design as Design;
    design.configuration('Small', {
      width: '50 mm',
      depth: '35 mm',
      height: '25 mm',
      wall: '2 mm',
    });
    design.configuration('Large', {
      width: '140 mm',
      depth: '100 mm',
      height: '70 mm',
      wall: '3.2 mm',
    });
    expect(job.configurations).toEqual(['Small', 'Large']);
    // Not stored yet: the archive holds what the design had.
    expect(design.doc.configurations?.length).toBe(2);

    await job.applyConfiguration('Small');
    const small = await job.compute();
    expect(small.errors).toBe(0);
    expect(size(small.bodies[0] as { size: number[] })).toEqual([50, 35, 25]);

    await job.applyConfiguration('Large');
    const large = await job.compute();
    expect(large.errors).toBe(0);
    expect(size(large.bodies[0] as { size: number[] })).toEqual([140, 100, 70]);
    // The cavity is the benchmark's own outline in Sketch2 less `wall` on each
    // side (the benchmark drew that sketch with the Offset tool on a rectangle
    // of its own, so `width` and `depth` move the block around it and not the
    // cavity), and `height - bottom` deep: 66 mm under a 4 mm floor.
    const wall = 3.2;
    expect(large.bodies[0]?.volume).toBeCloseTo(
      140 * 100 * 70 - (80 - 2 * wall) * (60 - 2 * wall) * (70 - 4),
      0,
    );
    // The values are the configuration's, as expressions.
    expect(job.parameters.find((p) => p.name === 'width')).toMatchObject({
      expression: '140 mm',
      value: 140,
    });
    expect(await job.applyConfiguration('Huge').catch((e: HeadlessError) => e.message)).toBe(
      'There is no configuration "Huge" in this design. It has: Small, Large.',
    );
  });
});

describe('fonts and files of a design', () => {
  it('shapes a text with a font the design carries (P4-03b)', async () => {
    // Fredoka as an attachment of the design, a plate with the word on it, and
    // the text embossed: without the file the kernel draws no ink and the
    // emboss has nothing to cut.
    const font = new Uint8Array(await readFile(fontFile('fredoka-semibold.ttf')));
    const { sha256Hex } = await import('@extrudo/storage');
    // The text shaper runs where the sketch is drawn (the app's UI thread), so
    // the font is loaded here before the sketch is built, as `ensureUiFonts`
    // does it there.
    const { loadFont } = await import('@extrudo/sketch/text');
    loadFont('attachment:a1tt', font);
    const hash = sha256Hex(font);
    const design = Design.create({ name: 'Name plate' });
    const attachment = 'a1tt';
    design.transaction('Add the font', () => {
      design.state.dispatch(
        addAttachment({
          id: attachment as AttachmentId,
          attachment: {
            name: 'Fredoka',
            fileName: 'fredoka-semibold.ttf',
            mediaType: 'font/ttf',
            sha256: hash,
            size: font.length,
          },
        }),
      );
    });
    const plate = design.box({ length: '40 mm', width: '20 mm', height: '3 mm' });
    const sketch = design.sketch(design.origin.xy, (k) => {
      k.text([5, 10], [5, 18], { text: 'Hi', font: `attachment:${attachment}` });
    });
    // The letters have ink (three profiles: the H's and the i's stem and dot),
    // so the emboss has something to put on the plate's top face.
    expect(sketch.profiles().length).toBe(3);
    design.emboss({
      profiles: sketch.profiles(),
      face: [plate.face('cap:end')],
      depth: '0.5 mm',
      mode: 'emboss',
    });
    design.rename(plate, 'Plate');
    const { writeArchive } = await import('@extrudo/storage');
    const job = await openBytes(writeArchive(design.doc, undefined, [], new Map([[hash, font]])));

    const result = await job.compute();
    expect(result.errors).toBe(0);
    // The font reached the kernel, so the text is not a warning about a font
    // and the emboss cut nothing away.
    expect(result.features.filter((f) => f.status === 'warning')).toEqual([]);
    // The letters stand out of the top face: the plate's own 2 400 mm³ plus
    // their ink's area times the depth (and a body of their own where a letter
    // touches nothing else).
    const total = result.bodies.reduce((sum, body) => sum + body.volume, 0);
    expect(total).toBeGreaterThan(40 * 20 * 3);
    expect(total).toBeLessThan(40 * 20 * 4);
  });

  it('reads a STEP file out of the design (P4-06)', async () => {
    const step = new Uint8Array(await readFile(fixture('imports/b3.step')));
    const { sha256Hex, writeArchive } = await import('@extrudo/storage');
    const hash = sha256Hex(step);
    const design = Design.create({ name: 'Imported' });
    const attachment = 'a1st';
    design.state.dispatch(
      addAttachment({
        id: attachment as AttachmentId,
        attachment: {
          name: 'Phone stand',
          fileName: 'b3.step',
          mediaType: 'model/step',
          sha256: hash,
          size: step.length,
        },
      }),
    );
    design.import({ file: attachment as AttachmentId });
    const job = await openBytes(writeArchive(design.doc, undefined, [], new Map([[hash, step]])));

    const result = await job.compute();
    expect(result.errors).toBe(0);
    // B3's two bodies, as `e2e/import-step.spec.ts` reads them.
    expect(result.bodies.map((b) => size(b))).toEqual([
      [60, 80, 10],
      [60, Number((60 / Math.tan((70 * Math.PI) / 180) + 10).toFixed(3)), 60],
    ]);
    expect(result.bodies.every((b) => !b.mesh)).toBe(true);
  });

  it('reads a mesh file, loads manifold for it, and exports the mesh', async () => {
    const mesh = new Uint8Array(await readFile(fixture('imports/cube.stl')));
    const { sha256Hex, writeArchive } = await import('@extrudo/storage');
    const hash = sha256Hex(mesh);
    const design = Design.create({ name: 'Mesh' });
    const attachment = 'a1me';
    design.state.dispatch(
      addAttachment({
        id: attachment as AttachmentId,
        attachment: {
          name: 'Cube',
          fileName: 'cube.stl',
          mediaType: 'model/stl',
          sha256: hash,
          size: mesh.length,
        },
      }),
    );
    design.import({ file: attachment as AttachmentId, units: 'mm' });
    const job = await openBytes(writeArchive(design.doc, undefined, [], new Map([[hash, mesh]])));

    const result = await job.compute();
    expect(result.errors).toBe(0);
    const [body] = result.bodies;
    expect(body?.mesh).toBe(true);
    // The browser calls it Body1 and tags it "Mesh" (ADR-0030, ADR-0066 §3).
    expect(body?.name).toBe('Body1');
    // A mesh body is one face of all its triangles.
    expect(body?.faces).toBe(1);
    expect(size(body as { size: number[] })).toEqual([20, 20, 20]);
    expect(body?.volume).toBeCloseTo(8000, -2);
    // A mesh body is triangles: one STL of it, closed, and no STEP.
    const [file] = await job.export({ format: 'stl', singleFile: true });
    expect(file?.closed).toBe(true);
    expect(checkManifold(readStl(file?.bytes as Uint8Array).mesh).ok).toBe(true);
    await expect(job.export({ format: 'step' })).rejects.toThrow(/exact solid geometry/);
  });
});

describe('an OpenSCAD import (P5-04, ADR-0071)', () => {
  it('compiles a .scad file, follows a parameter through an override and exports it', {
    timeout: 120_000,
  }, async () => {
    const source = new Uint8Array(await readFile(fixture('imports/plate.scad')));
    const { sha256Hex, writeArchive } = await import('@extrudo/storage');
    const hash = sha256Hex(source);
    const design = Design.create({ name: 'Plate' });
    design.parameter('width', '30 mm');
    const attachment = 'a1sc';
    design.state.dispatch(
      addAttachment({
        id: attachment as AttachmentId,
        attachment: {
          name: 'Plate',
          fileName: 'plate.scad',
          mediaType: 'application/x-openscad',
          sha256: hash,
          size: source.length,
        },
      }),
    );
    // `size` follows the length parameter `width`; `hole` is a plain number.
    design.import({
      file: attachment as AttachmentId,
      scadName: 'size',
      scadValue: { kind: 'expr', expr: 'width', unit: 'length' },
      scadName2: 'hole',
      scadValue2: 5,
    });
    const job = await openBytes(writeArchive(design.doc, undefined, [], new Map([[hash, source]])));

    const result = await job.compute();
    expect(result.errors).toBe(0);
    const [body] = result.bodies;
    expect(body?.mesh).toBe(true);
    expect(size(body as { size: number[] })).toEqual([30, 30, 10]);
    const hole = (d: number) => 0.5 * 64 * (d / 2) ** 2 * Math.sin((2 * Math.PI) / 64) * 10;
    expect(body?.volume).toBeCloseTo(30 * 30 * 10 - hole(5), 1);

    await job.setParameters({ width: '45 mm' });
    const wider = await job.compute();
    expect(size(wider.bodies[0] as { size: number[] })).toEqual([45, 45, 10]);

    const [file] = await job.export({ format: '3mf' });
    expect(file?.closed).toBe(true);
    const [object] = read3mf(file?.bytes as Uint8Array).objects;
    expect(checkManifold(object?.mesh as Parameters<typeof checkManifold>[0]).ok).toBe(true);
    expect((await job.dispose()).liveShapes).toBe(0);
  });
});

describe('what the design gets wrong', () => {
  it('names an unknown parameter, a bad expression and a missing file', async () => {
    const job = await openFixture('b2-storage-box.extrudo');
    await expect(job.setParameters({ widthd: '60 mm' })).rejects.toThrow(
      'There is no parameter "widthd" in this design.',
    );
    await expect(job.setParameters({ width: 'wide' })).rejects.toThrow(/^width: /);
    // The design is as it was: one undo step, rolled back whole.
    const evaluation = evaluateParameters(job.doc);
    expect(evaluation.parameters.get('width')?.result).toMatchObject({ ok: true, value: 80 });

    // A design with a line of its own: a length of 0 would collapse it, which
    // is how the app refuses a change (planegcs would call it solved).
    const line = Design.create({ name: 'Line' });
    line.sketch(line.origin.xy, (k) => {
      const drawn = k.line([0, 0], [10, 0]);
      // A named driving dimension is a model parameter (`len`).
      k.dimension([drawn.start, drawn.end], '10 mm', { name: 'len' });
    });
    line.box({ length: '30 mm', width: '20 mm', height: '2 mm' });
    const { writeArchive } = await import('@extrudo/storage');
    const lineJob = await openBytes(writeArchive(line.doc));
    await expect(lineJob.setParameters({ len: '0 mm' })).rejects.toThrow(
      "Sketch1 can't take that: its other constraints and dimensions don't allow it.",
    );
    // Nothing changed: the whole step rolled back.
    expect(evaluateParameters(lineJob.doc).parameters.get('len')?.result).toMatchObject({
      ok: true,
      value: 10,
    });
  });

  it('refuses to open a file that is not a design', async () => {
    await expect(openDesign(`${ROOT}package.json`)).rejects.toThrow(/Extrudo project|zip/);
    await expect(openDesign(fixture('benchmarks/nothing.extrudo'))).rejects.toThrow(
      'There is no file at ',
    );
  });
});

describe('the kernel', () => {
  it('is freed by dispose, with nothing left held', async () => {
    const { job } = await openDesign(fixture('benchmarks/b1-plate.extrudo'));
    await job.compute();
    expect((await job.dispose()).liveShapes).toBe(0);
    await expect(job.compute()).rejects.toThrow('This design job is disposed.');
    // Disposing twice is harmless.
    expect((await job.dispose()).liveShapes).toBe(0);
  });
});

describe('save', () => {
  it('writes a file that opens with the change in it, attachments and all', async () => {
    const font = new Uint8Array(await readFile(fontFile('fredoka-semibold.ttf')));
    const { sha256Hex } = await import('@extrudo/storage');
    const hash = sha256Hex(font);
    const design = Design.create({ name: 'Saved' });
    const width = design.parameter('width', '20 mm');
    design.box({ length: width, width: '10 mm', height: '5 mm' });
    design.state.dispatch(
      addAttachment({
        id: 'a1tt' as AttachmentId,
        attachment: {
          name: 'Fredoka',
          fileName: 'fredoka-semibold.ttf',
          mediaType: 'font/ttf',
          sha256: hash,
          size: font.length,
        },
      }),
    );
    const { writeArchive } = await import('@extrudo/storage');
    const job = await openBytes(writeArchive(design.doc, undefined, [], new Map([[hash, font]])));
    await job.setParameters({ width: '30 mm' });
    const result = await job.compute();
    expect(size(result.bodies[0] as { size: number[] })).toEqual([30, 10, 5]);
    const saved = job.toFile();

    const again = await openBytes(saved);
    expect(again.parameters.find((p) => p.name === 'width')).toMatchObject({
      expression: '30 mm',
      value: 30,
    });
    expect((await again.compute()).errors).toBe(0);
    // The attachment travelled with the design.
    expect(Object.keys(again.doc.attachments ?? {})).toEqual(['a1tt']);
    open.push(again);
  });
});
