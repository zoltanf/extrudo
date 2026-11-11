import {
  type BodyId,
  createDocument,
  type Sheet,
  type SheetId,
  type SheetViewId,
  sheetStandardFrom,
} from '@extrudo/core';
import { flattenContour } from '@extrudo/io';
import type { SheetViewResult, ViewGeometry } from '@extrudo/kernel';
import { describe, expect, it } from 'vitest';
import {
  linesAreCurrent,
  pieceContour,
  sheetViewLines,
  sheetViewNotice,
  sheetViewWants,
} from './viewLines';
import { SheetViewRunner, type SheetViewsKernel } from './viewRunner';

const A = 'body-a' as BodyId;
const B = 'body-b' as BodyId;
const FRONT = '00000000-0000-4000-8000-0000000000f1' as SheetViewId;
const RIGHT = '00000000-0000-4000-8000-0000000000f2' as SheetViewId;
const TOP = '00000000-0000-4000-8000-0000000000f3' as SheetViewId;

function sheet(views: Sheet['views']): Sheet {
  return {
    id: '00000000-0000-4000-8000-0000000000a1' as SheetId,
    name: 'Sheet',
    size: 'A3',
    orientation: 'landscape',
    scale: [1, 1],
    projection: 'first',
    decimals: 1,
    views,
    items: [],
  };
}

const front: Sheet['views'][number] = {
  id: FRONT,
  name: 'Front',
  at: [100, 100],
  from: sheetStandardFrom('front'),
};

function geometry(over: Partial<ViewGeometry> = {}): ViewGeometry {
  return {
    curves: [
      {
        kind: 'visible',
        body: A,
        edge: 'e1',
        pieces: [{ type: 'line', a: [0, 0], b: [10, 0] }],
      },
    ],
    bounds: { min: [0, 0], max: [10, 0] },
    status: 'ok',
    skipped: [],
    exact: true,
    ...over,
  };
}

