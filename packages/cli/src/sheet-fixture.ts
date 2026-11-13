/**
 * The drawing fixture (P6-24 S6): `fixtures/sheets/plate.extrudo`, a plate
 * and a peg with two sheets, built through the document API, with every
 * anchor's fingerprint from a real recompute (the API has no kernel). The
 * CLI tests and CI's sheet export run on it; `sheets.test.ts` checks that
 * the file is what this builds, and `UPDATE_FIXTURE=1 pnpm vitest run
 * packages/cli/src/sheets` writes it again.
 *
 * "Plate" (A3, 1:1, first angle) has the four standard views of both bodies, a
 * dimension on the plate's top front edge, the peg's diameter and centre
 * mark in the top view, a leader note, a parts list with a balloon on each
 * body, a text with fields and a printed sticky note; "Notes" (A4 portrait)
 * holds a table, a text and a sticky note on screen only.
 */
import { Design, type FeatureHandle } from '@extrudo/api';
import type { BodyId, ExtrudoDocument, GeomRef } from '@extrudo/core';
import { Kernel } from '@extrudo/kernel';
import { kernelFeatures, loadOcct, RecomputeEngine } from '@extrudo/kernel/node';

/** The fixture's path from the repository root. */
export const SHEET_FIXTURE = 'fixtures/sheets/plate.extrudo';

/** The time stamped into the fixture, so it is the same every time. */
const NOW = '2026-11-11T09:00:00.000Z';

/** The design, built the same way every time. */
export async function sheetFixture(): Promise<ExtrudoDocument> {
  const d = Design.create({ name: 'Plate', now: NOW, appVersion: 'fixture' });
  d.parameter('width', '60 mm');
  const plate = d.box({ length: 'width', width: '40 mm', height: '10 mm' }, { name: 'Plate' });
  const peg = d.cylinder(
    { x: '80 mm', y: '20 mm', diameter: '16 mm', height: '20 mm' },
    { name: 'Peg' },
  );
  const refs = await fingerprinted(d, [
    [plate, plate.edge([plate.faceName('cap:end'), plate.faceName('side:front')])],
    [peg, peg.edge([peg.faceName('cap:end'), peg.faceName('side:wall')])],
    [plate, plate.face('cap:end')],
    [peg, peg.face('cap:end')],
  ]);
  const [plateEdge, pegCircle, plateTop, pegTop] = refs as [GeomRef, GeomRef, GeomRef, GeomRef];
  const sheet = d.addSheet('Plate', {
    start: 'standard',
    at: { front: [50, 110], top: [50, 210], side: [210, 110], iso: [300, 215] },
    fields: { title: 'Plate and peg', units: 'mm', date: '{date}', version: '{version}' },
  });
  const front = sheet.view('Front');
  const top = sheet.view('Top');
  if (!front || !top) throw new Error('The standard views are missing.');
  front.addDimension(
    'linear',
    [
      { ref: plateEdge, at: 'start' },
      { ref: plateEdge, at: 'end' },
    ],
    [30, 18],
    {
      direction: 'horizontal',
    },
  );
  top.addDimension('diameter', [pegCircle], [104, 44]);
  top.addCentreMark(pegCircle);
  front.addLeader({ ref: plateEdge, at: 'middle' }, [10, -20], 'Break the edge {= width / 60}');
  const list = front.addPartsList([250, 20], {
    rows: [
      { body: plate, name: 'Plate', material: 'PETG' },
      { body: peg, name: 'Peg', material: 'PLA' },
    ],
  });
  top.addBalloon(plateTop, [-15, 55], list);
  top.addBalloon(pegTop, [110, 5], list);
  sheet.addText('Drawn {date}, {version}. Sheet {sheet} of {sheets}.', [20, 255], { size: 3.5 });
  sheet.addSticky('Printed note', [200, 240], { print: true });
  const notes = d.addSheet('Notes', { size: 'A4', orientation: 'portrait', titleBlock: false });
  notes.addTable(
    [20, 20],
    [
      ['Rev', 'What'],
      ['A', 'First drawing'],
    ],
    { columns: [15, 60] },
  );
  notes.addText('All edges 0.5 mm unless noted.', [20, 60]);
  notes.addSticky('On screen only', [20, 90]);
  return d.toJSON();
}

/** The references with their fingerprints, from one recompute of `d` as it is. */
async function fingerprinted(
  d: Design,
  wanted: readonly [FeatureHandle, GeomRef][],
): Promise<GeomRef[]> {
  const kernel = new Kernel(await loadOcct());
  const engine = new RecomputeEngine(kernel, kernelFeatures());
  try {
    const result = await engine.recompute({ doc: d.doc });
    if (result.status !== 'done') throw new Error('The fixture did not compute.');
    return wanted.map(([feature, ref]) => {
      const body = `${feature.id}:0` as BodyId;
      const found = engine.reference(body, ref.kind as 'face' | 'edge' | 'vertex', ref.id);
      if (!found?.fingerprint) throw new Error(`${ref.id} is not on ${body}.`);
      return found;
    });
  } finally {
    engine.clear();
    kernel.dispose();
  }
}
