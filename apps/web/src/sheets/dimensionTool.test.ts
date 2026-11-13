import type {
  BodyId,
  Sheet,
  SheetDimensionItem,
  SheetId,
  SheetItemId,
  SheetRefAnchor,
  SheetViewId,
  Vec2,
  Vec3,
} from '@extrudo/core';
import { sheetStandardFrom } from '@extrudo/core';
import type { ViewCurve, ViewGeometry } from '@extrudo/kernel';
import { describe, expect, it } from 'vitest';
import {
  DIMENSION_DEFAULTS,
  dimensionItem,
  dimensionOf,
  hitPickable,
  nextStep,
  type SheetPick,
  sheetPickables,
  toSheet,
  toView,
} from './dimensionTool';
import { handlePoint, repickChanges } from './RepickHandles';
import { choicesOf, dimensionChanges } from './SheetDimensionCard';

const V = 'v1' as SheetViewId;
const BODY = 'b1' as BodyId;

function sheetWith(view: Partial<Sheet['views'][number]> = {}): Sheet {
  return {
    id: 's1' as SheetId,
    name: 'Sheet 1',
    size: 'A3',
    orientation: 'landscape',
    scale: [2, 1],
    projection: 'first',
    decimals: 0,
    views: [{ id: V, name: 'Front', at: [100, 100], from: sheetStandardFrom('front'), ...view }],
    items: [],
  };
}

const curve = (c: Partial<ViewCurve> & Pick<ViewCurve, 'pieces'>): ViewCurve => ({
  kind: 'visible',
  body: BODY,
  ...c,
});

function geometry(curves: ViewCurve[], exact = true): Map<SheetViewId, ViewGeometry> {
  return new Map([[V, { curves, status: 'ok', skipped: [], exact }]]);
}

const LINE = curve({ edge: 'e-bottom', pieces: [{ type: 'line', a: [0, 0], b: [10, 0] }] });
// The same edge, its right part hidden: one pickable.
const SPLIT = [
  curve({ edge: 'e-top', pieces: [{ type: 'line', a: [0, 5], b: [6, 5] }] }),
  curve({ edge: 'e-top', kind: 'hidden', pieces: [{ type: 'line', a: [6, 5], b: [10, 5] }] }),
];
const CIRCLE = curve({
  edge: 'e-rim',
  pieces: [{ type: 'arc', center: [20, 0], radius: 2, start: 0, end: 2 * Math.PI }],
});
const ARC = curve({
  edge: 'e-round',
  pieces: [{ type: 'arc', center: [30, 0], radius: 3, start: 0, end: Math.PI / 2 }],
});
const OUTLINE = curve({
  kind: 'outline',
  face: 'f-cyl',
  pieces: [{ type: 'line', a: [40, 0], b: [40, 8] }],
});
const TANGENT = curve({
  kind: 'tangent',
  edge: 'e-tan',
  pieces: [{ type: 'line', a: [50, 0], b: [50, 8] }],
});
const HIDDEN = curve({
  kind: 'hidden',
  edge: 'e-hid',
  pieces: [{ type: 'line', a: [60, 0], b: [60, 8] }],
});
const ALL = [LINE, ...SPLIT, CIRCLE, ARC, OUTLINE, TANGENT, HIDDEN];
const scaleOf = () => 2;

describe('sheetPickables', () => {
  it('takes each edge and outline of a view with exact, current lines, in sheet mm', () => {
    const picks = sheetPickables(sheetWith(), geometry(ALL), new Set(), scaleOf);
    expect(picks.map((p) => [p.kind, p.name])).toEqual([
      ['edge', 'e-bottom'],
      ['edge', 'e-top'],
      ['edge', 'e-rim'],
      ['edge', 'e-round'],
      ['outline', 'f-cyl'],
      ['edge', 'e-tan'],
      ['edge', 'e-hid'],
    ]);
    const bottom = picks[0];
    // View mm × 2 from the view's origin at (100, 100), y down the sheet.
    expect(bottom?.shape).toEqual({ type: 'line', a: [0, 0], b: [10, 0] });
    expect(bottom?.ends).toEqual([
      [100, 100],
      [120, 100],
    ]);
    // A split edge is one line, end to end.
    expect(picks[1]?.shape).toEqual({ type: 'line', a: [0, 5], b: [10, 5] });
    expect(picks[1]?.ends).toEqual([
      [100, 90],
      [120, 90],
    ]);
    expect(picks[2]?.shape).toEqual({ type: 'circle', centre: [20, 0], radius: 2, full: true });
    expect(picks[2]?.ends).toEqual([]);
    expect(picks[3]?.shape).toMatchObject({ type: 'circle', full: false });
    expect(picks[3]?.ends).toHaveLength(2);
    // An outline's ends are not the model's points.
    expect(picks[4]?.ends).toEqual([]);
  });

  it('never takes quick lines, lines being recomputed, nor what the view does not draw', () => {
    expect(sheetPickables(sheetWith(), geometry(ALL, false), new Set(), scaleOf)).toEqual([]);
    expect(sheetPickables(sheetWith(), geometry(ALL), new Set([V]), scaleOf)).toEqual([]);
    const plain = sheetPickables(
      sheetWith({ style: 'visible', tangentEdges: false }),
      geometry(ALL),
      new Set(),
      scaleOf,
    ).map((p) => p.name);
    expect(plain).not.toContain('e-hid');
    expect(plain).not.toContain('e-tan');
    // A curve with no name (a quick or a nameless one) is never taken.
    expect(
      sheetPickables(sheetWith(), geometry([curve({ pieces: LINE.pieces })]), new Set(), scaleOf),
    ).toEqual([]);
  });

  it('goes between view and sheet mm both ways', () => {
    const view = { at: [100, 100] as [number, number] };
    expect(toSheet(view, 2, [10, 5])).toEqual([120, 90]);
    expect(toView(view, 2, [120, 90])).toEqual([10, 5]);
  });
});