describe('pieceContour', () => {
  it('turns each kernel piece into an io contour in the view frame', () => {
    expect(pieceContour({ type: 'line', a: [0, 0], b: [3, 4] })).toEqual({
      start: [0, 0],
      segments: [{ type: 'line', to: [3, 4] }],
      closed: false,
    });
    const arc = pieceContour({ type: 'arc', center: [0, 0], radius: 2, start: 0, end: Math.PI });
    expect(arc.start).toEqual([2, 0]);
    expect(arc.segments[0]).toMatchObject({ type: 'arc', center: [0, 0], sweep: Math.PI });
    expect(arc.segments[0]?.to[0]).toBeCloseTo(-2);
    expect(arc.closed).toBe(false);
    const circle = pieceContour({
      type: 'arc',
      center: [1, 1],
      radius: 1,
      start: 0,
      end: 2 * Math.PI,
    });
    expect(circle.closed).toBe(true);
    // An ellipse arc's points are the kernel's: flattened, every point is on it.
    const ellipse = pieceContour({
      type: 'ellipse',
      center: [0, 0],
      rx: 4,
      ry: 2,
      rotation: Math.PI / 6,
      start: 0,
      end: Math.PI / 2,
    });
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    for (const [x, y] of flattenContour(ellipse, 0.01)) {
      const u = x * c + y * s;
      const v = -x * s + y * c;
      expect((u / 4) ** 2 + (v / 2) ** 2).toBeCloseTo(1, 2);
    }
    const poly = pieceContour({
      type: 'polyline',
      points: [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    });
    expect(poly.segments).toHaveLength(2);
  });
});

describe('sheetViewLines', () => {
  it('keeps kinds, edge names and bounds, and marks stale lines', () => {
    const lines = sheetViewLines(
      geometry({
        curves: [
          { kind: 'hidden', body: A, pieces: [{ type: 'line', a: [0, 0], b: [1, 1] }] },
          { kind: 'outline', body: A, face: 'f', pieces: [] },
        ],
      }),
    );
    expect(lines.curves.map((c) => c.kind)).toEqual(['hidden', 'outline']);
    expect(lines.bounds).toEqual({ min: [0, 0], max: [10, 0] });
    expect(lines.state).toBeUndefined();
    expect(sheetViewLines(geometry(), true).state).toBe('stale');
    expect(sheetViewLines(geometry()).curves[0]?.edge).toBe('e1');
  });
});

describe('sheetViewWants', () => {
  it('asks each view from its frame with the shown bodies or its base view’s', () => {
    const doc = createDocument({ name: 'Box' });
    doc.bodies[A] = { name: 'Box', visible: true };
    doc.bodies[B] = { name: 'Lid', visible: false };
    const s = sheet([
      front,
      {
        id: RIGHT,
        name: 'Right',
        at: [200, 100],
        from: { kind: 'projected', parent: FRONT, side: 'right' },
      },
      { id: TOP, name: 'Top', at: [100, 200], from: sheetStandardFrom('top'), bodies: [B] },
    ]);
    const wants = sheetViewWants(doc, s, [A, B]);
    expect(wants.map((w) => w.request.bodies)).toEqual([[A], [A], [B]]);
    expect(wants[0]?.request.direction).toEqual([0, 1, 0]);
    // First angle: the view placed on the right shows the left side.
    expect(wants[1]?.request.direction).toEqual([1, 0, 0]);
    expect(new Set(wants.map((w) => w.key)).size).toBe(3);
    // The key has no position, scale or style in it.
    const moved = sheetViewWants(
      doc,
      sheet([{ ...front, at: [5, 5], scale: [1, 2], style: 'visible' }]),
      [A, B],
    );
    expect(moved[0]?.key).toBe(wants[0]?.key);
  });
});

describe('linesAreCurrent and notices', () => {
  it('compares drawn versions and missing bodies; a mesh body’s version does not count', () => {
    const g = geometry({ skipped: [{ body: B, reason: 'mesh' }] });
    expect(linesAreCurrent(g, { [A]: '1' }, { [A]: '1', [B]: '7' })).toBe(true);
    expect(linesAreCurrent(g, { [A]: '1' }, { [A]: '2' })).toBe(false);
    const gone = geometry({ curves: [], skipped: [{ body: B, reason: 'missing' }] });
    expect(linesAreCurrent(gone, {}, {})).toBe(true);
    expect(linesAreCurrent(gone, {}, { [B]: '1' })).toBe(false);
  });

  it('says what the plan’s states say', () => {
    const doc = { bodies: { [B]: { name: 'Box', visible: true } } };
    const gone = geometry({
      curves: [],
      status: 'partial',
      skipped: [{ body: B, reason: 'missing' }],
    });
    expect(sheetViewNotice(doc, gone)).toBe('Box is gone. Choose bodies or delete the view.');
    const mesh = geometry({ status: 'partial', skipped: [{ body: B, reason: 'mesh' }] });
    expect(sheetViewNotice(doc, mesh)).toBe("Mesh bodies can't be drawn yet.");
    expect(sheetViewNotice(doc, geometry({ curves: [] }))).toBe('No shown bodies to draw.');
    expect(sheetViewNotice(doc, geometry())).toBeUndefined();
  });
});

/** A kernel that answers from `draw`, one view per tick, and records the runs. */
function fakeKernel(draw: (id: string, quick: boolean) => ViewGeometry) {
  let versions: Record<BodyId, string> = { [A]: '1' };
  let cancels = 0;
  const runs: string[][] = [];
  let gate: Promise<void> = Promise.resolve();
  let open: () => void = () => {};
  const kernel: SheetViewsKernel = {
    bodyVersions: () => versions,
    cancelSheetViews: () => {
      cancels++;
    },
    async sheetViews(requests, onView) {
      const run = cancels;
      runs.push(requests.map((r) => `${r.id.slice(-2)}${r.quick ? 'q' : ''}`));
      const out: SheetViewResult[] = [];
      for (const [i, r] of requests.entries()) {
        if (cancels !== run)
          throw Object.assign(new Error('cancelled'), { name: 'SheetViewsCancelledError' });
        await gate;
        const result = {
          id: r.id,
          geometry: draw(r.id, r.quick === true),
          versions: { ...versions },
          ms: 1,
        };
        out.push(result);
        if ((await onView?.(result, i + 1, requests.length)) === false && i < requests.length - 1) {
          throw Object.assign(new Error('cancelled'), { name: 'SheetViewsCancelledError' });
        }
      }
      return out;
    },
  };
  return {
    kernel,
    runs,
    setVersions(next: Record<BodyId, string>) {
      versions = next;
    },
    hold() {
      gate = new Promise((resolve) => {
        open = resolve;
      });
    },
    release() {
      open();
      gate = Promise.resolve();
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SheetViewRunner', () => {
  const doc = createDocument({ name: 'Box' });
  doc.bodies[A] = { name: 'Box', visible: true };
  const two = sheet([front, { ...front, id: TOP, name: 'Top', from: sheetStandardFrom('top') }]);

  it('draws quick lines first, then exact ones, and does not run again for the same model', async () => {
    const k = fakeKernel((_, quick) => geometry({ exact: !quick }));
    const runner = new SheetViewRunner(k.kernel);
    const wants = sheetViewWants(doc, two, [A]);
    runner.want(wants);
    expect(runner.get().progress).toEqual({ done: 0, total: 2, since: expect.any(Number) });
    await flush();
    expect(k.runs).toEqual([['f1q', 'f3q', 'f1', 'f3']]);
    const state = runner.get();
    expect(state.progress).toBeUndefined();
    expect(state.pending.size).toBe(0);
    expect(state.lines.get(FRONT)?.state).toBeUndefined();
    const lines = state.lines.get(FRONT);
    runner.want(wants);
    await flush();
    expect(k.runs).toHaveLength(1);
    // The same lines object: layout's per-view cache holds.
    expect(runner.get().lines.get(FRONT)).toBe(lines);
  });

  it('keeps the old lines dimmed while a parameter change is recomputed', async () => {
    const k = fakeKernel((_, quick) => geometry({ exact: !quick }));
    const runner = new SheetViewRunner(k.kernel);
    runner.want(sheetViewWants(doc, two, [A]));
    await flush();
    k.setVersions({ [A]: '2' });
    k.hold();
    runner.want(sheetViewWants(doc, two, [A]));
    expect(runner.get().lines.get(FRONT)?.state).toBe('stale');
    expect(runner.get().pending.has(FRONT)).toBe(true);
    k.release();
    await flush();
    expect(runner.get().lines.get(FRONT)?.state).toBeUndefined();
    expect(k.runs[1]).toEqual(['f1q', 'f3q', 'f1', 'f3']);
  });

  it('stops between views on cancel and stays stopped until something changes', async () => {
    const k = fakeKernel((_, quick) => geometry({ exact: !quick }));
    const runner = new SheetViewRunner(k.kernel);
    k.hold();
    runner.want(sheetViewWants(doc, two, [A]));
    runner.cancel();
    k.release();
    await flush();
    const state = runner.get();
    expect(state.cancelled).toBe(true);
    expect(state.progress).toBeUndefined();
    // The first view was under way: it finished (quick); the rest never ran.
    expect(state.lines.get(FRONT)?.state).toBe('stale');
    expect(state.lines.has(TOP)).toBe(false);
    runner.want(sheetViewWants(doc, two, [A]));
    await flush();
    expect(k.runs).toHaveLength(1);
    k.setVersions({ [A]: '3' });
    runner.want(sheetViewWants(doc, two, [A]));
    await flush();
    expect(k.runs).toHaveLength(2);
    expect(runner.get().cancelled).toBe(false);
    expect(runner.get().pending.size).toBe(0);
  });

  it('computes the export’s views exactly, from the cache where it can', async () => {
    const k = fakeKernel((_, quick) => geometry({ exact: !quick }));
    const runner = new SheetViewRunner(k.kernel);
    const wants = sheetViewWants(doc, two, [A]);
    const steps: string[] = [];
    const lines = await runner.exact(wants, (done, total) => steps.push(`${done}/${total}`));
    expect([...lines.keys()]).toEqual([FRONT, TOP]);
    expect(steps).toEqual(['0/2', '1/2', '2/2']);
    expect(k.runs).toEqual([['f1', 'f3']]);
    await runner.exact(wants);
    expect(k.runs).toHaveLength(1);
  });
});
