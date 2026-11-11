// The drawings example (P6-24 S6, ADR-0143): a spool holder of two parts, a bracket with a
// bore and two screw holes and an axle that fits the bore, and one sheet of it: the standard
// views, dimensions, centre marks and a centre line, a leader note, a parts list with a
// balloon on each part, a text with a parameter field and the title block's fields. Built
// through the API with every anchor's fingerprint from a real recompute (the API has no
// kernel). With `WRITE_FIXTURES=1` this test (re)writes `fixtures/benchmarks/spool-holder.extrudo`
// (the examples gallery bundles that folder); without it, it checks the file holds what the
// code builds, and that on opening every feature computes and no anchor of the sheet is lost.
//
//   WRITE_FIXTURES=1 pnpm vitest run packages/cli/src/example-sheet
//   SHEETS_OUT=<dir> pnpm vitest run packages/cli/src/example-sheet   # also writes its SVG and PDF
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Design, type FeatureHandle } from '@extrudo/api';
import type { BodyId, GeomRef } from '@extrudo/core';
import { Kernel } from '@extrudo/kernel';
import { kernelFeatures, loadOcct, RecomputeEngine } from '@extrudo/kernel/node';
import { readArchive } from '@extrudo/storage';
import { describe, expect, it } from 'vitest';
import { openDesign } from './headless';
import { SPOOL_HOLDER_VIEWS, spoolHolderModel } from './spool-holder';

const FILE = fileURLToPath(
  new URL('../../../fixtures/benchmarks/spool-holder.extrudo', import.meta.url),
);

/** The two parts and the references the sheet anchors to (no fingerprints yet). */
function model() {
  // UUID-shaped IDs as the app makes them, but the same every run (the fixture is compared).
  let n = 0;
  const ids = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const d = Design.create({
    name: 'Spool holder',
    units: 'mm',
    now: '2026-11-11T00:00:00.000Z',
    ids,
  });
  const { plate, boss, bore, screws, shaft, flange } = spoolHolderModel(d);
  const [left, right] = screws;
  const wanted: Record<string, [FeatureHandle, GeomRef]> = {
    plateFront: [plate, plate.edge([plate.faceName('cap:start'), plate.faceName('side:front')])],
    plateSide: [plate, plate.edge([plate.faceName('side:right'), plate.faceName('side:front')])],
    plateDepth: [plate, plate.edge([plate.faceName('cap:end'), plate.faceName('side:right')])],
    plateLeft: [plate, plate.edge([plate.faceName('side:left'), plate.faceName('side:front')])],
    bossTop: [plate, plate.edge([boss.faceName('cap:end'), boss.faceName('side:wall')])],
    boreTop: [plate, plate.edge([boss.faceName('cap:end'), bore.faceName('side:wall')])],
    leftHole: [plate, plate.edge([plate.faceName('cap:end'), left.faceName('side:wall')])],
    rightHole: [plate, plate.edge([plate.faceName('cap:end'), right.faceName('side:wall')])],
    shaftWall: [shaft, shaft.face('side:wall')],
    flangeTop: [shaft, shaft.edge([flange.faceName('cap:end'), flange.faceName('side:wall')])],
  };
  return { d, plate, shaft, wanted };
}

/** The references with their fingerprints, from one recompute of `d` as it is. */
async function fingerprinted(
  d: Design,
  wanted: Record<string, [FeatureHandle, GeomRef]>,
): Promise<Record<string, GeomRef>> {
  const kernel = new Kernel(await loadOcct());
  const engine = new RecomputeEngine(kernel, kernelFeatures());
  try {
    const result = await engine.recompute({ doc: d.doc });
    if (result.status !== 'done') throw new Error('The example did not compute.');
    const out: Record<string, GeomRef> = {};
    for (const [key, [feature, ref]] of Object.entries(wanted)) {
      const body = `${feature.id}:0` as BodyId;
      const found = engine.reference(body, ref.kind as 'face' | 'edge' | 'vertex', ref.id);
      if (!found?.fingerprint) throw new Error(`${key}: ${ref.id} is not on ${body}.`);
      out[key] = found;
    }
    return out;
  } finally {
    engine.clear();
    kernel.dispose();
  }
}

