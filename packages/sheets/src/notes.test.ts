// Leader notes, sticky notes, centre marks and centre lines laid out from
// resolved anchors (P6-24 S4, ADR-0143's S4 amendment), with the anchors'
// geometry given by hand: a front view (looking along +Y, Z up, so view x is
// world X and view y world Z) at (100, 100) on the sheet, 1:1.
// `notes.kernel.test.ts` does the same from a part the kernel builds.
import { readFileSync, writeFileSync } from 'node:fs';
import {
  keepLastAnchors,
  type Sheet,
  type SheetAnchor,
  type SheetAnchorReport,
  type SheetAnchors,
  type SheetId,
  type SheetItem,
  type SheetItemId,
  type SheetViewId,
  sheetStandardFrom,
  type Vec3,
} from '@extrudo/core';
import type { DisplayItem, DisplayPath, DisplayText } from '@extrudo/io';
import { loadFont } from '@extrudo/sketch/text';
import { beforeAll, describe, expect, it } from 'vitest';
import { layoutSheet } from './layout';
import {
  layoutSheetCentre,
  layoutSheetLeader,
  layoutSheetSticky,
  SHEET_NOTE,
  SHEET_STICKY,
  SHEET_STICKY_SCREEN_ONLY,
  sheetItemShown,
  sheetItemStatus,
  sheetStickiesLeftOut,
} from './notes';
import { sheetToSvg } from './output';
import { SHEET_FONT, textWidth } from './text';

beforeAll(() => {
  const fonts = new URL('../../fonts/fonts/', import.meta.url);
  loadFont(SHEET_FONT.regular, readFileSync(new URL('inter-regular.ttf', fonts)));
  loadFont(SHEET_FONT.bold, readFileSync(new URL('inter-bold.ttf', fonts)));
});

const FRONT = 'front' as SheetViewId;

function sheetOf(items: SheetItem[], centreLines?: false): Sheet {
  return {
    id: 's1' as SheetId,
    name: 'Sheet 1',
    size: [200, 150],
    orientation: 'landscape',
    scale: [1, 1],
    projection: 'first',
    decimals: 1,
    views: [
      {
        id: FRONT,
        name: 'Front',
        at: [100, 100],
        from: sheetStandardFrom('front'),
        ...(centreLines === false && { centreLines }),
      },
    ],
    items,
  };
}

const ref = (kind: 'edge' | 'face' | 'vertex', id: string, at: Vec3 = [0, 0, 0]) => ({
  ref: { kind, id, fingerprint: { type: kind === 'face' ? 'cylinder' : 'line', at } },
});
const line = (start: Vec3, end: Vec3): SheetAnchorReport => ({
  status: 'ok',
  geometry: { type: 'line', start, end },
});
const point = (p: Vec3): SheetAnchorReport => ({
  status: 'ok',
  geometry: { type: 'point', point: p },
});
const circle = (centre: Vec3, radius: number, axis: Vec3 = [0, 1, 0]): SheetAnchorReport => ({
  status: 'ok',
  geometry: {
    type: 'circle',
    centre,
    axis,
    xDirection: axis[1] === 0 ? [0, 1, 0] : [1, 0, 0],
    radius,
  },
});
const axis = (start: Vec3, end: Vec3): SheetAnchorReport => ({
  status: 'ok',
  geometry: { type: 'axis', start, end },
});

const leader = (
  id: string,
  at: [number, number],
  anchor: SheetAnchor = ref('edge', 'e1'),
  text = 'Break edge\nall round',
): Extract<SheetItem, { kind: 'leader' }> => ({
  kind: 'leader',
  id: id as SheetItemId,
  view: FRONT,
  anchor,
  at,
  text,
});
const centre = (
  kind: 'centreMark' | 'centreLine',
  id: string,
  anchors: SheetAnchor[],
): Extract<SheetItem, { kind: 'centreMark' | 'centreLine' }> => ({
  kind,
  id: id as SheetItemId,
  view: FRONT,
  anchors,
});
const sticky = (
  id: string,
  extra: Partial<Extract<SheetItem, { kind: 'sticky' }>> = {},
): Extract<SheetItem, { kind: 'sticky' }> => ({
  kind: 'sticky',
  id: id as SheetItemId,
  at: [20, 20],
  size: [50, 30],
  text: 'Check the lid fit',
  ...extra,
});

