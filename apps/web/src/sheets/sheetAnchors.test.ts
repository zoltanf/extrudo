// @vitest-environment jsdom
import {
  type Sheet,
  type SheetAnchors,
  type SheetDimensionItem,
  type SheetId,
  type SheetItem,
  type SheetItemId,
  type SheetRefAnchor,
  type SheetViewId,
  sheetStandardFrom,
} from '@extrudo/core';
import type { DisplayItem } from '@extrudo/io';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PAPER_ERROR, screenPaint } from './SheetCanvas';
import { itemReason } from './SheetTabs';
import {
  detachedDimensions,
  drawnItems,
  exportAnchors,
  type SheetAnchorsKernel,
  sheetItemsStore,
  useSheetAnchors,
} from './sheetAnchors';

const ref = (id: string): SheetRefAnchor['ref'] => ({
  kind: 'edge',
  id,
  fingerprint: { type: 'line', at: [0, 0, 0] },
});

function sheetWith(items: SheetItem[], id = 's1'): Sheet {
  return {
    id: id as SheetId,
    name: 'Sheet 1',
    size: 'A3',
    orientation: 'landscape',
    scale: [1, 1],
    projection: 'first',
    decimals: 0,
    views: [
      { id: 'v1' as SheetViewId, name: 'Front', at: [100, 100], from: sheetStandardFrom('front') },
    ],
    items,
  };
}

const dimension = (id: string, anchors: SheetDimensionItem['anchors'], view = 'v1') =>
  ({
    kind: 'dimension',
    id: id as SheetItemId,
    view: view as SheetViewId,
    type: 'linear',
    anchors,
    at: [0, 20],
  }) as SheetItem;
const text = { kind: 'text', id: 't1' as SheetItemId, at: [10, 10], text: 'Hi' } as SheetItem;
const LINE = { type: 'line' as const, start: [0, 0, 0] as const, end: [10, 0, 0] as const };

afterEach(() => {
  cleanup();
  sheetItemsStore.setState({ sheet: undefined, rows: new Map(), kept: new Map() });
});

describe('drawnItems', () => {
  const sheet = sheetWith([
    text,
    dimension('d1', [{ ref: ref('a') }]),
    dimension('d2', [{ ref: ref('b') }]),
  ]);

  it('leaves out the anchored items the kernel has not been asked about', () => {
    expect(drawnItems(sheet, new Set()).items.map((i) => i.id)).toEqual(['t1']);
    expect(drawnItems(sheet, new Set(['d2' as SheetItemId])).items.map((i) => i.id)).toEqual([
      't1',
      'd2',
    ]);
  });

  it("draws everything with 'all', and is the same sheet when nothing is left out", () => {
    expect(drawnItems(sheet, 'all')).toBe(sheet);
    expect(drawnItems(sheet, new Set(['d1', 'd2'] as SheetItemId[]))).toBe(sheet);
  });
});

describe('detachedDimensions', () => {
  it('counts dimensions with a lost or unreported anchor, or a view that is gone', () => {
    const sheet = sheetWith([
      dimension('ok', [{ ref: ref('a') }, { free: [0, 0] }]),
      dimension('lost', [{ ref: ref('a') }]),
      dimension('unasked', [{ ref: ref('a') }]),
      dimension('free', [{ free: [0, 0] }, { free: [5, 0] }]),
      dimension('orphan', [{ ref: ref('a') }], 'gone'),
      text,
    ]);
    const anchors: SheetAnchors = {
      ['ok' as SheetItemId]: [{ status: 'moved', geometry: LINE as never }, { status: 'ok' }],
      ['lost' as SheetItemId]: [{ status: 'detached', geometry: LINE as never }],
      ['orphan' as SheetItemId]: [{ status: 'ok' }],
    };
    expect(detachedDimensions(sheet, anchors)).toBe(3);
    expect(detachedDimensions(sheetWith([text]), undefined)).toBe(0);
  });
});

describe('exportAnchors', () => {
  it('keeps the geometry the screen kept, and is what the screen drew when the kernel is silent', () => {
    const id = 'd1' as SheetItemId;
    const kept: SheetAnchors = { [id]: [{ status: 'ok', geometry: LINE as never }] };
    sheetItemsStore.setState({ kept: new Map([['s1' as SheetId, kept]]) });
    expect(
      exportAnchors('s1' as SheetId, { [id]: [{ status: 'detached', message: 'Gone.' }] }),
    ).toEqual({
      [id]: [{ status: 'detached', geometry: LINE, message: 'Gone.' }],
    });
    expect(exportAnchors('s1' as SheetId, undefined)).toBe(kept);
    expect(exportAnchors('s2' as SheetId, undefined)).toEqual({});
  });
});