describe('hitPickable', () => {
  const picks = sheetPickables(sheetWith(), geometry(ALL), new Set(), scaleOf);

  it('takes an end when it is about as near as the line, else the nearest pickable', () => {
    const atEnd = hitPickable(picks, [100.5, 100.4], 1);
    expect(atEnd?.pickable.name).toBe('e-bottom');
    expect(atEnd?.end).toBe(0);
    const along = hitPickable(picks, [110, 100.6], 1);
    expect(along).toEqual({ pickable: picks[0] });
    // On the circle's rim (centre (140, 100), radius 4 on the sheet).
    expect(hitPickable(picks, [144.3, 100], 1)?.pickable.name).toBe('e-rim');
    expect(hitPickable(picks, [110, 95], 1)).toBeUndefined();
    // The middle of a short edge is the edge, though its ends are within the tolerance.
    expect(hitPickable(picks, [101.2, 100], 2)).toEqual({ pickable: picks[0] });
    expect(hitPickable(picks, [100.3, 100], 2)?.end).toBe(0);
  });

  it('keeps to one view when asked', () => {
    expect(hitPickable(picks, [110, 100.2], 1, 'other' as SheetViewId)).toBeUndefined();
  });
});

const ref = (id: string, kind: 'edge' | 'face' = 'edge'): SheetRefAnchor['ref'] => ({
  kind,
  id,
  fingerprint: { type: 'line', at: [0, 0, 0] },
});
const line = (id: string, a: [number, number], b: [number, number]): SheetPick => ({
  kind: 'edge',
  view: V,
  key: id,
  ref: ref(id),
  shape: { type: 'line', a, b },
});
const circle = (id: string, full: boolean): SheetPick => ({
  kind: 'edge',
  view: V,
  key: id,
  ref: ref(id),
  shape: { type: 'circle', centre: [0, 0], radius: 2, full },
});
const point = (id: string, at: 'start' | 'end'): SheetPick => ({
  kind: 'point',
  view: V,
  key: id,
  ref: ref(id),
  at,
  p: [0, 0],
});
const outline = (face: string, silhouette: 1 | -1, x: number): SheetPick => ({
  kind: 'outline',
  view: V,
  key: `${face}${silhouette}`,
  ref: ref(face, 'face'),
  silhouette,
  shape: { type: 'line', a: [x, 0], b: [x, 10] },
  face,
});

describe('dimensionOf: which dimension the picks make', () => {
  it('one pick: a line its length, a circle its diameter, an arc its radius, an outline its length', () => {
    expect(dimensionOf([line('a', [0, 0], [10, 0])])).toEqual({
      type: 'linear',
      anchors: [{ ref: ref('a') }],
    });
    expect(dimensionOf([circle('c', true)])?.type).toBe('diameter');
    expect(dimensionOf([circle('c', false)])?.type).toBe('radius');
    expect(dimensionOf([outline('f', 1, 0)])).toEqual({
      type: 'linear',
      anchors: [{ ref: ref('f', 'face'), silhouette: 1 }],
    });
    // A point or a free curve alone waits for a second pick.
    expect(dimensionOf([point('a', 'start')])).toBeUndefined();
    expect(
      dimensionOf([{ kind: 'edge', view: V, key: 'k', ref: ref('k'), shape: { type: 'curve' } }]),
    ).toBeUndefined();
    expect(dimensionOf([])).toBeUndefined();
  });

  it('two picks: parallel lines a distance, crossing lines an angle, one face across a diameter', () => {
    const across = dimensionOf([line('a', [0, 0], [10, 0]), line('b', [0, 5], [10, 5])]);
    expect(across?.type).toBe('linear');
    expect(dimensionOf([line('a', [0, 0], [10, 0]), line('b', [0, 0], [0, 5])])?.type).toBe(
      'angle',
    );
    expect(dimensionOf([line('a', [0, 0], [10, 0]), outline('f', 1, 3)])?.type).toBe('angle');
    expect(dimensionOf([outline('f', 1, 0), outline('f', -1, 8)])).toEqual({
      type: 'diameter',
      anchors: [
        { ref: ref('f', 'face'), silhouette: 1 },
        { ref: ref('f', 'face'), silhouette: -1 },
      ],
    });
    // The same outline twice makes nothing; two faces' outlines a distance.
    expect(dimensionOf([outline('f', 1, 0), outline('f', 1, 0)])).toBeUndefined();
    expect(dimensionOf([outline('f', 1, 0), outline('g', 1, 8)])?.type).toBe('linear');
  });

  it('points and circles of two picks are a distance between them', () => {
    expect(dimensionOf([point('a', 'start'), point('b', 'end')])).toEqual({
      type: 'linear',
      anchors: [
        { ref: ref('a'), at: 'start' },
        { ref: ref('b'), at: 'end' },
      ],
    });
    expect(dimensionOf([circle('c', true), line('a', [0, 0], [10, 0])])?.type).toBe('linear');
  });
});