const paths = (items: DisplayItem[]) => items.filter((i): i is DisplayPath => i.type === 'path');
const texts = (items: DisplayItem[]) => items.filter((i): i is DisplayText => i.type === 'text');
const close = (a: readonly number[] | undefined, b: readonly number[]) =>
  a !== undefined && a.every((x, i) => Math.abs(x - (b[i] as number)) < 1e-6);
/** Each line of a stroked path as [x0, y0, x1, y1]. */
const segments = (path: DisplayPath | undefined) =>
  (path?.contours ?? []).map((c) => {
    const to = c.segments[0]?.type === 'line' ? c.segments[0].to : [NaN, NaN];
    return [c.start[0], c.start[1], to[0], to[1]].map((x) => Math.round(x * 1000) / 1000);
  });

// The plate's right edge, x = 30 from z 0 to 10: on the sheet (130, 100) to (130, 90).
const EDGE = line([30, -20, 0], [30, -20, 10]);

describe('leader notes', () => {
  it('ends in an arrowhead on the nearest point of its edge, with a shoulder and the text beside it', () => {
    const item = leader('n1', [45, 20]);
    const out = layoutSheetLeader(sheetOf([item]), item, { n1: [EDGE] } as SheetAnchors);
    const [lines, arrow] = paths(out);
    // The knee at (145, 80); the edge's nearest point (130, 90).
    expect(arrow?.fill).toEqual({ color: '#000000', rule: 'nonzero' });
    expect(close(arrow?.contours[0]?.start, [130, 90])).toBe(true);
    expect(lines?.stroke).toEqual({ width: 0.18, cap: 'butt' });
    const [leaderLine, shoulder] = segments(lines);
    expect(leaderLine?.slice(0, 2)).toEqual([145, 80]);
    expect(shoulder).toEqual([145, 80, 148, 80]);
    // Text past the shoulder and its gap, first capitals centred on it, one run per line.
    const [first, second] = texts(out);
    expect(first?.text).toBe('Break edge');
    expect(close(first?.at, [149, 80 + SHEET_NOTE.text / 2])).toBe(true);
    expect(second?.text).toBe('all round');
    expect(close(second?.at, [149, 80 + SHEET_NOTE.text / 2 + 1.6 * SHEET_NOTE.text])).toBe(true);
    expect(out.every((i) => i.key === 'item:n1' && i.state === undefined)).toBe(true);
  });

  it('puts the shoulder and the text on the left when the text is left of the arrow, ending there', () => {
    const item = leader('n1', [10, 20], ref('edge', 'e1'), 'Left');
    const out = layoutSheetLeader(sheetOf([item]), item, { n1: [EDGE] } as SheetAnchors);
    expect(segments(paths(out)[0])[1]).toEqual([110, 80, 107, 80]);
    const [run] = texts(out);
    expect((run?.at[0] ?? 0) + (run?.width ?? 0)).toBeCloseTo(106, 6);
    expect(run?.width).toBeCloseTo(textWidth('Left', SHEET_NOTE.text), 9);
  });

  it('ends in a dot on a face, on a circle towards the text, and on a point', () => {
    const face = leader('n1', [20, 25], ref('face', 'f1'));
    const onFace = layoutSheetLeader(sheetOf([face]), face, {
      n1: [point([10, 0, 5])],
    } as SheetAnchors);
    const dot = paths(onFace)[1];
    expect(dot?.contours[0]?.segments[0]).toMatchObject({ type: 'arc', center: [110, 95] });
    expect(close(dot?.contours[0]?.start, [110 + SHEET_NOTE.dot, 95])).toBe(true);
    // A hole's rim seen face-on: the arrow lands on the rim towards the text, (10, 5) + 4 · (0.6, 0.8).
    const rim = leader('n2', [16, 13]);
    const onRim = layoutSheetLeader(sheetOf([rim]), rim, {
      n2: [circle([10, 0, 5], 5)],
    } as SheetAnchors);
    const tip = paths(onRim)[1]?.contours[0]?.start as readonly number[];
    expect(tip[0]).toBeCloseTo(113, 1);
    expect(tip[1]).toBeCloseTo(91, 1);
    const free = leader('n3', [20, 20], { free: [0, 0] });
    const onFree = layoutSheetLeader(sheetOf([free]), free, { n3: [{ status: 'ok' }] });
    expect(close(paths(onFree)[1]?.contours[0]?.start, [100, 100])).toBe(true);
  });

  it('follows its anchor: the text moves as far as the fingerprint point moved', () => {
    const item = leader('n1', [45, 20], ref('edge', 'e1', [30, -20, 5]));
    const moved: SheetAnchorReport = {
      ...line([40, -20, 0], [40, -20, 10]),
      status: 'moved',
      resolved: {
        kind: 'edge',
        id: 'e2',
        fingerprint: { type: 'line', at: [40, -20, 5] },
      },
    };
    const out = layoutSheetLeader(sheetOf([item]), item, { n1: [moved] } as SheetAnchors);
    expect(segments(paths(out)[0])[1]).toEqual([155, 80, 158, 80]);
    expect(out.every((i) => i.state === 'moved')).toBe(true);
  });

  it('detached with no geometry kept: its text alone at `at`; with geometry kept: drawn, marked', () => {
    const item = leader('n1', [45, 20]);
    const sheet = sheetOf([item]);
    const lost: SheetAnchors = { ['n1' as SheetItemId]: [{ status: 'detached' }] };
    const alone = layoutSheetLeader(sheet, item, lost);
    expect(paths(alone)).toEqual([]);
    expect(texts(alone).map((t) => t.text)).toEqual(['Break edge', 'all round']);
    expect(close(texts(alone)[0]?.at, [145, 80 + SHEET_NOTE.text / 2])).toBe(true);
    expect(alone.every((i) => i.state === 'detached')).toBe(true);
    expect(sheetItemStatus(sheet, item, lost)).toEqual({
      state: 'detached',
      message: 'This note lost what it points at: drag its arrow onto an edge, or delete it.',
    });
    // Nothing at all resolved yet: the same.
    expect(paths(layoutSheetLeader(sheet, item, undefined))).toEqual([]);
    const kept = keepLastAnchors({ ['n1' as SheetItemId]: [EDGE] }, lost);
    const drawn = layoutSheetLeader(sheet, item, kept);
    expect(paths(drawn)).toHaveLength(2);
    expect(drawn.every((i) => i.state === 'detached')).toBe(true);
    // A resolved anchor that can't give a point (a line's centre): invalid, text alone.
    const bad = { ['n1' as SheetItemId]: [{ status: 'ok', message: 'The edge has no centre.' }] };
    const invalid = layoutSheetLeader(sheet, item, bad as SheetAnchors);
    expect(paths(invalid)).toEqual([]);
    expect(invalid.every((i) => i.state === 'invalid')).toBe(true);
  });
});

