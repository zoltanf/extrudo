// Parts lists and balloons end to end (P6-24 S5, ADR-0143's S5 amendment): a
// base frame the kernel builds (a 600 × 400 × 18 top on two 50 × 50 × 700
// legs, the second turned a quarter), its bodies measured by
// `RecomputeEngine.sheetParts` and its balloons resolved by `resolveSheet`,
// then merged, numbered and laid out here, as the app and the CLI will.
//
//   SHEETS_OUT=/some/dir pnpm vitest run packages/sheets/src/parts.kernel
//
// also writes lists.pdf there: an A3 sheet with the front and top views, a
// parts list, balloons, a free table and text fields.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type BodyId,
  createDocument,
  type DocumentId,
  type ExtrudoDocument,
  evaluateParameters,
  type Feature,
  type FeatureId,
  type ParameterId,
  type PrimitiveInputOptions,
  type PrimitiveType,
  primitiveInputs,
  type Sheet,
  type SheetBalloonItem,
  type SheetId,
  type SheetItem,
  type SheetItemId,
  type SheetRefAnchor,
  type SheetViewId,
  sheetStandardFrom,
  sheetViewFrame,
} from '@extrudo/core';
import type { Contour } from '@extrudo/io';
import { Kernel, type ViewGeometry } from '@extrudo/kernel';
import { kernelFeatures, loadOcct, RecomputeEngine } from '@extrudo/kernel/node';
import { loadFont } from '@extrudo/sketch/text';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { layoutSheet, type SheetViewLines } from './layout';
import { sheetItemStatus } from './notes';
import { sheetsToPdf } from './output';
import { sheetBalloonStatus, sheetPartBodies, sheetPartsCells, sheetPartsRows } from './parts';
import { SHEET_FONT } from './text';

const ENV =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

let kernel: Kernel;
let engine: RecomputeEngine;

beforeAll(async () => {
  const fonts = new URL('../../fonts/fonts/', import.meta.url);
  loadFont(SHEET_FONT.regular, readFileSync(new URL('inter-regular.ttf', fonts)));
  loadFont(SHEET_FONT.bold, readFileSync(new URL('inter-bold.ttf', fonts)));
  kernel = new Kernel(await loadOcct());
  engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
});
afterAll(() => {
  engine?.clear();
  expect(kernel.stats().liveShapes).toBe(0);
  kernel?.dispose();
});

function primitive(id: string, options: PrimitiveInputOptions, type: PrimitiveType = 'box') {
  return {
    id: id as FeatureId,
    type,
    name: id,
    suppressed: false,
    inputs: primitiveInputs(type, options),
  } satisfies Feature;
}

const TOP = 'Top:0' as BodyId;
const LEG1 = 'Leg1:0' as BodyId;
const LEG2 = 'Leg2:0' as BodyId;

function frame(): ExtrudoDocument {
  const leg = { length: '50 mm', width: '50 mm', height: 'legs' };
  const features = [
    primitive('Top', {
      numbers: { length: '600 mm', width: '400 mm', height: '18 mm', offset: 'legs' },
    }),
    primitive('Leg1', { numbers: { ...leg, x: '-250 mm', y: '-150 mm' } }),
    primitive('Leg2', { numbers: { ...leg, x: '250 mm', y: '150 mm', rotation: '90 deg' } }),
  ];
  return {
    ...createDocument({
      id: 'doc' as DocumentId,
      name: 'Base frame',
      now: '2026-11-11T10:00:00.000Z',
    }),
    parameters: [
      { id: 'p-legs' as ParameterId, name: 'legs', expression: '700 mm', unit: 'length' },
    ],
    features,
    timelineMarker: features.length,
    bodies: {
      [TOP]: { name: 'Top', visible: true },
      [LEG1]: { name: 'Leg 1', visible: true },
      [LEG2]: { name: 'Leg 2', visible: true },
    },
  };
}

async function recompute(doc: ExtrudoDocument) {
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error(result.status);
  for (const [id, status] of Object.entries(result.features)) {
    if (status.status === 'error') throw new Error(`${id}: ${status.message}`);
  }
}

type AnchorRef = SheetRefAnchor['ref'];

