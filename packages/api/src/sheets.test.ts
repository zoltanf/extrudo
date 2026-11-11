/**
 * Sheets through the API (P6-24 S6): each call is one command and one undo
 * step, anchors are stored as refs with fingerprints, and a bad call changes
 * nothing.
 */
import {
  DocumentSchema,
  type GeomFingerprint,
  type GeomRef,
  type Sheet,
  type SheetItem,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { Design } from './design';
import { ApiError } from './error';

const PRINT: GeomFingerprint = { type: 'line', at: [20, 0, 5], dir: [1, 0, 0], size: 40 };
const CIRCLE: GeomFingerprint = { type: 'circle', at: [10, 10, 5], size: 31.4 };

function setup() {
  const d = Design.create({ name: 'Plate' });
  const plate = d.box({ length: '40 mm', width: '20 mm', height: '5 mm' });
  const edge: GeomRef = {
    ...plate.edge([plate.faceName('cap:end'), plate.faceName('side:front')]),
    fingerprint: PRINT,
  };
  const other: GeomRef = {
    ...plate.edge([plate.faceName('cap:start'), plate.faceName('side:front')]),
    fingerprint: { ...PRINT, at: [20, 0, 0] },
  };
  return { d, plate, edge, other };
}

const only = (d: Design): Sheet => {
  const [sheet] = d.doc.sheets ?? [];
  if (!sheet) throw new Error('no sheet');
  return sheet;
};

/** Runs `change`, checks one undo takes it all back and redo brings it again. */
function oneStep(d: Design, change: () => unknown): void {
  const before = structuredClone(d.doc);
  change();
  const after = structuredClone(d.doc);
  expect(after).not.toEqual(before);
  d.state.undo();
  expect(d.doc).toEqual(before);
  d.state.redo();
  expect(d.doc).toEqual(after);
  expect(DocumentSchema.safeParse(d.doc).success).toBe(true);
}

describe('d.addSheet', () => {
  it('adds a sheet with the defaults, a counter ID and the design in its title block', () => {
    const { d } = setup();
    let sheet = d.sheets()[0];
    oneStep(d, () => {
      sheet = d.addSheet('Sheet 1');
    });
    expect(sheet?.id).toBe('sh1');
    expect(only(d)).toEqual({
      id: 'sh1',
      name: 'Sheet 1',
      size: 'A3',
      orientation: 'landscape',
      scale: [1, 1],
      projection: 'first',
      decimals: 1,
      border: {},
      titleBlock: { template: 'simple', fields: { title: 'Plate', units: 'mm' } },
      views: [],
      items: [],
    });
  });

  it('takes paper, scale, projection, border, title block and fields', () => {
    const { d } = setup();
    d.addSheet('Parts', {
      size: [300, 200],
      orientation: 'portrait',
      scale: [1, 2],
      projection: 'third',
      decimals: 2,
      border: 'zones',
      titleBlock: 'full',
      fields: { title: 'Bracket', drawnBy: 'A. N. Other' },
    });
    const sheet = only(d);
    expect(sheet).toMatchObject({
      size: [300, 200],
      orientation: 'portrait',
      scale: [1, 2],
      projection: 'third',
      decimals: 2,
      border: { zones: true },
      titleBlock: { template: 'full', fields: { title: 'Bracket', drawnBy: 'A. N. Other' } },
    });
    d.addSheet('Bare', { border: false, titleBlock: false });
    const bare = d.doc.sheets?.[1];
    expect(bare && 'border' in bare).toBe(false);
    expect(bare && 'titleBlock' in bare).toBe(false);
  });

  it('starts with the four standard views in one step, lined up with Front', () => {
    const { d, plate } = setup();
    oneStep(d, () => d.addSheet('Standard', { start: 'standard', bodies: [plate] }));
    const views = only(d).views;
    expect(views.map((v) => v.name)).toEqual(['Front', 'Top', 'Left', 'Isometric']);
    const [front, top, side, iso] = views;
    expect(front?.from).toEqual({ kind: 'base', direction: [0, 1, 0], up: [0, 0, 1] });
    expect(front?.bodies).toEqual([`${plate.id}:0`]);
    expect(top?.from).toEqual({ kind: 'projected', parent: front?.id, side: 'below' });
    expect(side?.from).toEqual({ kind: 'projected', parent: front?.id, side: 'right' });
    expect(iso?.from).toMatchObject({ side: 'iso-above-right' });
    expect(top?.at[0]).toBe(front?.at[0]);
    expect(side?.at[1]).toBe(front?.at[1]);
    // Third angle: the top view above the front, and it is "Top", the side "Right".
    d.addSheet('Third', { start: 'standard', projection: 'third', at: { front: [100, 200] } });
    const third = d.sheet('third')?.views();
    expect(third?.map((v) => v.name)).toEqual(['Front', 'Top', 'Right', 'Isometric']);
    expect(third?.[0]?.view?.at).toEqual([100, 200]);
    expect((third?.[1]?.view?.at[1] ?? 0) < 200).toBe(true);
  });

  it('refuses a name another sheet has, and changes nothing', () => {
    const { d } = setup();
    d.addSheet('Sheet 1');
    const before = JSON.stringify(d.doc);
    expect(() => d.addSheet('sheet 1')).toThrow(ApiError);
    expect(JSON.stringify(d.doc)).toBe(before);
    expect(d.doc.sheets).toHaveLength(1);
  });
});

describe('a sheet handle', () => {
  it('finds sheets by name or ID and lists them in page order', () => {
    const { d } = setup();
    const a = d.addSheet('A');
    d.addSheet('B', { index: 0 });
    expect(d.sheets().map((s) => s.name)).toEqual(['B', 'A']);
    expect(d.sheet('a')?.id).toBe(a.id);
    expect(d.sheet(a.id)?.name).toBe('A');
    expect(d.sheet('C')).toBeUndefined();
  });

  it('changes its setup, merging fields, in one step each', () => {
    const { d } = setup();
    const sheet = d.addSheet('A', { fields: { title: 'Plate', units: 'mm' } });
    oneStep(d, () =>
      sheet.update({ size: 'A4', scale: [2, 1], fields: { title: '', drawnBy: 'Me' } }),
    );
    expect(only(d)).toMatchObject({ size: 'A4', scale: [2, 1] });
    expect(only(d).titleBlock?.fields).toEqual({ units: 'mm', drawnBy: 'Me' });
    oneStep(d, () => sheet.update({ border: false, titleBlock: false }));
    expect('border' in only(d) || 'titleBlock' in only(d)).toBe(false);
    oneStep(d, () => sheet.rename('Renamed'));
    expect(sheet.name).toBe('Renamed');
  });

  it('moves and deletes a sheet', () => {
    const { d } = setup();
    const a = d.addSheet('A');
    d.addSheet('B');
    oneStep(d, () => a.move(1));
    expect(d.sheets().map((s) => s.name)).toEqual(['B', 'A']);
    oneStep(d, () => a.remove());
    expect(d.sheets().map((s) => s.name)).toEqual(['B']);
    expect(a.sheet).toBeUndefined();
  });
});

describe('views', () => {
  it('adds a base view from a standard name or a direction, and projects one from it', () => {
    const { d, plate } = setup();
    const sheet = d.addSheet('A');
    let front = sheet.views()[0];
    oneStep(d, () => {
      front = sheet.addView('Front', {
        at: [100, 100],
        scale: [1, 2],
        style: 'visible',
        bodies: [plate],
        tangentEdges: false,
        label: true,
      });
    });
    expect(front?.view).toEqual({
      id: 'sv1',
      name: 'Front',
      at: [100, 100],
      from: { kind: 'base', direction: [0, 1, 0], up: [0, 0, 1] },
      scale: [1, 2],
      style: 'visible',
      bodies: [`${plate.id}:0`],
      tangentEdges: false,
      label: true,
    });
  });

  it('projects a view, names it from its direction, and updates and removes views', () => {
    const { d } = setup();
    const sheet = d.addSheet('A');
    const front = sheet.addView('Front', { at: [100, 100] });
    let top = front;
    oneStep(d, () => {
      top = front.project('below', [100, 180]);
    });
    expect(top.view).toEqual({
      id: top.id,
      name: 'Top',
      at: [100, 180],
      from: { kind: 'projected', parent: front.id, side: 'below' },
    });
    const iso = front.project('iso-above-right', [250, 60], { centreLines: false });
    expect(iso.view).toMatchObject({ name: 'Isometric', centreLines: false });
    const odd = sheet.addView('Odd', {
      at: [10, 10],
      from: { direction: [1, 1, 0], up: [0, 0, 1] },
    });
    expect(odd.view?.from).toEqual({ kind: 'base', direction: [1, 1, 0], up: [0, 0, 1] });
    oneStep(d, () => front.update({ at: [90, 90], scale: [1, 5], style: 'hidden', label: true }));
    expect(front.view).toMatchObject({ at: [90, 90], scale: [1, 5], style: 'hidden', label: true });
    oneStep(d, () => front.update({ scale: null, style: null, label: false }));
    expect(front.view && ['scale', 'style', 'label'].some((k) => k in (front.view ?? {}))).toBe(
      false,
    );
    // Deleting the front takes the views projected from it.
    oneStep(d, () => front.remove());
    expect(sheet.views().map((v) => v.name)).toEqual(['Odd']);
  });

  it('refuses a scale on a projected view and a standard name it does not know', () => {
    const { d } = setup();
    const sheet = d.addSheet('A');
    const front = sheet.addView('Front', { at: [100, 100] });
    const top = front.project('below', [100, 180]);
    expect(() => top.update({ scale: [1, 2] })).toThrow(/projected view/);
    expect(() => sheet.addView('X', { at: [0, 0], from: 'sideways' as never })).toThrow(
      /not a standard view/,
    );
  });
});

describe('items', () => {
  function withView() {
    const s = setup();
    const sheet = s.d.addSheet('A');
    const front = sheet.addView('Front', { at: [100, 100] });
    return { ...s, sheet, front };
  }

  const itemOf = (d: Design, id: string): SheetItem | undefined =>
    only(d).items.find((i) => i.id === id);

  it('adds texts, sticky notes and tables to the sheet', () => {
    const { d, sheet } = withView();
    let text = sheet.item('none');
    oneStep(d, () => {
      text = sheet.addText('Deburr all edges', [20, 30], { size: 5, width: 60 });
    });
    expect(text?.item).toEqual({
      kind: 'text',
      id: 'si1',
      at: [20, 30],
      text: 'Deburr all edges',
      size: 5,
      width: 60,
    });
    oneStep(d, () => sheet.addSticky('Check with Sam', [200, 20], { color: 'blue', print: true }));
    expect(only(d).items.at(-1)).toMatchObject({
      kind: 'sticky',
      size: [40, 30],
      color: 'blue',
      print: true,
    });
    oneStep(d, () => sheet.addTable([20, 200], [['Rev', 'What'], ['A']], { columns: [10, 50] }));
    expect(only(d).items.at(-1)).toMatchObject({
      kind: 'table',
      columns: [10, 50],
      rows: [
        ['Rev', 'What'],
        ['A', ''],
      ],
    });
    expect(sheet.addTable([0, 0], [['a', 'b', 'c']]).item).toMatchObject({ columns: [30, 30, 30] });
  });

  it('adds a dimension with refs and fingerprints, in each anchor form', () => {
    const { d, front, edge, other } = withView();
    let dim = front.sheet.item('none');
    oneStep(d, () => {
      dim = front.addDimension('linear', [edge, { ref: other, at: 'middle' }], [20, -10], {
        direction: 'vertical',
        decimals: 2,
        before: '2×',
        after: ' max',
        reference: true,
      });
    });
    expect(dim?.item).toEqual({
      kind: 'dimension',
      id: dim?.id,
      view: front.id,
      type: 'linear',
      direction: 'vertical',
      anchors: [
        { ref: { kind: 'edge', id: edge.id, fingerprint: PRINT } },
        { ref: { kind: 'edge', id: other.id, fingerprint: other.fingerprint }, at: 'middle' },
      ],
      at: [20, -10],
      decimals: 2,
      before: '2×',
      after: ' max',
      reference: true,
    });
    const free = front.addDimension('linear', [[0, 0], { free: [10, 0] }], [5, 5]);
    expect(free.item).toMatchObject({ anchors: [{ free: [0, 0] }, { free: [10, 0] }] });
    const round = front.addDimension(
      'diameter',
      [{ ref: { kind: 'face', id: 'face-x' }, fingerprint: CIRCLE }],
      [5, 5],
    );
    expect(round.item).toMatchObject({
      anchors: [{ ref: { kind: 'face', id: 'face-x', fingerprint: CIRCLE } }],
    });
    const outline = front.addDimension(
      'linear',
      [
        { ref: { kind: 'face', id: 'face-x', fingerprint: CIRCLE }, silhouette: 1 },
        { ref: { kind: 'face', id: 'face-x', fingerprint: CIRCLE }, silhouette: -1 },
      ],
      [5, 5],
    );
    expect(outline.item).toMatchObject({ anchors: [{ silhouette: 1 }, { silhouette: -1 }] });
  });

  it('refuses an anchor without a fingerprint, an index one, a body, or one its type does not take', () => {
    const { d, front, plate, edge } = withView();
    const before = JSON.stringify(d.doc);
    expect(() => front.addDimension('linear', [plate.face('cap:end')], [0, 0])).toThrow(
      /fingerprint/,
    );
    expect(() =>
      front.addDimension('linear', [{ kind: 'edge', id: 'index:3', fingerprint: PRINT }], [0, 0]),
    ).toThrow(/index reference/);
    expect(() => front.addLeader(plate.body(), [0, 0], 'x')).toThrow(/can't point at a body/);
    expect(() => front.addDimension('angle', [edge], [0, 0])).toThrow(ApiError);
    expect(JSON.stringify(d.doc)).toBe(before);
  });

  it('adds leader notes, centre marks and centre lines', () => {
    const { d, front, edge, other } = withView();
    oneStep(d, () => front.addLeader({ ref: edge, at: 'end' }, [30, 30], 'Chamfer 1×45°'));
    expect(only(d).items.at(-1)).toMatchObject({
      kind: 'leader',
      view: front.id,
      anchor: { ref: { id: edge.id }, at: 'end' },
      at: [30, 30],
      text: 'Chamfer 1×45°',
    });
    const circle: GeomRef = { kind: 'edge', id: 'circle-edge', fingerprint: CIRCLE };
    oneStep(d, () => front.addCentreMark(circle));
    expect(only(d).items.at(-1)).toMatchObject({ kind: 'centreMark', anchors: [{ ref: circle }] });
    oneStep(d, () => front.addCentreLine([edge, other]));
    expect(only(d).items.at(-1)).toMatchObject({ kind: 'centreLine' });
  });

  it('adds a parts list with typed rows, and a balloon that takes its number from it', () => {
    const { d, front, plate, edge } = withView();
    let list = front.sheet.item('none');
    oneStep(d, () => {
      list = front.addPartsList([250, 20], {
        columns: ['item', 'qty', 'name'],
        rows: [{ body: plate, name: 'Base plate', material: 'PETG' }],
      });
    });
    expect(list?.item).toEqual({
      kind: 'partsList',
      id: list?.id,
      view: front.id,
      at: [250, 20],
      columns: ['item', 'qty', 'name'],
      rows: { [`${plate.id}:0`]: { name: 'Base plate', material: 'PETG' } },
    });
    let balloon = list;
    oneStep(d, () => {
      balloon = front.addBalloon(edge, [40, 40], list as never);
    });
    expect(balloon?.item).toMatchObject({ kind: 'balloon', list: list?.id, at: [40, 40] });
    expect(() => front.addBalloon([0, 0], [1, 1], list as never)).toThrow(ApiError);
    // Deleting the list deletes its balloons in the same step.
    oneStep(d, () => list?.remove());
    expect(only(d).items).toEqual([]);
  });

  it('updates and removes an item, anchors in any form, in one step each', () => {
    const { d, front, edge, other } = withView();
    const dim = front.addDimension('linear', [edge, other], [20, -10]);
    oneStep(d, () => dim.update({ decimals: 3, at: [25, -12], anchors: [other, edge] }));
    expect(itemOf(d, dim.id)).toMatchObject({
      decimals: 3,
      at: [25, -12],
      anchors: [{ ref: { id: other.id } }, { ref: { id: edge.id } }],
    });
    oneStep(d, () => dim.update({ decimals: null }));
    expect(itemOf(d, dim.id) && 'decimals' in (itemOf(d, dim.id) as object)).toBe(false);
    expect(() => dim.update({ kind: 'text' })).toThrow(/kind can't be changed/);
    expect(dim.kind).toBe('dimension');
    oneStep(d, () => dim.remove());
    expect(dim.item).toBeUndefined();
  });

  it('removing a view removes its items and keeps the others', () => {
    const { d, sheet, front, edge } = withView();
    front.addDimension('linear', [edge], [0, 0]);
    sheet.addText('Note', [10, 10]);
    oneStep(d, () => front.remove());
    expect(only(d).items.map((i) => i.kind)).toEqual(['text']);
  });
});

describe('IDs', () => {
  it('skip past the sheet, view and item IDs a loaded design has', () => {
    const { d, edge } = setup();
    const sheet = d.addSheet('A');
    const front = sheet.addView('Front', { at: [0, 0] });
    front.addDimension('linear', [edge], [0, 0]);
    const again = Design.from(d.toJSON());
    const next = again.addSheet('B');
    const view = next.addView('Front', { at: [0, 0] });
    const text = next.addText('x', [0, 0]);
    expect([next.id, view.id, text.id]).toEqual(['sh2', 'sv2', 'si2']);
  });
});
