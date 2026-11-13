/**
 * The sheet tools on the real kernel (P6-24 S6): a sheet made, measured, exported and
 * undone the way an agent following the skill does it, with fingerprints, views and
 * dimensions from the kernel's own answers.
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { Design } from '@extrudo/api';
import { SHEET_FONT } from '@extrudo/sheets';
import { loadFont } from '@extrudo/sketch/text';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AgentReply } from '../platform/agent';
import { kernelHost } from './kernelTesting';
import { fakeContext } from './testing';
import { runTool } from './tools';

const textOf = (reply: AgentReply, i = 0) => (reply.result.content[i] as { text: string }).text;
const jsonOf = (reply: AgentReply) => JSON.parse(textOf(reply));

beforeAll(() => {
  // The export sets its text in the bundled faces, as the app loads them.
  const fonts = new URL('../../../../packages/fonts/fonts/', import.meta.url);
  loadFont(SHEET_FONT.regular, readFileSync(new URL('inter-regular.ttf', fonts)));
  loadFont(SHEET_FONT.bold, readFileSync(new URL('inter-bold.ttf', fonts)));
});

/** The strings of a PDF's selectable text layer, as `scripts/check-sheet-pdf.mjs` reads them. */
function pdfStrings(pdf: Uint8Array): string[] {
  const bytes = Buffer.from(pdf);
  const file = bytes.toString('latin1');
  const strings: string[] = [];
  for (const match of file.matchAll(/<< \/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/g)) {
    const start = (match.index ?? 0) + match[0].length;
    const content = inflateSync(bytes.subarray(start, start + Number(match[1]))).toString('latin1');
    for (const tj of content.matchAll(/<([0-9a-f]*)> Tj/g)) {
      strings.push(Buffer.from(tj[1] ?? '', 'hex').toString('latin1'));
    }
  }
  return strings;
}

/** A plate (a box, its length a parameter) and a peg beside it; answers their ids. */
async function open() {
  const k = await kernelHost(Design.create({ name: 'Bracket' }).toJSON());
  const ctx = fakeContext(k.host, [], { settleMs: 30_000 });
  const call = (name: string, args: Record<string, unknown> = {}) => runTool(name, args, ctx);
  await call('set_parameter', { name: 'length', expression: '40 mm' });
  const plate = jsonOf(
    await call('add_feature', {
      type: 'box',
      inputs: { length: 'length', width: '20 mm', height: '10 mm' },
      name: 'Plate',
    }),
  ).result[0].id as string;
  const peg = jsonOf(
    await call('add_feature', {
      type: 'cylinder',
      inputs: { x: '40 mm', diameter: '16 mm', height: '20 mm' },
      name: 'Peg',
    }),
  ).result[0].id as string;
  // The SVGs export_sheet's pictures were made from (the app draws them onto a canvas).
  const pictures: string[] = [];
  k.host.sheetPng = async (svg) => {
    pictures.push(svg);
    return new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  };
  return { ...k, ctx, call, plate, peg, pictures };
}

/** The top front edge of the plate, as an agent names it. */
const topFront = (plate: string) => ({
  edgeBetween: [`box:${plate}:cap:end`, `box:${plate}:side:front`],
});

