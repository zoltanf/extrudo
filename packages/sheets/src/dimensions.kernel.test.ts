// Dimensions end to end (P6-24 S3, ADR-0143's S3 amendment): a part the
// kernel builds, its anchors resolved by `RecomputeEngine.resolveSheet`, then
// measured and laid out here, as the app and the CLI will. The sizes are
// known: a 60 × 40 × 10 plate with a Ø16 boss 20 high, a Ø8 hole 30 from the
// boss, and a block beside it turned by 30°.
//
//   SHEETS_OUT=/some/dir pnpm vitest run packages/sheets/src/dimensions.kernel
//
// also writes dimensions.pdf there: an A3 sheet with every type, one moved
// and one detached, drawn on the views the kernel computes.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type BodyId,
  createDocument,
  type DocumentId,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  type Parameter,
  type ParameterId,
  type PrimitiveInputOptions,
  type PrimitiveType,
  primitiveInputs,
  type Sheet,
  type SheetAnchor,
  type SheetDimensionItem,
  type SheetId,
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
import { measureSheetDimension } from './dimensions';
import type { SheetViewLines } from './layout';
import { sheetsToPdf } from './output';
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

function primitive(id: string, type: PrimitiveType, options: PrimitiveInputOptions): Feature {
  return {
    id: id as FeatureId,
    type,
    name: id,
    suppressed: false,
    inputs: primitiveInputs(type, options),
  };
}

function part(length = '60 mm'): ExtrudoDocument {
  const features = [
    primitive('Plate', 'box', { numbers: { length: 'length', width: '40 mm', height: '10 mm' } }),
    primitive('Boss', 'cylinder', {
      numbers: { diameter: '16 mm', height: '20 mm', x: '-15 mm', offset: '10 mm' },
      operation: 'join',
    }),
    primitive('Hole', 'cylinder', {
      numbers: { diameter: '8 mm', height: '10 mm', x: '15 mm' },
      operation: 'cut',
    }),
    primitive('Turned', 'box', {
      numbers: { length: '20 mm', width: '10 mm', height: '5 mm', y: '-40 mm', rotation: '30 deg' },
    }),
  ];
  const parameter: Parameter = {
    id: 'p-length' as ParameterId,
    name: 'length',
    expression: length,
    unit: 'length',
  };
  return {
    ...createDocument({ id: 'doc' as DocumentId, name: 'Plate', now: '2026-11-11T10:00:00.000Z' }),
    parameters: [parameter],
    features,
    timelineMarker: features.length,
  };
}

async function recompute(doc: ExtrudoDocument) {
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error(result.status);
  for (const [id, status] of Object.entries(result.features)) {
    if (status.status === 'error') throw new Error(`${id}: ${status.message}`);
  }
}

function shapeOf(body: BodyId) {
  const shape = engine?.latestBody(body);
  if (shape === undefined) throw new Error(`no body ${body}`);
  return shape;
}

/** A reference as a sheet anchor keeps it. */
type AnchorRef = SheetRefAnchor['ref'];

const PLATE = 'Plate:0' as BodyId;
const TURNED = 'Turned:0' as BodyId;
const near = (a: readonly number[], b: readonly number[], tol = 1e-4) =>
  a.every((x, i) => Math.abs(x - (b[i] as number)) < tol);

function edgeAt(body: BodyId, mid: [number, number, number]): AnchorRef {
  const shape = shapeOf(body);
  const index = kernel.describe(shape).edges.findIndex((e) => near(e.midpoint, mid));
  const ref = engine.reference(body, 'edge', index) as AnchorRef | undefined;
  if (index < 0 || !ref) throw new Error(`no edge at ${mid}`);
  return ref;
}
function circleAt(body: BodyId, z: number, x: number, radius: number): AnchorRef {
  const shape = shapeOf(body);
  const index = kernel
    .describe(shape)
    .edges.findIndex(
      (e) =>
        e.type === 'circle' &&
        Math.abs(e.midpoint[2] - z) < 1e-6 &&
        Math.abs(e.length - 2 * Math.PI * radius) < 1e-6 &&
        Math.abs(e.midpoint[0] - x) <= radius + 1e-6,
    );
  const ref = engine.reference(body, 'edge', index) as AnchorRef | undefined;
  if (index < 0 || !ref) throw new Error(`no circle at z ${z}`);
  return ref;
}
function vertexNear(body: BodyId, at: [number, number, number]): AnchorRef {
  const shape = shapeOf(body);
  const index = kernel.describe(shape).vertices.findIndex((v) => near(v.point, at, 1e-3));
  const ref = engine.reference(body, 'vertex', index) as AnchorRef | undefined;
  if (index < 0 || !ref) throw new Error(`no vertex at ${at}`);
  return ref;
}
function wall(body: BodyId, radius: number): AnchorRef {
  const shape = shapeOf(body);
  const index = kernel
    .describe(shape)
    .faces.findIndex(
      (f, i) => f.type === 'cylinder' && kernel.surfaceGeometry(shape, i).radius === radius,
    );
  const ref = engine.reference(body, 'face', index) as AnchorRef | undefined;
  if (index < 0 || !ref) throw new Error(`no cylinder of radius ${radius}`);
  return ref;
}

const FRONT = 'front' as SheetViewId;
const TOP = 'top' as SheetViewId;
const cos30 = Math.cos(Math.PI / 6);
/** The turned block's corner at its own (10, −5), top: turned by 30° about its centre (0, −40). */
const TURNED_CORNER: [number, number, number] = [10 * cos30 + 2.5, -40 + 5 - 5 * cos30, 5];