/** The design with its sheet. */
async function spoolHolder() {
  const { d, plate, shaft, wanted } = model();
  const r = await fingerprinted(d, wanted);
  const ref = (key: string): GeomRef => {
    const found = r[key];
    if (!found) throw new Error(`No reference ${key}`);
    return found;
  };
  // A4 landscape at 1:1, first angle: the top view under the front, the left side to its right.
  const sheet = d.addSheet('Spool holder', {
    size: 'A4',
    start: 'standard',
    at: SPOOL_HOLDER_VIEWS,
    fields: { title: 'Spool holder', units: 'mm', date: '{date}' },
  });
  const front = sheet.view('Front');
  const top = sheet.view('Top');
  if (!front || !top) throw new Error('The standard views are missing.');
  // The front view: x right, z up, the plate's underside at 0.
  front.addDimension(
    'linear',
    [
      { ref: ref('plateFront'), at: 'start' },
      { ref: ref('plateFront'), at: 'end' },
    ],
    [0, -10],
    { direction: 'horizontal' },
  );
  front.addDimension(
    'linear',
    [
      { ref: ref('plateSide'), at: 'start' },
      { ref: ref('plateSide'), at: 'end' },
    ],
    [50, 3],
    { direction: 'vertical' },
  );
  front.addCentreLine([ref('shaftWall')]);
  // The top view: x right, y up, the bore at the middle.
  top.addDimension('diameter', [ref('boreTop')], [24, 24]);
  top.addDimension(
    'linear',
    [
      { ref: ref('plateDepth'), at: 'start' },
      { ref: ref('plateDepth'), at: 'end' },
    ],
    [50, 0],
    { direction: 'vertical' },
  );
  top.addDimension(
    'linear',
    [
      { ref: ref('leftHole'), at: 'centre' },
      { ref: ref('rightHole'), at: 'centre' },
    ],
    [0, -28],
    { direction: 'horizontal' },
  );
  for (const hole of ['boreTop', 'leftHole', 'rightHole']) top.addCentreMark(ref(hole));
  top.addLeader(ref('leftHole'), [-26, 34], '2 holes Ø4.5 for M4 screws');
  const list = front.addPartsList([172, 118], {
    columns: ['item', 'qty', 'name', 'material', 'size'],
    rows: [
      { body: plate, material: 'PETG' },
      { body: shaft, material: 'PETG' },
    ],
  });
  front.addBalloon({ ref: ref('plateLeft'), at: 'middle' }, [-56, 22], list);
  front.addBalloon(ref('shaftWall'), [24, 44], list);
  sheet.addText(
    'Bore Ø{= axle + clearance} for a Ø{= axle} axle.\nPrint both parts standing on their flat faces.',
    [20, 182],
    { size: 3 },
  );
  return d;
}

describe('the drawings example', () => {
  it('builds, computes, every anchor of its sheet found, and matches the fixture', {
    timeout: 180_000,
  }, async () => {
    const d = await spoolHolder();
    const bytes = await d.toFile();
    if (process.env.WRITE_FIXTURES) await writeFile(FILE, bytes);
    // The checked-in file: the document the code builds (its dates aside).
    const checkedIn = new Uint8Array(await readFile(FILE));
    const { meta: _stored, ...stored } = readArchive(checkedIn).doc;
    const { meta: _built, ...built } = d.toJSON();
    expect(stored).toEqual(built);
    const { job } = await openDesign(checkedIn);
    try {
      const computed = await job.compute();
      expect(computed.features.filter((f) => f.status !== 'ok')).toEqual([]);
      const [report] = await job.checkSheets();
      expect(report).toMatchObject({ name: 'Spool holder', views: 4, detached: 0, problems: [] });
      const out = process.env.SHEETS_OUT;
      if (out) {
        await mkdir(out, { recursive: true });
        for (const format of ['svg', 'pdf'] as const) {
          for (const file of await job.exportSheets({ format, date: '2026-11-11' })) {
            await writeFile(join(out, file.name), file.bytes);
          }
        }
      }
    } finally {
      await job.dispose();
    }
  });
});
