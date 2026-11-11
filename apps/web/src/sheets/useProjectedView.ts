/**
 * Projected View (P6-24 S2, plan §4.5): views lined up with a parent view. The tool takes
 * the selected view (or the view Base View just placed, or Projected View from This) as the
 * parent; the pointer's place against the parent's middle chooses the side (beside, above,
 * below: that side's orthographic view for the sheet's projection angle; a diagonal: an
 * isometric), the frame of that side's quick lines follows the pointer along the parent's
 * line, and a click places the view (one undo step, "Projected view"). The tool stays on
 * for the next one until Esc.
 */
import {
  type BodyId,
  type ExtrudoDocument,
  type SessionStore,
  SHEET_VIEW_SIDES,
  type Sheet,
  type SheetView,
  type SheetViewId,
  type SheetViewSide,
  sheetProjectedFrame,
  sheetViewFrame,
} from '@extrudo/core';
import { shownBodies, type ViewGeometry } from '@extrudo/kernel';
import { type SheetViewLines, sheetViewScale } from '@extrudo/sheets';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SheetModeStores } from './mode';
import type { SheetPlacing } from './SheetCanvas';
import { baseViewOf, sheetViewWant } from './viewLines';
import type { SheetViewRunner } from './viewRunner';
import { placeProjectedView, projectedAt, projectedName, projectedSide } from './views';

export interface ProjectedViewTool {
  /** The view projected from, once chosen. */
  parent: SheetView | undefined;
  /** What the pointer's place gives now ("Top", "Isometric"). */
  next: string | undefined;
  /** The frame following the pointer, while a parent is chosen. */
  placing: SheetPlacing | undefined;
  /** The next view's quick lines are still being drawn. */
  drawing: boolean;
  /** Starts the tool from view `id` (Base View's view, Projected View from This). */
  start(id: SheetViewId): void;
}

export function useProjectedView({
  active,
  sheet,
  doc,
  bodies,
  runner,
  geometry,
  selectedView,
  stores,
  session,
  notify,
}: {
  active: boolean;
  sheet: Sheet | undefined;
  doc: ExtrudoDocument;
  /** The bodies at the marker. */
  bodies: readonly BodyId[];
  runner: SheetViewRunner | undefined;
  /** Each view's geometry on screen (the parent's middle comes from its bounds). */
  geometry: ReadonlyMap<SheetViewId, ViewGeometry>;
  selectedView: SheetView | undefined;
  stores: SheetModeStores;
  session: SessionStore;
  notify(tone: 'info' | 'error', text: string): void;
}): ProjectedViewTool {
  const [parentId, setParentId] = useState<SheetViewId>();
  const [side, setSide] = useState<SheetViewSide>();
  const [previews, setPreviews] = useState<ReadonlyMap<SheetViewSide, SheetViewLines>>(new Map());
  // The tool ended: the next start chooses again.
  useEffect(() => {
    if (!active) {
      setParentId(undefined);
      setSide(undefined);
    }
  }, [active]);
  // Started with a view selected, or a view clicked while it waits: that is the parent.
  useEffect(() => {
    if (active && parentId === undefined && selectedView) setParentId(selectedView.id);
  }, [active, parentId, selectedView]);
  const parent = sheet?.views.find((v) => v.id === parentId);
  const frame = useMemo(
    () => (sheet && parent ? sheetViewFrame(sheet, parent.id) : undefined),
    [sheet, parent],
  );
  const chosen = sheet && parent ? baseViewOf(sheet, parent)?.bodies : undefined;
  const drawn = useMemo(() => chosen ?? shownBodies(doc, bodies), [chosen, doc, bodies]);
  // Every side's quick lines, asked once the parent is known (milliseconds each).
  useEffect(() => {
    setPreviews(new Map());
    if (!active || !sheet || !frame || !runner) return;
    let live = true;
    const projection = sheet.projection;
    void (async () => {
      const want = (s: SheetViewSide) =>
        sheetViewWant('placing', sheetProjectedFrame(frame, projection, s), drawn);
      // The quick lines of every side first, then the exact ones side by side: the quick
      // bounds can be off (stray pieces of the polygonal run).
      const next = new Map<SheetViewSide, SheetViewLines>();
      for (const s of SHEET_VIEW_SIDES) {
        const lines = await runner.peek(want(s));
        if (!live) return;
        if (lines) next.set(s, lines);
      }
      setPreviews(new Map(next));
      for (const s of SHEET_VIEW_SIDES) {
        const lines = await runner.peek(want(s), true);
        if (!live) return;
        if (lines) {
          next.set(s, lines);
          setPreviews(new Map(next));
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [active, sheet?.projection, frame, runner, drawn, sheet]);

  const k = useMemo(() => {
    if (!sheet || !parent) return 1;
    const [a, b] = sheetViewScale(sheet, parent);
    return a / b;
  }, [sheet, parent]);
  // The parent's middle on the sheet: its lines' middle, else its origin.
  const middle = useMemo((): [number, number] | undefined => {
    if (!parent) return undefined;
    const b = geometry.get(parent.id)?.bounds;
    if (!b) return [parent.at[0], parent.at[1]];
    return [
      parent.at[0] + (k * (b.min[0] + b.max[0])) / 2,
      parent.at[1] - (k * (b.min[1] + b.max[1])) / 2,
    ];
  }, [parent, geometry, k]);
  const sideAt = useCallback(
    (p: [number, number]): SheetViewSide =>
      middle ? projectedSide(p[0] - middle[0], p[1] - middle[1]) : 'right',
    [middle],
  );
  const nameOf = useCallback(
    (s: SheetViewSide) =>
      frame && sheet
        ? projectedName(s, sheetProjectedFrame(frame, sheet.projection, s).direction)
        : '',
    [frame, sheet],
  );
  const latest = useRef({ side });
  latest.current = { side };

  const placing = useMemo((): SheetPlacing | undefined => {
    if (!active || !sheet || !parent) return undefined;
    const lines = side ? previews.get(side) : undefined;
    return {
      ...(lines && { lines }),
      k,
      locate: (p) => {
        const s = sideAt(p);
        return projectedAt(s, p, [parent.at[0], parent.at[1]], previews.get(s)?.bounds, k);
      },
      onPoint: (p) => {
        const s = sideAt(p);
        if (s !== latest.current.side) setSide(s);
      },
      onPlace: (at, p) => {
        const s = sideAt(p);
        const result = placeProjectedView(stores, sheet, parent.id, s, at, nameOf(s));
        if ('error' in result) notify('error', result.error);
      },
    };
  }, [active, sheet, parent, side, previews, k, sideAt, nameOf, stores, notify]);

  const start = useCallback(
    (id: SheetViewId) => {
      setParentId(id);
      setSide(undefined);
      session.getState().setTool('projectedView');
    },
    [session],
  );

  return {
    parent,
    next: side ? nameOf(side) : undefined,
    placing,
    drawing: parent !== undefined && runner !== undefined && previews.size === 0,
    start,
  };
}