function shapeOf(body: BodyId) {
  const shape = engine.latestBody(body);
  if (shape === undefined) throw new Error(`no body ${body}`);
  return shape;
}
/** The face of `body` whose centroid is nearest `at`. */
function faceNear(body: BodyId, at: [number, number, number]): AnchorRef {
  const faces = kernel.describe(shapeOf(body)).faces;
  const d = (c: readonly number[]) => Math.hypot(...c.map((x, i) => x - (at[i] as number)));
  const index = faces.reduce(
    (best, f, i) => (d(f.centroid) < d(faces[best]?.centroid ?? at) ? i : best),
    0,
  );
  const ref = engine.reference(body, 'face', index) as AnchorRef | undefined;
  if (!ref) throw new Error(`no face near ${at}`);
  return ref;
}
/** An upright edge of `body` (midpoint at `z`) nearest the viewer of the front view (lowest y). */
function uprightEdge(body: BodyId, z: number): AnchorRef {
  const edges = kernel.describe(shapeOf(body)).edges;
  let index = -1;
  edges.forEach((e, i) => {
    if (Math.abs(e.midpoint[2] - z) > 1e-6) return;
    if (index < 0 || e.midpoint[1] < (edges[index]?.midpoint[1] ?? 0)) index = i;
  });
  const ref = engine.reference(body, 'edge', index) as AnchorRef | undefined;
  if (index < 0 || !ref) throw new Error(`no upright edge at ${z}`);
  return ref;
}

const FRONT = 'front' as SheetViewId;
const PLAN = 'plan' as SheetViewId;
const LIST = 'list' as SheetItemId;

function balloons(): SheetBalloonItem[] {
  const b = (id: string, anchor: SheetBalloonItem['anchor'], at: [number, number]) =>
    ({ kind: 'balloon', id: id as SheetItemId, view: FRONT, anchor, at, list: LIST }) as const;
  return [
    b('b-top', { ref: faceNear(TOP, [0, -200, 709]) }, [-150, 820]),
    b('b-leg1', { ref: uprightEdge(LEG1, 350) }, [-380, 450]),
    b('b-leg2', { ref: uprightEdge(LEG2, 350) }, [380, 450]),
  ];
}

function sheetOf(items: SheetItem[]): Sheet {
  return {
    id: 's1' as SheetId,
    name: 'Frame',
    size: 'A3',
    orientation: 'landscape',
    scale: [1, 10],
    projection: 'first',
    decimals: 0,
    border: {},
    titleBlock: {
      template: 'simple',
      fields: { title: '{name}', date: '{date}', units: 'mm', version: '{version}' },
    },
    views: [
      { id: FRONT, name: 'Front', at: [120, 120], from: sheetStandardFrom('front'), label: true },
      {
        id: PLAN,
        name: 'Top',
        at: [120, 185],
        from: { kind: 'projected', parent: FRONT, side: 'below' },
        label: true,
      },
    ],
    items: [
      {
        kind: 'partsList',
        id: LIST,
        view: FRONT,
        at: [250, 205],
        rows: { [TOP]: { material: 'Birch ply' }, [LEG1]: { material: 'Beech' } },
      },
      ...items,
    ],
  };
}