describe('centre marks', () => {
  it('is a short cross and long dashes out to 3 mm past the circle, level and upright', () => {
    const item = centre('centreMark', 'c1', [ref('edge', 'rim')]);
    const out = layoutSheetCentre(sheetOf([item]), item, {
      c1: [circle([10, 0, 5], 4)],
    } as SheetAnchors);
    expect(out).toHaveLength(1);
    const [path] = paths(out);
    expect(path?.stroke).toEqual({ width: 0.18, cap: 'butt' });
    // Centre (110, 95); 4 + 3 each way; the cross arm 1.5 and its gap 1.
    expect(segments(path)).toEqual([
      [103, 95, 107.5, 95],
      [108.5, 95, 111.5, 95],
      [112.5, 95, 117, 95],
      [110, 88, 110, 92.5],
      [110, 93.5, 110, 96.5],
      [110, 97.5, 110, 102],
    ]);
  });

  it('is one plain line each way on a small circle, follows an ellipse, and is invalid seen edge-on', () => {
    const item = centre('centreMark', 'c1', [ref('edge', 'rim')]);
    const sheet = sheetOf([item]);
    const small = layoutSheetCentre(sheet, item, { c1: [circle([0, 0, 0], 0.4)] } as SheetAnchors);
    expect(segments(paths(small)[0])).toEqual([
      [96.6, 100, 103.4, 100],
      [100, 96.6, 100, 103.4],
    ]);
    // Tilted 60° about x: 10 across, 5 down.
    const tilted = layoutSheetCentre(sheet, item, {
      c1: [circle([0, 0, 0], 5, [0, Math.cos(Math.PI / 3), Math.sin(Math.PI / 3)])],
    } as SheetAnchors);
    const lines = segments(paths(tilted)[0]);
    expect(lines[0]?.[0]).toBeCloseTo(92, 2);
    expect(lines[3]?.[1]).toBeCloseTo(100 - 2.5 - 3, 1);
    // Seen edge-on (its axis across the view): nothing, and why.
    const edgeOn = { c1: [circle([0, 0, 0], 5, [0, 0, 1])] } as SheetAnchors;
    expect(layoutSheetCentre(sheet, item, edgeOn)).toEqual([]);
    expect(sheetItemStatus(sheet, item, edgeOn)).toEqual({
      state: 'invalid',
      message: 'The circle is seen edge-on here: draw a centre line along it instead.',
    });
    const notCircle = { c1: [EDGE] } as SheetAnchors;
    expect(sheetItemStatus(sheet, item, notCircle).message).toBe('The edge is not a circle.');
  });

  it('draws nothing when lost with no geometry kept, and is marked detached when it has some', () => {
    const item = centre('centreMark', 'c1', [ref('edge', 'rim')]);
    const sheet = sheetOf([item]);
    const lost = { ['c1' as SheetItemId]: [{ status: 'detached' as const }] };
    expect(layoutSheetCentre(sheet, item, lost)).toEqual([]);
    expect(sheetItemStatus(sheet, item, lost)).toEqual({
      state: 'detached',
      message: 'This centre mark lost its circle: delete it, or place it again.',
    });
    const kept = keepLastAnchors({ ['c1' as SheetItemId]: [circle([10, 0, 5], 4)] }, lost);
    const out = layoutSheetCentre(sheet, item, kept);
    expect(out).toHaveLength(1);
    expect(out[0]?.state).toBe('detached');
  });
});