describe('dimensionItem and the panel', () => {
  const id = 'd1' as SheetItemId;

  it('places the item in the view with the panel’s choices; a direction only on a linear one', () => {
    const picks = [line('a', [0, 0], [10, 0])];
    expect(dimensionItem(id, picks, [5.12345, 8], DIMENSION_DEFAULTS)).toEqual({
      kind: 'dimension',
      id,
      view: V,
      type: 'linear',
      anchors: [{ ref: ref('a') }],
      at: [5.123, 8],
    });
    const chosen = {
      direction: 'vertical' as const,
      decimals: 2,
      before: '2×',
      after: ' max',
      reference: true,
    };
    expect(dimensionItem(id, picks, [0, 0], chosen)).toMatchObject({
      direction: 'vertical',
      decimals: 2,
      before: '2×',
      after: ' max',
      reference: true,
    });
    expect(dimensionItem(id, [circle('c', true)], [0, 0], chosen)?.direction).toBeUndefined();
    expect(dimensionItem(id, [point('a', 'start')], [0, 0], chosen)).toBeUndefined();
  });

  it('says what to pick next', () => {
    expect(nextStep([])).toBe('Pick an edge, a point or a circle.');
    expect(nextStep([point('a', 'start')])).toBe('Pick the second edge or point.');
    expect(nextStep([line('a', [0, 0], [1, 0])])).toMatch(/^Click where the number goes, or/);
    expect(nextStep([point('a', 'start'), point('b', 'end')])).toBe('Click where the number goes.');
  });

  it('the card’s fields: a field cleared or Auto takes it away', () => {
    expect(dimensionChanges({ direction: 'auto' })).toEqual({ direction: null });
    expect(dimensionChanges({ direction: 'aligned', decimals: undefined })).toEqual({
      direction: 'aligned',
      decimals: null,
    });
    expect(dimensionChanges({ before: '2×', reference: undefined })).toEqual({
      before: '2×',
      reference: null,
    });
    const item = dimensionItem(id, [line('a', [0, 0], [1, 0])], [0, 0], {
      direction: 'horizontal',
      decimals: 1,
      reference: true,
    }) as SheetDimensionItem;
    expect(choicesOf(item)).toEqual({ direction: 'horizontal', decimals: 1, reference: true });
  });
});

describe('picking again (a lost or moved dimension)', () => {
  const item = dimensionItem('d1' as SheetItemId, [line('a', [0, 0], [10, 0])], [0, 0], {
    direction: 'horizontal',
  }) as SheetDimensionItem;

  it('a one-anchor dimension takes the type its new pick makes, and loses a direction it no longer has', () => {
    expect(repickChanges(item, 0, circle('c', true))).toEqual({
      anchors: [{ ref: ref('c') }],
      type: 'diameter',
      direction: null,
    });
    expect(repickChanges(item, 0, line('b', [0, 0], [0, 4]))).toEqual({
      anchors: [{ ref: ref('b') }],
      type: 'linear',
    });
    expect(repickChanges(item, 0, point('p', 'end'))).toBeUndefined();
  });

  it('a two-anchor one keeps its type and the other anchor', () => {
    const two = { ...item, anchors: [{ ref: ref('a') }, { ref: ref('b') }] };
    expect(repickChanges(two, 1, point('p', 'end'))).toEqual({
      anchors: [{ ref: ref('a') }, { ref: ref('p'), at: 'end' }],
      type: 'linear',
    });
  });

  it('puts a handle on a point, a circle’s centre or a line’s middle, or none without geometry', () => {
    const v = (p: Vec3): Vec2 => [p[0], p[2]];
    expect(
      handlePoint({ status: 'moved', geometry: { type: 'point', point: [1, 0, 2] } }, v),
    ).toEqual([1, 2]);
    expect(
      handlePoint(
        { status: 'detached', geometry: { type: 'line', start: [0, 0, 0], end: [4, 0, 2] } },
        v,
      ),
    ).toEqual([2, 1]);
    expect(
      handlePoint(
        {
          status: 'ok',
          geometry: {
            type: 'circle',
            centre: [3, 0, 3],
            axis: [0, 1, 0],
            xDirection: [1, 0, 0],
            radius: 1,
          },
        },
        v,
      ),
    ).toEqual([3, 3]);
    expect(handlePoint({ status: 'detached' }, v)).toBeUndefined();
  });
});
