/**
 * The Dimension tool on the sheet (P6-24 S3, plan §4.5, mock-up 3): hovering highlights
 * what a click takes (an edge, a vertex at a line's end, a circle, a cylinder's or cone's
 * outline); each pick asks the kernel for its reference by the curve's name
 * (`Recomputer.reference`, with its fingerprint) and, for a vertex or an outline, which end or
 * side it is (one `resolveSheet` of a throwaway item); once the picks make a dimension, its
 * anchors are resolved once and the dimension follows the pointer in the preview colour with
 * its value; a click places it (one undo step, "Dimension") and the tool waits for the next.
 * The first Esc drops the picks; the shell's Esc ends the tool. Quick lines are never
 * pickable (`sheetPickables`).
 */

import type { LengthUnit } from '@extrudo/core';
import {
  addSheetItem,
  type BodyId,
  type GeomRef,
  newId,
  type Sheet,
  type SheetAnchors,
  type SheetItemId,
  type SheetRefAnchor,
  type SheetViewId,
  sheetViewFrame,
  toSheetView,
  type Vec2,
} from '@extrudo/core';
import type { DisplayItem } from '@extrudo/io';
import { layoutSheetDimension, measureSheetDimension } from '@extrudo/sheets';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type DimensionChoices,
  dimensionItem,
  dimensionOf,
  hitPickable,
  type SheetHit,
  type SheetPick,
  type SheetPickable,
  toView,
} from './dimensionTool';
import type { SheetModeStores } from './mode';
import type { SheetAnchorsKernel } from './sheetAnchors';
import { runSheetCommand } from './views';

/** What the tool needs of the kernel: `Recomputer.reference` (by name) and `resolveSheet`. */
export interface DimensionKernel extends SheetAnchorsKernel {
  reference(body: BodyId, kind: 'edge' | 'face', name: string): Promise<GeomRef | undefined>;
}

/** The candidate's and the probes' item IDs: never in a document. */
const CANDIDATE = '~dimension' as SheetItemId;
const PROBE = '~probe' as SheetItemId;

export interface DimensionToolArgs {
  active: boolean;
  sheet: Sheet | undefined;
  units: LengthUnit;
  pickables: readonly SheetPickable[];
  scaleOf(view: SheetViewId): number;
  kernel: DimensionKernel | undefined;
  stores: SheetModeStores;
  choices: DimensionChoices;
  notify(tone: 'info' | 'error', text: string): void;
  /** The new item's reports, so it is drawn at once (`useSheetAnchors.merge`). */
  merge(reports: SheetAnchors): void;
}

export interface DimensionToolState {
  hover: SheetHit | undefined;
  picks: readonly SheetPick[];
  /** The picked edges and outlines, to draw them in the accent. */
  picked: readonly SheetPickable[];
  /** The dimension following the pointer: its display items and its text. */
  preview: { items: DisplayItem[]; text: string } | undefined;
  /** Where the pointer is, sheet mm. */
  pointer: Vec2 | undefined;
  /** A pick is being read from the kernel. */
  busy: boolean;
  onPoint(point: Vec2, tolerance: number): void;
  onClick(point: Vec2, tolerance: number): void;
  onLeave(): void;
}

/**
 * A pick from what the pointer hit at `point` (sheet mm): the reference by name, and for a
 * vertex which end of its edge, for an outline which side (`sheetSilhouetteSide`'s sign),
 * read back from the kernel. `undefined` when the kernel no longer has it.
 */