describe('centre lines', () => {
  it('runs midway between two parallel lines, 3 mm past them, dash-dot with a long dash at each end', () => {
    const item = centre('centreLine', 'c1', [ref('edge', 'a'), ref('edge', 'b')]);
    const out = layoutSheetCentre(sheetOf([item]), item, {
      c1: [line([-5, 0, 0], [-5, 0, 30]), line([5, 0, 30], [5, 0, 2])],
    } as SheetAnchors);
    const lines = segments(paths(out)[0]);
    // From z 0 to 30, so (100, 100) to (100, 70), 3 mm more each way: 36 mm,
    // two dots of 1 mm with 1.5 mm gaps, three long dashes of 28/3.
    const long = 28 / 3;
    const r = (x: number) => Math.round(x * 1000) / 1000;
    expect(lines).toEqual([
      [100, 103, 100, r(103 - long)],
      [100, r(103 - long - 1.5), 100, r(103 - long - 2.5)],
      [100, r(103 - long - 4), 100, r(103 - 2 * long - 4)],
      [100, r(103 - 2 * long - 5.5), 100, r(103 - 2 * long - 6.5)],
      [100, r(103 - 2 * long - 8), 100, 67],
    ]);
  });

  it('runs along an axis; a short one is one dash; an axis end-on or lines not parallel are invalid', () => {
    const item = centre('centreLine', 'c1', [ref('face', 'wall')]);
    const sheet = sheetOf([item]);
    const along = layoutSheetCentre(sheet, item, {
      c1: [axis([10, 0, 0], [10, 0, 10])],
    } as SheetAnchors);
    const lines = segments(paths(along)[0]);
    expect(lines[0]?.slice(0, 2)).toEqual([110, 103]);
    expect(lines.at(-1)?.slice(2)).toEqual([110, 87]);
    const short = layoutSheetCentre(sheet, item, {
      c1: [axis([10, 0, 0], [10, 0, 1])],
    } as SheetAnchors);
    expect(segments(paths(short)[0])).toEqual([[110, 103, 110, 96]]);
    const endOn = { c1: [axis([0, -5, 0], [0, 5, 0])] } as SheetAnchors;
    expect(layoutSheetCentre(sheet, item, endOn)).toEqual([]);
    expect(sheetItemStatus(sheet, item, endOn).message).toBe(
      'The axis points out of this view: draw a centre mark instead.',
    );
    const two = centre('centreLine', 'c2', [ref('edge', 'a'), ref('edge', 'b')]);
    const skew = { c2: [line([0, 0, 0], [0, 0, 10]), line([5, 0, 0], [8, 0, 10])] } as SheetAnchors;
    expect(sheetItemStatus(sheetOf([two]), two, skew)).toEqual({
      state: 'invalid',
      message: "The lines aren't parallel: a centre line runs between parallel lines.",
    });
  });
});