describe('screenPaint', () => {
  const stroke = {
    type: 'path',
    key: 'item:d1',
    contours: [],
    stroke: { width: 0.18, color: '#000000' },
  } as unknown as DisplayItem;
  const arrow = {
    type: 'path',
    key: 'item:d1',
    contours: [],
    fill: { color: '#000000' },
  } as unknown as DisplayItem;

  it('paints a detached item in the error colour, its lines dashed; an invalid one solid', () => {
    expect(screenPaint({ ...stroke, state: 'detached' } as DisplayItem)).toMatchObject({
      stroke: PAPER_ERROR,
      strokeDasharray: '1.6 1',
    });
    expect(screenPaint({ ...arrow, state: 'detached' } as DisplayItem)).toMatchObject({
      fill: PAPER_ERROR,
    });
    const invalid = screenPaint({ ...stroke, state: 'invalid' } as DisplayItem);
    expect(invalid.stroke).toBe(PAPER_ERROR);
    expect(invalid.strokeDasharray).toBeUndefined();
  });

  it('leaves a moved or an ok item as the writers paint it', () => {
    expect(screenPaint({ ...stroke, state: 'moved' } as DisplayItem).stroke).toBe('#000000');
    expect(screenPaint(stroke).stroke).toBe('#000000');
  });
});

describe('itemReason (the status bar)', () => {
  const rows = new Map([
    ['d1', { state: 'detached' as const, message: 'Pocket, the feature … is suppressed.' }],
    ['d2', { state: 'moved' as const }],
    ['d3', { state: 'ok' as const }],
  ]);

  it('says why the selected item is lost or moved, else the hovered one', () => {
    expect(itemReason(rows, ['item:d1'], undefined)).toEqual({
      state: 'detached',
      text: 'Pocket, the feature … is suppressed.',
    });
    expect(itemReason(rows, ['item:d3'], 'item:d2')?.state).toBe('moved');
    expect(itemReason(rows, ['item:d3'], undefined)).toBeUndefined();
    expect(itemReason(rows, ['item:d1', 'item:d2'], undefined)).toBeUndefined();
    expect(itemReason(rows, ['view:v1'], 'item:d1')?.state).toBe('detached');
  });
});

describe('useSheetAnchors', () => {
  /** A kernel whose answers the test hands out. */
  function fakeKernel() {
    const calls: { sheet: Sheet; answer(a: SheetAnchors | undefined): Promise<void> }[] = [];
    const kernel: SheetAnchorsKernel = {
      resolveSheet: (sheet) =>
        new Promise((resolve) => {
          calls.push({
            sheet,
            answer: async (a) => {
              await act(async () => resolve(a));
            },
          });
        }),
    };
    return { kernel, calls };
  }
  const d1 = 'd1' as SheetItemId;

  it('waits for the first answer, keeps a lost anchor’s geometry, and drops older answers', async () => {
    const { kernel, calls } = fakeKernel();
    const sheet = sheetWith([dimension('d1', [{ ref: ref('a') }])]);
    const { result, rerender } = renderHook(
      ({ s, model, hold }) => useSheetAnchors(kernel, s, model, hold),
      { initialProps: { s: sheet, model: 1 as unknown, hold: false } },
    );
    expect(result.current.anchors).toBeUndefined();
    expect(result.current.asked).toEqual(new Set());
    await calls[0]?.answer({ [d1]: [{ status: 'ok', geometry: LINE as never }] });
    expect(result.current.asked).toEqual(new Set([d1]));
    expect(result.current.anchors?.[d1]?.[0]?.status).toBe('ok');
    expect(sheetItemsStore.getState().kept.get(sheet.id)).toBe(result.current.anchors);

    // While the model is computed nothing is asked; after it, again.
    rerender({ s: sheet, model: 2, hold: true });
    expect(calls).toHaveLength(1);
    rerender({ s: sheet, model: 2, hold: false });
    rerender({ s: sheet, model: 3, hold: false });
    expect(calls).toHaveLength(3);
    // The newest answer wins; the older one, coming later, is dropped.
    await calls[2]?.answer({ [d1]: [{ status: 'detached', message: 'Gone.' }] });
    await calls[1]?.answer({ [d1]: [{ status: 'ok' }] });
    expect(result.current.anchors?.[d1]).toEqual([
      { status: 'detached', geometry: LINE, message: 'Gone.' },
    ]);
  });

  it('draws every item, detached, when the kernel can’t say, and with no kernel', async () => {
    const { kernel, calls } = fakeKernel();
    const sheet = sheetWith([dimension('d1', [{ ref: ref('a') }])]);
    const { result } = renderHook(() => useSheetAnchors(kernel, sheet, 1, false));
    await calls[0]?.answer(undefined);
    expect(result.current.asked).toBe('all');
    expect(result.current.anchors).toEqual({});
    const none = renderHook(() => useSheetAnchors(undefined, sheet, 1, false));
    expect(none.result.current.asked).toBe('all');
  });

  it('merges reports the caller already has, and asks about them no more', async () => {
    const { kernel, calls } = fakeKernel();
    const sheet = sheetWith([]);
    const { result } = renderHook(() => useSheetAnchors(kernel, sheet, 1, false));
    await calls[0]?.answer({});
    act(() => result.current.merge({ [d1]: [{ status: 'ok' }] }));
    expect(result.current.asked).toEqual(new Set([d1]));
    expect(result.current.anchors?.[d1]).toEqual([{ status: 'ok' }]);
  });
});