export async function pickOf(
  kernel: DimensionKernel,
  sheet: Sheet,
  hit: SheetHit,
  point: Vec2,
  k: number,
): Promise<SheetPick | undefined> {
  const { pickable } = hit;
  const view = sheet.views.find((v) => v.id === pickable.view);
  const frame = sheetViewFrame(sheet, pickable.view);
  if (!view || !frame) return undefined;
  const got = await kernel.reference(
    pickable.body,
    pickable.kind === 'edge' ? 'edge' : 'face',
    pickable.name,
  );
  if (!got?.fingerprint || (got.kind !== 'edge' && got.kind !== 'face')) return undefined;
  const ref = got as SheetRefAnchor['ref'];
  const base = { view: pickable.view, key: pickable.key, ref };
  if (pickable.kind === 'edge' && hit.end === undefined) {
    return { kind: 'edge', ...base, shape: pickable.shape };
  }
  // Which end, or which side: ask the kernel for both and take the one under the pointer.
  const anchors =
    pickable.kind === 'edge'
      ? [
          { ref, at: 'start' as const },
          { ref, at: 'end' as const },
        ]
      : [
          { ref, silhouette: 1 as const },
          { ref, silhouette: -1 as const },
        ];
  const probe: Sheet = {
    ...sheet,
    items: [
      { kind: 'dimension', id: PROBE, view: pickable.view, type: 'linear', anchors, at: [0, 0] },
    ],
  };
  const reports = (await kernel.resolveSheet(probe, { quiet: true }))?.[PROBE];
  const target = hit.end !== undefined ? (pickable.ends[hit.end] as Vec2) : point;
  const here = toView(view, k, target);
  const away = (i: number) => {
    const g = reports?.[i]?.geometry;
    if (!g) return Infinity;
    if (g.type === 'point') return distance(toSheetView(frame, g.point), here);
    if (g.type === 'line' || g.type === 'silhouette') {
      return toLine(here, toSheetView(frame, g.start), toSheetView(frame, g.end));
    }
    return Infinity;
  };
  const [d0, d1] = [away(0), away(1)];
  if (d0 === Infinity && d1 === Infinity) return undefined;
  const first = d0 <= d1;
  if (pickable.kind === 'edge') {
    const g = reports?.[first ? 0 : 1]?.geometry;
    const p = g?.type === 'point' ? toSheetView(frame, g.point) : here;
    return { kind: 'point', ...base, at: first ? 'start' : 'end', p };
  }
  const g = reports?.[first ? 0 : 1]?.geometry;
  const shape =
    g?.type === 'silhouette'
      ? { type: 'line' as const, a: toSheetView(frame, g.start), b: toSheetView(frame, g.end) }
      : pickable.shape.type === 'line'
        ? pickable.shape
        : undefined;
  if (!shape) return undefined;
  return { kind: 'outline', ...base, silhouette: first ? 1 : -1, shape, face: pickable.name };
}

const distance = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function toLine(p: Vec2, a: Vec2, b: Vec2): number {
  const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
  const l2 = d[0] * d[0] + d[1] * d[1];
  const t =
    l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l2));
  return distance(p, [a[0] + t * d[0], a[1] + t * d[1]]);
}