describe('sticky notes', () => {
  it('is a rounded note in its colour, its text inside, and "On screen only" on screen', () => {
    const out = layoutSheetSticky(sticky('k1'));
    const [note] = paths(out);
    expect(note?.fill).toEqual({ color: SHEET_STICKY.yellow.fill });
    expect(note?.contours[0]?.start).toEqual([21.5, 20]);
    expect(note?.contours[0]?.segments.filter((s) => s.type === 'arc')).toHaveLength(4);
    const [text, label] = texts(out);
    expect(text?.text).toBe('Check the lid fit');
    expect(close(text?.at, [23, 26.5])).toBe(true);
    expect(text?.color).toBeUndefined();
    expect(label?.text).toBe(SHEET_STICKY_SCREEN_ONLY);
    expect(label?.color).toBe(SHEET_STICKY.yellow.ink);
    expect(close(label?.at, [21.5, 48.5])).toBe(true);
    expect(out.every((i) => i.key === 'item:k1')).toBe(true);
  });

  it('is left out of an export unless printed, and has no small print when printed', () => {
    expect(layoutSheetSticky(sticky('k1'), { output: 'export' })).toEqual([]);
    const printed = layoutSheetSticky(sticky('k1', { print: true, color: 'blue' }), {
      output: 'export',
    });
    expect(paths(printed)[0]?.fill?.color).toBe(SHEET_STICKY.blue.fill);
    expect(texts(printed).map((t) => t.text)).toEqual(['Check the lid fit']);
    expect(texts(layoutSheetSticky(sticky('k1', { print: true }))).map((t) => t.text)).toEqual([
      'Check the lid fit',
    ]);
  });

  it('wraps inside its width and ends the last line that fits with an ellipsis', () => {
    const long = 'one two three four five six seven eight nine ten eleven twelve thirteen';
    const out = layoutSheetSticky(sticky('k1', { size: [30, 20], text: long, print: true }));
    const lines = texts(out);
    expect(lines.length).toBeGreaterThan(1);
    for (const run of lines) expect(run.at[0] + run.width).toBeLessThanOrEqual(20 + 30 - 3 + 1e-9);
    // 20 mm high: baselines at 26.5 and 32.1 fit above 37, the third would not.
    expect(lines).toHaveLength(2);
    expect(lines[1]?.text.endsWith('…')).toBe(true);
  });

  it('counts those an export leaves out, and layoutSheet leaves them out for an export', () => {
    const items = [sticky('k1'), sticky('k2', { print: true }), sticky('k3', { color: 'green' })];
    const sheet = sheetOf(items);
    expect(sheetStickiesLeftOut([sheet, sheetOf([])])).toBe(2);
    const keys = (output: 'screen' | 'export') => [
      ...new Set(layoutSheet(sheet, { output }).items.map((i) => i.key)),
    ];
    expect(keys('screen')).toEqual(['paper', 'view:front', 'item:k1', 'item:k2', 'item:k3']);
    expect(keys('export')).toEqual(['paper', 'view:front', 'item:k2']);
    // The files are exports unless told otherwise.
    const svg = sheetToSvg(
      sheetOf([sticky('k1', { text: 'Secret' }), sticky('k2', { text: 'Shown', print: true })]),
    );
    expect(svg).not.toContain('Secret');
    expect(svg).toContain('Shown');
    expect(svg).not.toContain(SHEET_STICKY_SCREEN_ONLY);
    expect(sheetToSvg(sheetOf([sticky('k1', { text: 'Secret' })]), { output: 'screen' })).toContain(
      'Secret',
    );
  });
});

