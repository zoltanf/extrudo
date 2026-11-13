/**
 * Picking a lost or moved item's geometry again (P6-24 S3 and S4, plan §4.6): while one such
 * anchored item is selected (a dimension, a leader note, a centre mark or line), each of its
 * anchors on the model has a handle at its end (where its geometry was last drawn; by the
 * item's place when none was kept); dragging a handle onto what the item's tool takes in its
 * view picks that instead (one undo step, "Pick again"). A one-anchor dimension takes the
 * type its new pick makes (a circle a diameter, a line its length); two keep theirs when they
 * fit, else the document refuses with why; a note's kind says what it takes (`noteRepick`).
 *
 * Test hooks: `[data-repick-handle]` (the anchor's index), `[data-dimension-hover]` while
 * dragging over something pickable.
 */
import {
  type Sheet,
  type SheetAnchorReport,
  type SheetAnchors,
  type SheetDimensionItem,
  type SheetItem,
  type SheetItemChanges,
  type SheetViewId,
  sheetItemAnchors,
  sheetItemView,
  sheetViewFrame,
  toSheetView,
  updateSheetItem,
  type Vec2,
  type Vec3,
} from '@extrudo/core';
import { type RefObject, useState } from 'react';
import { dimensionOf, pickAnchor, type SheetHit, type SheetPick, toSheet } from './dimensionTool';
import type { SheetModeStores } from './mode';
import { noteRepick, repickAccepts, repickWhole } from './noteTools';
import type { SheetCanvasControl } from './SheetCanvas';
import { type PickKernel, pickOf } from './usePickTool';
import { runSheetCommand } from './views';

const ACCENT = '#e08a1e';

/** Where an anchor's handle goes, view mm: its geometry's end, or `undefined` with none kept. */
export function handlePoint(
  report: SheetAnchorReport | undefined,
  toView: (p: Vec3) => Vec2,
): Vec2 | undefined {
  const g = report?.geometry;
  if (!g) return undefined;
  switch (g.type) {
    case 'point':
      return toView(g.point);
    case 'circle':
      return toView(g.centre);
    default: {
      const [a, b] = [toView(g.start), toView(g.end)];
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    }
  }
}

/**
 * The change that picks anchor `index` again as `pick`'s anchor: a one-anchor dimension
 * takes the type the pick makes alone (and loses a direction it no longer has); `undefined`
 * when the pick makes no dimension alone (a vertex).
 */
export function repickChanges(
  item: SheetDimensionItem,
  index: number,
  pick: SheetPick,
): SheetItemChanges | undefined {
  const anchors = item.anchors.map((a, i) => (i === index ? pickAnchor(pick) : a));
  let type = item.type;
  if (anchors.length === 1) {
    const made = dimensionOf([pick]);
    if (!made) return undefined;
    type = made.type;
  }
  return {
    anchors,
    type,
    ...(type !== 'linear' && item.direction !== undefined && { direction: null }),
  } as SheetItemChanges;
}

/**
 * The change that picks anchor `index` of any anchored item again as `pick`, or why it
 * can't: a dimension's by `repickChanges`, a note's by `noteRepick`.
 */
export function itemRepick(
  item: SheetItem,
  index: number,
  pick: SheetPick,
): SheetItemChanges | string {
  switch (item.kind) {
    case 'dimension':
      return (
        repickChanges(item, index, pick) ??
        'A point alone makes no dimension: drag onto an edge or a circle.'
      );
    case 'leader':
    case 'centreMark':
    case 'centreLine':
      return noteRepick(item, index, pick);
    case 'balloon':
      // A balloon takes any geometry on a body (S5): its number follows the body's row.
      return { anchor: pickAnchor(pick) } as SheetItemChanges;
    default:
      return 'This item has nothing to pick.';
  }
}

/** Where an item's handles go when no geometry was kept, view mm: by its place, or its view's origin. */
function placeOf(item: SheetItem): Vec2 {
  return 'at' in item && item.kind !== 'text' && item.kind !== 'sticky' ? item.at : [0, 0];
}

export function RepickHandles({
  sheet,
  item,
  anchors,
  hitAt,
  scale,
  control,
  kernel,
  stores,
  notify,
}: {
  sheet: Sheet;
  /** A dimension, a leader note, a centre mark or a centre line. */
  item: SheetItem;
  anchors: SheetAnchors | undefined;
  /** What the pointer is over at a sheet point, in the item's view. */
  hitAt(point: Vec2, tolerance: number, only?: SheetViewId): SheetHit | undefined;
  /** The item's view's scale, as a number. */
  scale: number;
  control: RefObject<SheetCanvasControl | undefined>;
  kernel: PickKernel;
  stores: SheetModeStores;
  notify(tone: 'info' | 'error', text: string): void;
}) {
  const [drag, setDrag] = useState<{ index: number; at: Vec2; hit?: SheetHit }>();
  const viewId = sheetItemView(item);
  const view = viewId && sheet.views.find((v) => v.id === viewId);
  const frame = viewId && sheetViewFrame(sheet, viewId);
  if (!view || !frame || !viewId) return null;
  const reports = anchors?.[item.id];
  const handles = sheetItemAnchors(item).flatMap((anchor, index) => {
    if ('free' in anchor) return [];
    const p = handlePoint(reports?.[index], (q) => toSheetView(frame, q));
    // None kept: by the item's place, one beside the other.
    const at = p ? toSheet(view, scale, p) : toSheet(view, scale, placeOf(item));
    return [{ index, at: p ? at : ([at[0] + 6 * (index + 1), at[1]] as Vec2) }];
  });
  const finish = async (index: number, hit: SheetHit | undefined, at: Vec2) => {
    if (!hit) return;
    const pick = await pickOf(kernel, sheet, hit, at, scale, repickWhole(item, hit));
    if (!pick) {
      notify('info', "That couldn't be picked: the model changed. Try again.");
      return;
    }
    const changes = itemRepick(item, index, pick);
    if (typeof changes === 'string') {
      notify('info', changes);
      return;
    }
    const error = runSheetCommand(stores, {
      ...updateSheetItem({ id: item.id, changes }),
      label: 'Pick again',
    });
    if (error) notify('error', error);
  };
  const hover = (p: Vec2) => {
    const hit = control.current ? hitAt(p, control.current.tolerance(), viewId) : undefined;
    return hit && repickAccepts(item, hit) ? hit : undefined;
  };
  return (
    <g>
      {drag?.hit && (
        <path
          data-dimension-hover={drag.hit.pickable.key}
          d={drag.hit.pickable.paths
            .map((path) => path.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(''))
            .join('')}
          fill="none"
          stroke={ACCENT}
          strokeOpacity={0.55}
          strokeWidth={3}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}
      {handles.map(({ index, at }) => {
        const shown = drag?.index === index ? drag.at : at;
        return (
          <circle
            key={index}
            data-repick-handle={index}
            cx={shown[0]}
            cy={shown[1]}
            r={1.4}
            fill="#ffffff"
            stroke={ACCENT}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: 'all', cursor: 'grab' }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              setDrag({ index, at });
            }}
            onPointerMove={(event) => {
              if (drag?.index !== index || !control.current) return;
              const p = control.current.sheetPoint(event.clientX, event.clientY);
              const hit = hover(p);
              setDrag({ index, at: p, ...(hit && { hit }) });
            }}
            onPointerUp={(event) => {
              if (drag?.index !== index) return;
              event.stopPropagation();
              const { hit, at: p } = drag;
              setDrag(undefined);
              void finish(index, hit, p);
            }}
            onPointerCancel={() => setDrag(undefined)}
          />
        );
      })}
    </g>
  );
}