/** Every dimension of the sheet, on the part as it was built. */
function dimensions(): SheetDimensionItem[] {
  const d = (
    id: string,
    view: SheetViewId,
    type: SheetDimensionItem['type'],
    at: [number, number],
    anchors: SheetAnchor[],
    more: Partial<SheetDimensionItem> = {},
  ): SheetDimensionItem => ({
    kind: 'dimension',
    id: id as SheetItemId,
    view,
    type,
    anchors,
    at,
    ...more,
  });
  const hole = circleAt(PLATE, 10, 15, 4);
  const bossTop = circleAt(PLATE, 30, -15, 8);
  // The turned block's long edge on its top nearer the plate, and a corner.
  const turnedEdge = edgeAt(TURNED, [-2.5, -40 + 5 * cos30, 5]);
  const corner: [number, number, number] = TURNED_CORNER;
  return [
    d('length', FRONT, 'linear', [0, -12], [{ ref: edgeAt(PLATE, [0, -20, 0]) }]),
    d('height', FRONT, 'linear', [42, 5], [{ ref: edgeAt(PLATE, [30, -20, 5]) }]),
    d(
      'boss',
      FRONT,
      'diameter',
      [-15, 33],
      [
        { ref: wall(PLATE, 8), silhouette: 1 },
        { ref: wall(PLATE, 8), silhouette: -1 },
      ],
    ),
    d('boss-r', TOP, 'radius', [-35, 15], [{ ref: bossTop }]),
    d('hole', TOP, 'diameter', [28, -12], [{ ref: hole }]),
    d(
      'centres',
      TOP,
      'linear',
      [0, -30],
      [
        { ref: bossTop, at: 'centre' },
        { ref: hole, at: 'centre' },
      ],
    ),
    d('angle', TOP, 'angle', [7, -25], [{ ref: edgeAt(PLATE, [0, -20, 10]) }, { ref: turnedEdge }]),
    d(
      'aligned',
      TOP,
      'linear',
      [32, -36],
      [{ ref: vertexNear(PLATE, [30, -20, 10]) }, { ref: vertexNear(TURNED, corner) }],
      { direction: 'aligned', decimals: 2 },
    ),
  ];
}

function sheetOf(items: SheetDimensionItem[]): Sheet {
  return {
    id: 's1' as SheetId,
    name: 'Plate',
    size: 'A3',
    orientation: 'landscape',
    scale: [2, 1],
    projection: 'first',
    decimals: 1,
    border: {},
    titleBlock: { template: 'simple', fields: { title: 'Plate with a boss' } },
    views: [
      {
        id: FRONT,
        name: 'Front',
        at: [160, 85],
        from: sheetStandardFrom('front'),
        label: true,
      },
      {
        id: TOP,
        name: 'Top',
        at: [160, 165],
        from: { kind: 'projected', parent: FRONT, side: 'below' },
        label: true,
      },
    ],
    items,
  };
}

describe('dimensions measured on a part the kernel builds', () => {
  it('measures each type to the known sizes', { timeout: 60_000 }, async () => {
    await recompute(part());
    const sheet = sheetOf(dimensions());
    const anchors = engine.resolveSheet(sheet);
    const measured = Object.fromEntries(
      sheet.items.map((item) => {
        const m = measureSheetDimension(sheet, item as SheetDimensionItem, anchors);
        expect(m.state, `${item.id}: ${m.message}`).toBe('ok');
        return [item.id, m.text];
      }),
    );
    expect(measured).toEqual({
      length: '60.0',
      height: '10.0',
      boss: 'Ø16.0',
      'boss-r': 'R8.0',
      hole: 'Ø8.0',
      centres: '30.0',
      angle: '30.0°',
      aligned: Math.hypot(30 - TURNED_CORNER[0], -20 - TURNED_CORNER[1]).toFixed(2),
    });
  });

  it('follows a parameter change, and writes the sample', { timeout: 60_000 }, async () => {
    await recompute(part());
    const items = dimensions();
    // One whose edge never was (a typo of a name, a fingerprint far away): detached.
    items.push({
      kind: 'dimension',
      id: 'lost' as SheetItemId,
      view: FRONT,
      type: 'radius',
      anchors: [
        {
          ref: {
            kind: 'edge',
            id: 'e[cylinder:Gone:side:wall|cylinder:Gone:cap:end]',
            fingerprint: { type: 'circle', at: [500, 500, 500], dir: [0, 0, 1], size: 1 },
          },
        },
      ],
      at: [-50, 20],
    });
    await recompute(part('80 mm'));
    const sheet = sheetOf(items);
    const anchors = engine.resolveSheet(sheet);
    const measure = (id: string) =>
      measureSheetDimension(
        sheet,
        sheet.items.find((i) => i.id === id) as SheetDimensionItem,
        anchors,
      );
    expect(measure('length')).toMatchObject({ text: '80.0', state: 'ok' });
    expect(measure('lost')).toMatchObject({ text: 'R?', state: 'detached' });
    if (!ENV.SHEETS_OUT) return;
    const views = new Map<SheetViewId, SheetViewLines>();
    for (const view of sheet.views) {
      const frame = sheetViewFrame(sheet, view.id);
      if (!frame) throw new Error('no frame');
      const result = engine.sheetView({ id: view.id, direction: frame.direction, up: frame.up });
      if ('error' in result) throw new Error(result.error);
      views.set(view.id, linesOf(result.geometry));
    }
    const pdf = sheetsToPdf([sheet], { name: 'Plate', views, anchors });
    writeFileSync(join(ENV.SHEETS_OUT, 'dimensions.pdf'), pdf);
  });
});

/** A view's curves as layout takes them (what the app does with `sheetViews`). */
function linesOf(geometry: ViewGeometry): SheetViewLines {
  return {
    curves: geometry.curves.map((curve) => ({
      kind: curve.kind,
      ...(curve.edge && { edge: curve.edge }),
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
          default: {
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
  };
}
