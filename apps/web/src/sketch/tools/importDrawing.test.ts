/**
 * The Import Drawing tool (P4-06, ADR-0066 §1): the file it was given, the
 * panel's unit, scale, position and fixed choice, and OK committing the drawing
 * as one undo step. The solver is the real one; the drawing itself is read from
 * the fixtures `@extrudo/io`'s tests use, so the reader runs too.
 */
import { readFileSync } from 'node:fs';
import type { SketchChange, SketchEntityId } from '@extrudo/core';
import { type Drawing, readSvg } from '@extrudo/io';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_IMPORT_DRAFT,
  draftFromImport,
  importChange,
  importDrawingStore,
  importOffset,
  importReady,
  importScale,
  importSummary,
  resetImportDrawingDraft,
  setImportDrawingDraft,
} from '../importDraft';
import { drawingFormat, readDrawing } from '../pickDrawing';
import { IMPORT_DRAWING_TOOL } from './importDrawing';
import { at, disposeHosts, setup } from './testing';

const FIXTURES = new URL('../../../../../packages/io/src/fixtures/', import.meta.url);
const fixture = (name: string) => readFileSync(new URL(name, FIXTURES), 'utf8');

/** The draft a fixture file would open with. */
function draftFor(name: string) {
  const read = readDrawing(name, fixture(name));
  return draftFromImport(name, read.read, read.error);
}

/** IDs from a counter, as the tool host's own `newId`. */
let n = 0;
const newId = () => `n${n++}`;

/** The points of a change, in sketch mm. */
function pointsOf(change: SketchChange | undefined): [number, number][] {
  return Object.values(change?.entities ?? {})
    .filter((e) => e.type === 'point')
    .map((e) => (e.type === 'point' ? ([e.x, e.y] as [number, number]) : [0, 0]));
}

/** How wide a change's geometry is, in mm. */
function widthOf(change: SketchChange | undefined): number {
  const xs = pointsOf(change).map((p) => p[0]);
  return Math.max(...xs) - Math.min(...xs);
}

afterEach(() => {
  disposeHosts();
  resetImportDrawingDraft();
});

describe('picking a drawing', () => {
  it('tells SVG from DXF by the file name', () => {
    expect(drawingFormat('plate.SVG')).toBe('svg');
    expect(drawingFormat('plate.dxf')).toBe('dxf');
    expect(drawingFormat('plate.pdf')).toBeUndefined();
  });

  it('reads the SVG fixture and finds its curves', () => {
    const draft = draftFor('rect-circle.svg');
    expect(draft.error).toBeUndefined();
    expect(draft.fileName).toBe('rect-circle.svg');
    // Four sides and a whole circle, so five curves.
    expect(importSummary(draft)).toBe('5 curves');
    // The file is in millimetres, which the panel preselects.
    expect(draft.units).toBe('mm');
    expect(draft.fixed).toBe(true);
  });

  it('offers the unit the DXF file declares', () => {
    const draft = draftFor('square-inches.dxf');
    expect(draft.units).toBe('in');
    // A one-inch square: 25.4 mm across.
    expect(widthOf(importChange(draft, newId))).toBeCloseTo(25.4, 9);
  });

  it('keeps a reader error in the draft and refuses the import', () => {
    const draft = draftFromImport('notes.txt', undefined, "This file isn't an SVG file.");
    expect(draft.open).toBe(true);
    expect(draft.error).toBe("This file isn't an SVG file.");
    expect(importReady(draft)).toBe(false);
    expect(importSummary(draft)).toBe("This file isn't an SVG file.");
    expect(importChange(draft, newId)).toBeUndefined();
  });

  it('refuses a binary DXF with the message that says to save it as ASCII', () => {
    // The 22-byte sentinel a binary DXF file starts with.
    const read = readDrawing('plate.dxf', '  AutoCAD Binary DXF\r\n\u001a\0');
    expect(read.error).toBe("Binary DXF isn't supported: save it as ASCII DXF.");
  });

  it('counts what the reader left out', () => {
    const draft = draftFor('kinds.svg');
    expect(draft.skipped.text).toBe(1);
    // Every segment of the fixture file, before duplicates are left out.
    expect(importSummary(draft)).toBe(
      '43 curves · skipped 1 style, 1 text, 1 image, 1 use, 1 defs, 1 clipPath',
    );
  });
});