export function useDimensionTool({
  active,
  sheet,
  units,
  pickables,
  scaleOf,
  kernel,
  stores,
  choices,
  notify,
  merge,
}: DimensionToolArgs): DimensionToolState {
  const [hover, setHover] = useState<SheetHit>();
  const [picks, setPicks] = useState<SheetPick[]>([]);
  const [busy, setBusy] = useState(false);
  const [pointer, setPointer] = useState<Vec2>();
  const [candidate, setCandidate] = useState<{ picks: SheetPick[]; anchors: SheetAnchors }>();
  const asking = useRef(0);
  const sheetId = sheet?.id;

  // A new sheet, or the tool ended: start again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: those two are the moments.
  useEffect(() => {
    setPicks([]);
    setHover(undefined);
    setCandidate(undefined);
    setPointer(undefined);
  }, [active, sheetId]);

  // The first Esc drops the picks (the shell's Esc, which ends the tool, is not reached).
  useEffect(() => {
    if (!active || picks.length === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      asking.current++;
      setPicks([]);
      setCandidate(undefined);
      setBusy(false);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [active, picks.length]);

  // The picks make a dimension: its anchors, resolved once, for the preview and the new item.
  useEffect(() => {
    setCandidate(undefined);
    const made = dimensionOf(picks);
    const first = picks[0];
    if (!made || !first || !sheet || !kernel) return;
    const n = ++asking.current;
    const probe: Sheet = {
      ...sheet,
      items: [{ kind: 'dimension', id: CANDIDATE, view: first.view, ...made, at: [0, 0] }],
    };
    void kernel.resolveSheet(probe, { quiet: true }).then((anchors) => {
      if (n === asking.current && anchors) setCandidate({ picks, anchors });
    });
    // Only the picks start a new candidate; the sheet moving under it changes nothing here.
    // biome-ignore lint/correctness/useExhaustiveDependencies: the picks are the trigger.
  }, [picks, kernel]);

  const view = picks[0] ? sheet?.views.find((v) => v.id === picks[0]?.view) : undefined;
  const preview = useMemo(() => {
    if (!sheet || !view || !pointer || candidate?.picks !== picks) return undefined;
    const k = scaleOf(view.id);
    const item = dimensionItem(CANDIDATE, picks, toView(view, k, pointer), choices);
    if (!item) return undefined;
    const withItem: Sheet = { ...sheet, items: [item] };
    try {
      return {
        items: layoutSheetDimension(withItem, item, candidate.anchors, { units }),
        text: measureSheetDimension(withItem, item, candidate.anchors, { units }).text,
      };
    } catch {
      // The sheet fonts are still loading.
      return undefined;
    }
  }, [sheet, view, pointer, candidate, picks, choices, units, scaleOf]);

  const onPoint = useCallback(
    (point: Vec2, tolerance: number) => {
      setPointer(point);
      if (picks.length >= 2) {
        setHover(undefined);
        return;
      }
      setHover(hitPickable(pickables, point, tolerance, picks[0]?.view));
    },
    [picks, pickables],
  );

  const place = (point: Vec2) => {
    if (!sheet || !view || !candidate || candidate.picks !== picks) return;
    const id = newId<SheetItemId>();
    const item = dimensionItem(id, picks, toView(view, scaleOf(view.id), point), choices);
    if (!item) return;
    const error = runSheetCommand(stores, {
      ...addSheetItem({ sheet: sheet.id, item }),
      label: 'Dimension',
    });
    if (error) {
      notify('error', error);
      return;
    }
    const reports = candidate.anchors[CANDIDATE];
    if (reports) merge({ [id]: reports });
    asking.current++;
    setPicks([]);
    setCandidate(undefined);
  };

  const onClick = (point: Vec2, tolerance: number) => {
    if (busy || !sheet || !kernel) return;
    const hit =
      picks.length < 2 ? hitPickable(pickables, point, tolerance, picks[0]?.view) : undefined;
    const again =
      hit &&
      picks.some(
        (p) => p.key === hit.pickable.key && (p.kind === 'point') === (hit.end !== undefined),
      );
    if (hit && !again) {
      const n = ++asking.current;
      setBusy(true);
      void pickOf(kernel, sheet, hit, point, scaleOf(hit.pickable.view))
        .then((pick) => {
          if (n !== asking.current) return;
          if (!pick) {
            notify('info', "That couldn't be picked: the model changed. Try again.");
            return;
          }
          setPicks((was) => [...was, pick]);
        })
        .finally(() => {
          if (n === asking.current) setBusy(false);
        });
      return;
    }
    place(point);
  };

  const picked = useMemo(() => {
    const keys = new Set(picks.filter((p) => p.kind !== 'point').map((p) => p.key));
    return pickables.filter((p) => keys.has(p.key));
  }, [picks, pickables]);

  return {
    hover,
    picks,
    picked,
    preview,
    pointer,
    busy,
    onPoint,
    onClick,
    onLeave: () => setHover(undefined),
  };
}