describe('in layoutSheet', () => {
  it("leaves out a view's centre marks and lines when its centre lines are off, and nothing else", () => {
    const items: SheetItem[] = [
      centre('centreMark', 'c1', [ref('edge', 'rim')]),
      centre('centreLine', 'c2', [ref('face', 'wall')]),
      leader('n1', [45, 20]),
    ];
    const anchors = {
      c1: [circle([10, 0, 5], 4)],
      c2: [axis([10, 0, 0], [10, 0, 10])],
      n1: [EDGE],
    } as SheetAnchors;
    const keys = (sheet: Sheet) => [
      ...new Set(layoutSheet(sheet, { anchors }).items.map((i) => i.key)),
    ];
    expect(keys(sheetOf(items))).toEqual(['paper', 'view:front', 'item:c1', 'item:c2', 'item:n1']);
    const off = sheetOf(items, false);
    expect(keys(off)).toEqual(['paper', 'view:front', 'item:n1']);
    expect(sheetItemShown(off, items[0] as SheetItem)).toBe(false);
    expect(sheetItemShown(off, sticky('k1'), 'export')).toBe(false);
    // An item whose view is gone draws nothing.
    const orphan = { ...leader('n2', [0, 0]), view: 'gone' as SheetViewId };
    expect(layoutSheetLeader(sheetOf([orphan]), orphan, anchors)).toEqual([]);
    expect(sheetItemStatus(sheetOf([orphan]), orphan, anchors).message).toBe(
      "The note's view is gone.",
    );
  });

  // One small golden file per kind (UPDATE_GOLDEN=1 rewrites them).
  const golden = (name: string, sheet: Sheet, anchors: SheetAnchors, output?: 'screen') => {
    const svg = sheetToSvg(sheet, { anchors, ...(output && { output }) });
    const path = new URL(`./golden/${name}.svg`, import.meta.url);
    if (process.env.UPDATE_GOLDEN) writeFileSync(path, svg);
    expect(svg).toBe(readFileSync(path, 'utf8'));
  };

  it('matches the golden file of leader notes', () => {
    const items = [
      leader('n1', [45, 20]),
      leader('n2', [-25, 25], ref('face', 'f1'), 'Ream Ø8 H7'),
    ];
    golden('leader', sheetOf(items), { n1: [EDGE], n2: [point([10, 0, 5])] } as SheetAnchors);
  });

  it('matches the golden file of sticky notes on screen', () => {
    const items = [
      sticky('k1', { text: 'Check the lid fit\nafter the first print.', size: [60, 30] }),
      sticky('k2', { at: [100, 20], color: 'pink', print: true, text: 'Printed' }),
    ];
    golden('sticky', sheetOf(items), {}, 'screen');
  });

  it('matches the golden file of centre marks', () => {
    const items = [
      centre('centreMark', 'c1', [ref('edge', 'rim')]),
      centre('centreMark', 'c2', [ref('edge', 'pin')]),
    ];
    golden('centre-mark', sheetOf(items), {
      c1: [circle([10, 0, 5], 8)],
      c2: [circle([-30, 0, 5], 1.5)],
    } as SheetAnchors);
  });

  it('matches the golden file of centre lines', () => {
    const items = [
      centre('centreLine', 'c1', [ref('edge', 'a'), ref('edge', 'b')]),
      centre('centreLine', 'c2', [ref('face', 'wall')]),
    ];
    golden('centre-line', sheetOf(items), {
      c1: [line([-25, 0, 0], [-25, 0, 30]), line([-15, 0, 0], [-15, 0, 30])],
      c2: [axis([20, 0, -5], [60, 0, -5])],
    } as SheetAnchors);
  });
});