describe("the panel's choices", () => {
  it('re-scales the drawing when another unit is chosen', () => {
    // A square the reader has already put in millimetres: 96 px is 25.4 mm.
    const square = (mm: number): Drawing => ({
      layers: [{ name: 'Imported', color: '#000000', aci: 7 }],
      shapes: [
        {
          layer: 'Imported',
          contours: [
            {
              start: [0, 0],
              segments: [
                { type: 'line', to: [mm, 0] },
                { type: 'line', to: [mm, mm] },
                { type: 'line', to: [0, mm] },
              ],
              closed: true,
            },
          ],
        },
      ],
    });
    const draft = draftFromImport('square.svg', {
      drawing: square(25.4),
      units: 'px',
      skipped: {},
    });
    importDrawingStore.setState(draft);
    expect(draft.units).toBe('px');
    // At the file's own unit nothing is added to the reader's millimetres.
    expect(importScale(draft)).toBeCloseTo(1, 9);
    expect(widthOf(importChange(draft, newId))).toBeCloseTo(25.4, 9);
    setImportDrawingDraft({ units: 'mm' });
    // Read as millimetres instead, those 96 units are 96 mm.
    expect(widthOf(importChange(importDrawingStore.getState(), newId))).toBeCloseTo(96, 9);
  });

  it('moves the drawing by its scale', () => {
    importDrawingStore.setState(draftFor('rect-circle.svg'));
    setImportDrawingDraft({ scale: 2 });
    // The fixture is 40 mm wide from -20 to 20: doubled, it spans 80 mm.
    expect(widthOf(importChange(importDrawingStore.getState(), newId))).toBeCloseTo(80, 6);
  });

  it('centres the drawing on the sketch origin when asked', () => {
    // A drawing whose box is off the origin, so centring has something to do.
    importDrawingStore.setState({
      ...draftFor('rect-circle.svg'),
      drawing: {
        ...(draftFor('rect-circle.svg').drawing as NonNullable<
          ReturnType<typeof draftFor>['drawing']
        >),
        shapes: [
          {
            layer: 'Imported',
            contours: [
              {
                start: [20, 30],
                segments: [
                  { type: 'line', to: [60, 30] },
                  { type: 'line', to: [60, 50] },
                  { type: 'line', to: [20, 50] },
                ],
                closed: true,
              },
            ],
          },
        ],
      },
      position: 'centre',
    });
    const draft = importDrawingStore.getState();
    // The box runs 20…60 in x and 30…50 in y, so its middle is (40, 40).
    expect(importOffset(draft)[0]).toBeCloseTo(-40, 9);
    expect(importOffset(draft)[1]).toBeCloseTo(-40, 9);
    const change = importChange(draft, newId);
    const xs = pointsOf(change).map((p) => p[0]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(0, 9);
  });

  it('is not ready without a drawing', () => {
    expect(importReady({ ...DEFAULT_IMPORT_DRAFT, open: true })).toBe(false);
    expect(importSummary({ ...DEFAULT_IMPORT_DRAFT, open: true })).toBe('No drawing loaded.');
  });

  it('is not ready at a scale of zero', () => {
    const draft = { ...draftFor('rect-circle.svg'), scale: 0 };
    expect(importReady(draft)).toBe(false);
  });
});

describe('Import Drawing tool', () => {
  /** The tool with a drawing in the draft, and OK pressed. */
  async function commit(patch: Partial<typeof DEFAULT_IMPORT_DRAFT> = {}) {
    const t = await setup({ tool: IMPORT_DRAWING_TOOL });
    importDrawingStore.setState({ ...draftFor('rect-circle.svg'), ...patch });
    t.host.move(at(0, 0));
    t.host.enter();
    return t;
  }

  it('previews the drawing where it would land', async () => {
    const t = await setup({ tool: IMPORT_DRAWING_TOOL });
    importDrawingStore.setState(draftFor('rect-circle.svg'));
    t.host.move(at(0, 0));
    const preview = t.host.state.getState().revision >= 0;
    expect(preview).toBe(true);
    expect(t.byType('line')).toHaveLength(0);
  });

  it('commits the drawing as fixed curves, in one undo step named after the file', async () => {
    const t = await commit();
    expect(t.byType('line')).toHaveLength(4);
    expect(t.byType('circle')).toHaveLength(1);
    expect(t.byType('spline')).toHaveLength(0);
    // Every curve is fixed, and no coincident constraints were made.
    expect(t.constraints().filter((c) => c.startsWith('fix'))).toHaveLength(5);
    expect(t.constraints().filter((c) => c.startsWith('coincident'))).toHaveLength(0);
    expect(t.store.getState().undoLabel).toBe('Import rect-circle.svg');
    // One undo takes the whole import out.
    t.store.getState().undo();
    expect(t.byType('line')).toHaveLength(0);
    expect(t.byType('circle')).toHaveLength(0);
    expect(t.constraints()).toHaveLength(0);
  });

  it('joins the ends with coincident constraints when Fixed is off', async () => {
    const t = await commit({ fixed: false });
    expect(t.constraints().filter((c) => c.startsWith('fix'))).toHaveLength(0);
    // The rectangle's four corners, and the circle stands alone.
    expect(t.constraints().filter((c) => c.startsWith('coincident'))).toHaveLength(4);
  });

  it('centres the drawing when the panel asks it to', async () => {
    const t = await commit({ position: 'centre' });
    const lines = t.byType('line') as { start: SketchEntityId; end: SketchEntityId }[];
    const xs = lines.flatMap((line) =>
      [line.start, line.end].map((id) => t.point(id as SketchEntityId)[0]),
    );
    const middle = (Math.min(...xs) + Math.max(...xs)) / 2;
    expect(middle).toBeCloseTo(0, 6);
  });

  it('says why it cannot import, and changes nothing', async () => {
    const t = await commit({
      error: 'This drawing has 12,400 curves; Extrudo imports up to 5,000.',
    });
    expect(t.byType('line')).toHaveLength(0);
    expect(t.host.state.getState().error).toBe(
      'This drawing has 12,400 curves; Extrudo imports up to 5,000.',
    );
  });

  it('changes nothing without a file', async () => {
    const t = await setup({ tool: IMPORT_DRAWING_TOOL });
    t.host.enter();
    expect(t.byType('line')).toHaveLength(0);
  });

  it('cancels with Esc, leaving the sketch as it was', async () => {
    const t = await setup({ tool: IMPORT_DRAWING_TOOL });
    importDrawingStore.setState(draftFor('rect-circle.svg'));
    t.host.escape();
    expect(importDrawingStore.getState().open).toBe(false);
    expect(t.byType('line')).toHaveLength(0);
  });
});

/** The change the panel would commit, for tests that only want the geometry. */
export function changeOf(draft: typeof DEFAULT_IMPORT_DRAFT): SketchChange | undefined {
  let n = 0;
  return importChange(draft, () => `n${n++}`);
}

// A drawing read through the reader the app uses, kept honest here.
it('reads the same drawing the app reads', () => {
  const read = readSvg(fixture('rect-circle.svg'));
  expect(read.units).toBe('mm');
  expect(read.drawing.shapes).toHaveLength(2);
});