describe('a parts list and balloons on a part the kernel builds (P6-24 S5)', () => {
  it('lists the bodies with their sizes, the two legs in one row, and numbers the balloons', {
    timeout: 60_000,
  }, async () => {
    const doc = frame();
    await recompute(doc);
    const sheet = sheetOf(balloons());
    const report = engine.sheetParts(sheet);
    expect(report.lists[LIST]).toEqual([TOP, LEG1, LEG2]);
    const parts = sheetPartBodies(doc, report);
    const rows = sheetPartsRows(sheet.items[0] as never, parts[LIST] ?? []);
    const cells = rows.map((r) =>
      sheetPartsCells(r, ['item', 'qty', 'name', 'material', 'size'], {}),
    );
    expect(cells).toEqual([
      ['1', '1', 'Top', 'Birch ply', '600 × 400 × 18'],
      ['2', '2', 'Leg', 'Beech', '700 × 50 × 50'],
    ]);
    expect(report.bodies[TOP]?.volume).toBeCloseTo(600 * 400 * 18, 3);
    // Each balloon resolves on its body and shows that body's row.
    const anchors = engine.resolveSheet(sheet);
    expect(anchors['b-top' as SheetItemId]?.[0]).toMatchObject({ status: 'ok', body: TOP });
    expect(anchors['b-leg2' as SheetItemId]?.[0]).toMatchObject({ status: 'ok', body: LEG2 });
    const number = (id: string) =>
      sheetBalloonStatus(
        sheet,
        sheet.items.find((i) => i.id === id) as SheetBalloonItem,
        anchors,
        parts,
      );
    expect(['b-top', 'b-leg1', 'b-leg2'].map((id) => number(id))).toEqual([
      { state: 'ok', number: '1' },
      { state: 'ok', number: '2' },
      { state: 'ok', number: '2' },
    ]);
    // Through layout: the list's cells and the balloons' numbers, keyed by item.
    const list = layoutSheet(sheet, { anchors, parts, name: 'Base frame' });
    const text = (key: string) =>
      list.items.flatMap((i) => (i.type === 'text' && i.key === `item:${key}` ? [i.text] : []));
    expect(text('list')).toContain('700 × 50 × 50');
    expect(['b-top', 'b-leg1', 'b-leg2'].map(text)).toEqual([['1'], ['2'], ['2']]);
    // Taller legs: one size changes, and the balloons still find their bodies.
    const taller = {
      ...doc,
      parameters: [{ ...doc.parameters[0], expression: '720 mm' }],
    } as ExtrudoDocument;
    await recompute(taller);
    const again = sheetPartBodies(taller, engine.sheetParts(sheet));
    expect(sheetPartsRows(sheet.items[0] as never, again[LIST] ?? []).map((r) => r.size)).toEqual([
      [600, 400, 18],
      [720, 50, 50],
    ]);
    const moved = engine.resolveSheet(sheet);
    expect(
      sheetItemStatus(sheet, sheet.items[3] as SheetItem, moved, { parts: again }).state,
    ).not.toBe('detached');
  });

  it('writes the sample with a parts list, balloons, a table and fields', {
    timeout: 60_000,
  }, async () => {
    const doc = frame();
    await recompute(doc);
    const table: SheetItem = {
      kind: 'table',
      id: 'notes' as SheetItemId,
      at: [30, 232],
      columns: [32, 70],
      rows: [
        ['Legs', '{= legs}, two, the second turned a quarter'],
        ['Top', 'Glued and screwed from below; edges sanded to 240 grit'],
        ['Sheet', '{sheet} of {sheets} at {scale}'],
      ],
    };
    const note: SheetItem = {
      kind: 'text',
      id: 'note' as SheetItemId,
      at: [30, 222],
      text: 'Frame height {= legs + 18 mm}, unknown {field} left as typed',
    };
    const sheet = sheetOf([...balloons(), table, note]);
    const anchors = engine.resolveSheet(sheet);
    const parts = sheetPartBodies(doc, engine.sheetParts(sheet));
    const context = {
      name: 'Base frame',
      anchors,
      parts,
      density: 0.68,
      date: '2026-11-11',
      version: 'V2',
      evaluate: evaluateParameters(doc).evaluate,
    };
    const texts = layoutSheet(sheet, context).items.flatMap((i) =>
      i.type === 'text' ? [i.text] : [],
    );
    expect(texts).toContain('Frame height 718 mm, unknown {field} left as typed');
    expect(texts).toContain('1 of 1 at 1:10');
    expect(texts).toContain('Base frame');
    if (!ENV.SHEETS_OUT) return;
    const views = new Map<SheetViewId, SheetViewLines>();
    for (const view of sheet.views) {
      const f = sheetViewFrame(sheet, view.id);
      if (!f) throw new Error('no frame');
      const result = engine.sheetView({ id: view.id, direction: f.direction, up: f.up });
      if ('error' in result) throw new Error(result.error);
      views.set(view.id, linesOf(result.geometry));
    }
    writeFileSync(join(ENV.SHEETS_OUT, 'lists.pdf'), sheetsToPdf([sheet], { ...context, views }));
  });
});

function linesOf(geometry: ViewGeometry): SheetViewLines {
  return {
    curves: geometry.curves.map((curve) => ({
      kind: curve.kind,
      contours: curve.pieces.map((p): Contour => {
        switch (p.type) {
          case 'line':
            return { start: p.a, segments: [{ type: 'line', to: p.b }], closed: false };
          case 'polyline':
            return {
              start: p.points[0] as [number, number],
              segments: p.points.slice(1).map((to) => ({ type: 'line' as const, to })),
              closed: false,
            };
          case 'arc': {
            const at = (s: number): [number, number] => [
              p.center[0] + p.radius * Math.cos(s),
              p.center[1] + p.radius * Math.sin(s),
            ];
            return {
              start: at(p.start),
              segments: [{ type: 'arc', center: p.center, sweep: p.end - p.start, to: at(p.end) }],
              closed: false,
            };
          }
          case 'ellipse': {
            const [c, s] = [Math.cos(p.rotation), Math.sin(p.rotation)];
            const at = (t: number): [number, number] => {
              const [x, y] = [p.rx * Math.cos(t), p.ry * Math.sin(t)];
              return [p.center[0] + x * c - y * s, p.center[1] + x * s + y * c];
            };
            return {
              start: at(p.start),
              segments: [
                {
                  type: 'ellipse',
                  center: p.center,
                  rx: p.rx,
                  ry: p.ry,
                  rotation: p.rotation,
                  sweep: p.end - p.start,
                  to: at(p.end),
                },
              ],
              closed: false,
            };
          }
        }
      }),
    })),
    bounds: geometry.bounds,
  };
}
