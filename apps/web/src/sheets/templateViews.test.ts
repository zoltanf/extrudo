// The wall bracket template's four standard views (front, the right side, top and an
// isometric, first angle, as a new sheet gets them) through the app's own path: the
// kernel's `sheetView`, `sheetViewLines`, `layoutSheet` and the SVG writer, as a golden
// SVG (P6-24 S2's "done when"; the other templates are the kernel's goldens of B2, B4 and
// B5). Rewrite with
//   pnpm vitest run apps/web/src/sheets/templateViews --update
// and look at the picture and the diff.
import {
  type BodyId,
  type Sheet,
  type SheetId,
  type SheetViewId,
  sheetStandardFrom,
} from '@extrudo/core';
import { Kernel } from '@extrudo/kernel';
import { kernelFeatures, loadOcct, RecomputeEngine } from '@extrudo/kernel/node';
import { type SheetViewLines, sheetToSvg } from '@extrudo/sheets';
import { describe, expect, it } from 'vitest';
import { wallBracket } from '../project/templates';
import { sheetViewLines, sheetViewWants } from './viewLines';

const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const FRONT = id(1) as SheetViewId;

/** An A3 sheet at 1:2: front at the top left, its right side to its left, top below, iso. */
const SHEET: Sheet = {
  id: id(90) as SheetId,
  name: 'Bracket',
  size: 'A3',
  orientation: 'landscape',
  scale: [1, 2],
  projection: 'first',
  decimals: 1,
  border: {},
  views: [
    { id: FRONT, name: 'Front', at: [200, 110], from: sheetStandardFrom('front') },
    {
      id: id(2) as SheetViewId,
      name: 'Right',
      at: [90, 110],
      from: { kind: 'projected', parent: FRONT, side: 'left' },
    },
    {
      id: id(3) as SheetViewId,
      name: 'Top',
      at: [200, 200],
      from: { kind: 'projected', parent: FRONT, side: 'below' },
    },
    {
      id: id(4) as SheetViewId,
      name: 'Isometric',
      at: [320, 130],
      from: { kind: 'projected', parent: FRONT, side: 'iso-above-right' },
    },
  ],
  items: [],
};

describe('the wall bracket template on a sheet', () => {
  it('draws its four standard views as the golden', { timeout: 120_000 }, async () => {
    const doc = wallBracket();
    const kernel = new Kernel(await loadOcct());
    try {
      const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
      const result = await engine.recompute({ doc });
      if (result.status !== 'done') throw new Error(result.status);
      const bodies = result.bodies.map((b) => b.id as BodyId);
      const views = new Map<SheetViewId, SheetViewLines>();
      for (const want of sheetViewWants(doc, SHEET, bodies)) {
        const drawn = engine.sheetView(want.request);
        if ('error' in drawn) throw new Error(drawn.error);
        expect(drawn.geometry.exact).toBe(true);
        expect(drawn.geometry.curves.length).toBeGreaterThan(0);
        // The template's feature IDs are new each time, and the curves' order follows their
        // names: sort them by what they draw, so the golden compares geometry only.
        const lines = sheetViewLines(drawn.geometry);
        const key = (c: (typeof lines.curves)[number]) => `${c.kind}${JSON.stringify(c.contours)}`;
        views.set(want.request.id as SheetViewId, {
          ...lines,
          curves: [...lines.curves].sort((a, b) =>
            key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0,
          ),
        });
      }
      engine.clear();
      // The front view: the L's profile, 40 mm across and 60 up at 1:2 (from the origin).
      const front = views.get(FRONT)?.bounds;
      expect(front && [front.max[0] - front.min[0], front.max[1] - front.min[1]]).toEqual([40, 60]);
      await expect(sheetToSvg(SHEET, { name: doc.name, views })).toMatchFileSnapshot(
        './golden/wall-bracket-views.svg',
      );
    } finally {
      kernel.dispose();
    }
  });
});