describe('the sheet tools on the real kernel', { timeout: 120_000 }, () => {
  it('adds a fitted standard sheet in one undo step, without opening the drawing', async () => {
    const { call, store, session, dispose } = await open();
    const added = jsonOf(await call('add_sheet', { name: 'Plate', size: 'A4' }));
    expect(added.done).toBe('Agent: Add sheet Plate');
    expect(added.result.views.map((v: { name: string }) => v.name)).toEqual([
      'Front',
      'Top',
      // First angle: the view right of the front is the one looking from the left.
      'Left',
      'Isometric',
    ]);
    // Fitted as New drawing fits it: a 60 mm wide model fills an A4 at a standard scale.
    expect(added.result.scale).toMatch(/^\d+:\d+$/);
    const [front, top, side] = store.getState().doc.sheets?.[0]?.views ?? [];
    expect(top?.at[0]).toBeCloseTo(front?.at[0] ?? Number.NaN, 9);
    expect(side?.at[1]).toBeCloseTo(front?.at[1] ?? Number.NaN, 9);
    // The views lie inside the paper, not on the API's plain grid.
    for (const view of store.getState().doc.sheets?.[0]?.views ?? []) {
      expect(view.at[0]).toBeGreaterThan(0);
      expect(view.at[0]).toBeLessThan(297);
      expect(view.at[1]).toBeGreaterThan(0);
      expect(view.at[1]).toBeLessThan(210);
    }
    expect(session.getState().mode).toBe('model');
    const listed = jsonOf(await call('list_sheets'));
    expect(listed.open).toBeNull();
    expect(listed.sheets[0].views[0]).toMatchObject({
      name: 'Front',
      from: 'front',
      right: [1, 0, 0],
      up: [0, 0, 1],
    });
    expect(listed.sheets[0].views[1].from).toEqual({ parent: 'Front', side: 'below' });
    // One step: undo takes the sheet and its four views away.
    expect(jsonOf(await call('undo')).undone).toBe('Agent: Add sheet Plate');
    expect(store.getState().doc.sheets ?? []).toEqual([]);
    dispose();
  });

  it('measures a dimension from the model, answers it, and follows a parameter', async () => {
    const { call, store, plate, peg, dispose } = await open();
    await call('add_sheet', { name: 'Plate' });
    const length = jsonOf(
      await call('add_dimension', {
        sheet: 'Plate',
        view: 'Front',
        type: 'linear',
        anchors: [
          { ...topFront(plate), at: 'start' },
          { ...topFront(plate), at: 'end' },
        ],
        at: [0, 20],
        direction: 'horizontal',
      }),
    );
    expect(length.done).toBe('Agent: Dimension 40.0');
    expect(length.result).toMatchObject({ value: 40, text: '40.0', state: 'ok' });
    const stored = store.getState().doc.sheets?.[0]?.items[0];
    expect(stored).toMatchObject({ kind: 'dimension', type: 'linear', direction: 'horizontal' });
    // Fingerprints, never an index.
    for (const anchor of (stored as { anchors: { ref: { fingerprint?: unknown } }[] }).anchors) {
      expect(anchor.ref.fingerprint).toBeDefined();
    }
    const diameter = jsonOf(
      await call('add_dimension', {
        sheet: 'Plate',
        view: 'Top',
        type: 'diameter',
        anchors: [{ edgeBetween: [`cylinder:${peg}:cap:end`, `cylinder:${peg}:side:wall`] }],
        at: [55, 15],
      }),
    );
    expect(diameter.result).toMatchObject({ value: 16, text: 'Ø16.0' });

    await call('set_parameter', { name: 'length', expression: '50 mm' });
    const listed = jsonOf(await call('list_sheets'));
    expect(listed.sheets[0].items[0]).toMatchObject({
      kind: 'dimension',
      view: 'Front',
      value: 50,
      text: '50.0',
      state: 'ok',
    });
    dispose();
  });

  it('refuses a name not in the view and anchors that measure nothing, changing nothing', async () => {
    const { call, store, plate, dispose } = await open();
    await call('add_sheet', { name: 'Plate' });
    const before = store.getState().doc;
    const unknown = await call('add_dimension', {
      sheet: 'Plate',
      view: 'Front',
      type: 'linear',
      anchors: [{ edge: 'e[nothing|here]' }],
      at: [0, 20],
    });
    expect(unknown.result.isError).toBe(true);
    expect(textOf(unknown)).toMatch(/^anchors\.0\.edge: There is no edge "e\[nothing\|here\]"/);
    const straight = await call('add_dimension', {
      sheet: 'Plate',
      view: 'Front',
      type: 'radius',
      anchors: [topFront(plate)],
      at: [0, 20],
    });
    expect(straight.result.isError).toBe(true);
    expect(textOf(straight)).toMatch(/^anchors: /);
    const noSheet = await call('add_view', { sheet: 'Nope', at: [10, 10] });
    expect(textOf(noSheet)).toBe('sheet: There is no sheet "Nope": list_sheets lists them.');
    const projectedFrom = await call('add_view', {
      sheet: 'Plate',
      parent: 'Front',
      side: 'left',
      from: 'top',
      at: [10, 10],
    });
    expect(textOf(projectedFrom)).toMatch(/^from: a projected view takes/);
    expect(store.getState().doc).toBe(before);
    dispose();
  });

  it('adds base and projected views and notes, each one undo step', async () => {
    const { call, store, plate, dispose } = await open();
    await call('add_sheet', { name: 'Notes', start: 'empty', titleBlock: 'none' });
    const base = jsonOf(await call('add_view', { sheet: 'Notes', from: 'top', at: [80, 80] }));
    expect(base.result).toMatchObject({ name: 'Top', sheet: 'Notes' });
    const projected = jsonOf(
      await call('add_view', { sheet: 'Notes', parent: 'Top', side: 'above', at: [80, 30] }),
    );
    // Named as the app names a projected view (first angle).
    expect(projected.result.name).toBe('Front');
    const text = jsonOf(
      await call('add_note', { sheet: 'Notes', text: 'Deburr all edges', at: [20, 180] }),
    );
    expect(text.result.kind).toBe('text');
    const leader = jsonOf(
      await call('add_note', {
        sheet: 'Notes',
        text: 'Top face',
        view: 'Top',
        anchor: { face: `box:${plate}:cap:end` },
        at: [-30, 20],
      }),
    );
    expect(leader.result.kind).toBe('leader');
    const sheet = store.getState().doc.sheets?.[0];
    expect(sheet?.views.map((v) => v.from.kind)).toEqual(['base', 'projected']);
    expect(sheet?.items.map((i) => i.kind)).toEqual(['text', 'leader']);
    expect(jsonOf(await call('undo')).undone).toBe('Agent: Add note on Notes');
    expect(store.getState().doc.sheets?.[0]?.items.map((i) => i.kind)).toEqual(['text']);
    dispose();
  });

  it('exports a PDF and a picture; a detached dimension is written with ?', async () => {
    const { call, plate, pictures, dispose } = await open();
    await call('add_sheet', { name: 'Plate', fields: { title: 'Bracket', date: '{date}' } });
    await call('add_dimension', {
      sheet: 'Plate',
      view: 'Front',
      type: 'linear',
      anchors: [topFront(plate)],
      at: [0, 20],
    });
    const pdf = await call('export_sheet', { format: 'pdf' });
    expect(pdf.file?.format).toBe('pdf');
    expect(Buffer.from(pdf.file?.bytes ?? []).toString('latin1', 0, 5)).toBe('%PDF-');
    expect(pdf.file?.design).toBe('Bracket');
    const strings = pdfStrings(pdf.file?.bytes ?? new Uint8Array());
    expect(strings).toContain('40.0');
    expect(strings).toContain('Bracket');
    // The fields as the app's Export drawing fills them: today, the newest version.
    expect(strings.some((s) => /^\d{4}-\d{2}-\d{2}$/.test(s))).toBe(true);

    // The plate's feature suppressed: the dimension's edge is gone.
    await call('suppress', { id: plate, on: true });
    const listed = jsonOf(await call('list_sheets'));
    expect(listed.sheets[0].items[0]).toMatchObject({ state: 'detached', text: '?' });
    expect(listed.sheets[0].items[0].message).toBeTruthy();
    const lost = await call('export_sheet', { format: 'pdf' });
    expect(pdfStrings(lost.file?.bytes ?? new Uint8Array())).toContain('?');
    expect(textOf(lost)).toMatch(/Plate: 1 detached \(written with \?\)/);

    const png = await call('export_sheet', { format: 'png', sheets: ['Plate'] });
    expect(png.result.content.map((c) => c.type)).toEqual(['text', 'image', 'text']);
    expect(png.file).toBeUndefined();
    expect(pictures).toHaveLength(1);
    expect(pictures[0]).toMatch(/^<\?xml|^<svg/);
    expect(pictures[0]).toContain('>?</text>');
    dispose();
  });
});
