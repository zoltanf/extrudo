import {
  type Sheet,
  type SheetItemId,
  type SheetRefAnchor,
  type SheetViewId,
  sheetItemProblems,
} from '@extrudo/core';
import { withEveryStickyNote } from '@extrudo/sheets';
import { describe, expect, it } from 'vitest';
import type { PickShape, SheetHit, SheetPick, SheetPickable } from './dimensionTool';
import {
  LEADER_PLACEHOLDER,
  noteAccepts,
  noteItem,
  noteRepick,
  noteStep,
  noteWhole,
  repickAccepts,
  repickWhole,
} from './noteTools';

const V = 'v1' as SheetViewId;
const ID = 'n1' as SheetItemId;
const ref = (kind: 'edge' | 'face', id: string): SheetRefAnchor['ref'] => ({
  kind,
  id,
  fingerprint: { type: 'line', at: [0, 0, 0] },
});

function pickable(
  kind: SheetPickable['kind'],
  name: string,
  shape: PickShape,
  ends: SheetPickable['ends'] = [],
): SheetPickable {
  return {
    key: `${V}|b|${kind}|${name}`,
    view: V,
    body: 'b' as never,
    kind,
    name,
    shape,
    paths: [],
    ends,
  };
}

const line = (a: [number, number], b: [number, number]) => ({ type: 'line' as const, a, b });
const across = pickable('edge', 'e1', line([0, 0], [10, 0]), [
  [0, 0],
  [10, 0],
]);
const parallel = pickable('edge', 'e2', line([0, 5], [10, 5]));
const slanted = pickable('edge', 'e3', line([0, 0], [10, 10]));
const rim = pickable('edge', 'c1', { type: 'circle', centre: [5, 5], radius: 2, full: true });
const outline = pickable('outline', 'f1', line([0, 0], [0, 10]));
const face = pickable('face', 'f2', { type: 'curve' });

const hit = (p: SheetPickable, end?: number): SheetHit => ({
  pickable: p,
  ...(end !== undefined && { end }),
});
const edgePick = (p: SheetPickable): SheetPick => ({
  kind: 'edge',
  view: V,
  key: p.key,
  ref: ref('edge', p.name),
  shape: p.shape,
});
const facePick = (name: string): SheetPick => ({
  kind: 'face',
  view: V,
  key: `${V}|b|face|${name}`,
  ref: ref('face', name),
  p: [1, 2],
});

describe('what each notes tool takes', () => {
  it('a leader note takes anything once: an edge, a vertex, an outline, a face', () => {
    for (const h of [hit(across), hit(across, 0), hit(outline), hit(face), hit(rim)]) {
      expect(noteAccepts('leader', h, [])).toBe(true);
    }
    expect(noteAccepts('leader', hit(parallel), [edgePick(across)])).toBe(false);
  });

  it('a centre mark takes a circle or an outline (its face), never a line or a vertex', () => {
    expect(noteAccepts('centreMark', hit(rim), [])).toBe(true);
    expect(noteAccepts('centreMark', hit(outline), [])).toBe(true);
    expect(noteAccepts('centreMark', hit(across), [])).toBe(false);
    expect(noteAccepts('centreMark', hit(across, 1), [])).toBe(false);
    expect(noteAccepts('centreMark', hit(face), [])).toBe(false);
    expect(noteWhole('centreMark', hit(outline), [])).toBe(true);
  });

  it('a centre line takes a line, then a parallel one; an outline first is its face, the axis', () => {
    expect(noteAccepts('centreLine', hit(across), [])).toBe(true);
    expect(noteAccepts('centreLine', hit(rim), [])).toBe(false);
    expect(noteAccepts('centreLine', hit(across, 0), [])).toBe(false);
    const first = [edgePick(across)];
    expect(noteAccepts('centreLine', hit(parallel), first)).toBe(true);
    expect(noteAccepts('centreLine', hit(slanted), first)).toBe(false);
    expect(noteAccepts('centreLine', hit(across), first)).toBe(false);
    expect(noteWhole('centreLine', hit(outline), [])).toBe(true);
    expect(noteWhole('centreLine', hit(outline), first)).toBe(false);
  });
});

describe('what the picks make', () => {
  it('a leader note on the pick with its text at `at`, the placeholder until typed', () => {
    const item = noteItem('leader', ID, [facePick('top')], [3, 4]);
    expect(item).toEqual({
      kind: 'leader',
      id: ID,
      view: V,
      anchor: { ref: ref('face', 'top') },
      at: [3, 4],
      text: LEADER_PLACEHOLDER,
    });
    expect(item && sheetItemProblems(item)).toEqual([]);
  });

  it("a centre mark on one circle; a centre line on two lines or one face, each as the document's rule takes it", () => {
    const mark = noteItem('centreMark', ID, [edgePick(rim)], [0, 0]);
    expect(mark).toMatchObject({ kind: 'centreMark', anchors: [{ ref: ref('edge', 'c1') }] });
    const between = noteItem('centreLine', ID, [edgePick(across), edgePick(parallel)], [0, 0]);
    expect(between).toMatchObject({ kind: 'centreLine', anchors: [{}, {}] });
    const axis = noteItem('centreLine', ID, [facePick('bore')], [0, 0]);
    expect(axis).toMatchObject({ anchors: [{ ref: ref('face', 'bore') }] });
    for (const item of [mark, between, axis]) expect(item && sheetItemProblems(item)).toEqual([]);
    // One line waits for the other.
    expect(noteItem('centreLine', ID, [edgePick(across)], [0, 0])).toBeUndefined();
  });

  it('the panel says what to pick next', () => {
    expect(noteStep('leader', [])).toBe('Pick an edge, a point or a face to point at.');
    expect(noteStep('leader', [facePick('x')])).toBe('Click where the text goes, then type.');
    expect(noteStep('centreLine', [edgePick(across)])).toBe(
      'Pick the parallel edge on the other side.',
    );
  });
});

describe('picking a lost note again', () => {
  const leader = noteItem('leader', ID, [edgePick(across)], [0, 0]);
  const mark = noteItem('centreMark', ID, [edgePick(rim)], [0, 0]);
  const between = noteItem('centreLine', ID, [edgePick(across), edgePick(parallel)], [0, 0]);
  const axis = noteItem('centreLine', ID, [facePick('bore')], [0, 0]);
  if (!leader || !mark || !between || !axis) throw new Error('No items');

  it('a leader takes anything; its anchor is replaced', () => {
    expect(noteRepick(leader, 0, facePick('top'))).toEqual({ anchor: { ref: ref('face', 'top') } });
    expect(repickAccepts(leader, hit(face))).toBe(true);
  });

  it('a centre mark takes a circle again, else says why', () => {
    expect(noteRepick(mark, 0, facePick('bore'))).toEqual({
      anchors: [{ ref: ref('face', 'bore') }],
    });
    expect(noteRepick(mark, 0, edgePick(across))).toBe(
      'A centre mark takes a circle: drag onto a circle or a cylinder.',
    );
    expect(repickWhole(mark, hit(outline))).toBe(true);
  });

  it('a centre line keeps what it runs on: two lines, or an axis', () => {
    expect(noteRepick(between, 1, edgePick(slanted))).toEqual({
      anchors: [{ ref: ref('edge', 'e1') }, { ref: ref('edge', 'e3') }],
    });
    expect(noteRepick(between, 0, facePick('bore'))).toBe(
      'A centre line runs between two straight edges: drag onto one.',
    );
    expect(noteRepick(axis, 0, edgePick(across))).toMatch(/runs along an axis/);
    expect(repickAccepts(axis, hit(outline))).toBe(true);
    expect(repickAccepts(axis, hit(across))).toBe(false);
    expect(repickWhole(between, hit(outline))).toBe(false);
  });
});

describe('the export with every sticky note', () => {
  it('copies the sheet with each screen-only note printed; the document is untouched', () => {
    const sheet = {
      id: 's',
      items: [
        { kind: 'sticky', id: 'a', at: [0, 0], size: [10, 10], text: 'A' },
        { kind: 'sticky', id: 'b', at: [0, 0], size: [10, 10], text: 'B', print: true },
        { kind: 'text', id: 'c', at: [0, 0], text: 'C' },
      ],
    } as unknown as Sheet;
    const out = withEveryStickyNote(sheet);
    expect(out.items.map((i) => (i.kind === 'sticky' ? i.print : 'text'))).toEqual([
      true,
      true,
      'text',
    ]);
    expect(sheet.items[0]).not.toHaveProperty('print');
    const none = { ...sheet, items: [sheet.items[1]] } as Sheet;
    expect(withEveryStickyNote(none)).toBe(none);
  });
});
