/**
 * A tool that picks the model on the sheet (P6-24 S3 and S4): the Dimension tool's way of
 * picking, shared by every tool that anchors an item (Leader Note, Centre Mark, Centreline;
 * S5's balloons). Hovering highlights what a click takes (only what the tool's spec
 * `accepts`); each pick asks the kernel for its reference by the curve's or face's name
 * (`Recomputer.reference`, with its fingerprint) and, for a vertex or an outline's side,
 * which end or side it is (one `resolveSheet` of a throwaway item, `pickOf`). Once the picks
 * make an item (`spec.item`), its anchors are resolved once (the candidate) and then either
 * the item follows the pointer in the preview colour until a click places it (`placed:
 * 'click'`: a dimension, a leader note) or it is placed at once (`placed: 'now'`: a centre
 * mark or line). Placing is one undo step with the spec's label, unless the spec takes the
 * placed item over (`onPlaced`: a leader note waits for its text). An item whose anchors
 * the kernel says don't make it (`invalid`) is not placed: the tool says why. The first Esc
 * drops the picks; the shell's Esc ends the tool. Quick lines are never pickable.
 */

import type { LengthUnit } from '@extrudo/core';
import {
  addSheetItem,
  type BodyId,
  type GeomRef,
  newId,
  type Sheet,
  type SheetAnchors,
  type SheetItem,
  type SheetItemId,
  type SheetRefAnchor,
  type SheetViewId,
  sheetViewFrame,
  toSheetView,
  type Vec2,
} from '@extrudo/core';
import type { DisplayItem } from '@extrudo/io';
import { sheetItemStatus } from '@extrudo/sheets';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type SheetHit, type SheetPick, type SheetPickable, toView } from './dimensionTool';
import type { SheetModeStores } from './mode';
import type { SheetAnchorsKernel } from './sheetAnchors';
import { runSheetCommand } from './views';

/** What a pick tool needs of the kernel: `Recomputer.reference` (by name) and `resolveSheet`. */
export interface PickKernel extends SheetAnchorsKernel {
  reference(body: BodyId, kind: 'edge' | 'face', name: string): Promise<GeomRef | undefined>;
}

/** The candidate's and the probes' item IDs: never in a document. */
export const CANDIDATE = '~candidate' as SheetItemId;
const PROBE = '~probe' as SheetItemId;

/** What one pick tool is: which hits it takes, what the picks make, how it is placed. */
export interface PickToolSpec {
  /** Whether a click on `hit` is taken as the next pick after `picks`. */
  accepts(hit: SheetHit, picks: readonly SheetPick[]): boolean;
  /** Whether an outline hit is taken as its face whole (a centre mark's, a centre line's axis). */
  whole?(hit: SheetHit, picks: readonly SheetPick[]): boolean;
  /** At most this many picks (the next click places). */
  most: number;
  /**
   * The item the picks make with its place `at` (view mm; `[0, 0]` for the candidate), or
   * `undefined` while they make none yet.
   */
  item(id: SheetItemId, picks: readonly SheetPick[], at: Vec2): SheetItem | undefined;
  /** `click`: the item follows the pointer until a click places it; `now`: placed when made. */
  placed: 'click' | 'now';
  /** The undo label of a placed item. */
  label: string;
  /** The item following the pointer, sheet mm, and its text when it reads one. */
  preview?(
    sheet: Sheet,
    item: SheetItem,
    anchors: SheetAnchors,
  ): { items: DisplayItem[]; text?: string };
}

export interface PickToolArgs {
  active: boolean;
  sheet: Sheet | undefined;
  units: LengthUnit;
  spec: PickToolSpec;
  /** What the pointer is over at `point` (sheet mm), in view `only` when given. */
  hitAt(point: Vec2, tolerance: number, only?: SheetViewId): SheetHit | undefined;
  /** What on the sheet can be picked: the picked ones are drawn in the accent. */
  pickables: readonly SheetPickable[];
  scaleOf(view: SheetViewId): number;
  kernel: PickKernel | undefined;
  stores: SheetModeStores;
  notify(tone: 'info' | 'error', text: string): void;
  /** The new item's reports, so it is drawn at once (`useSheetAnchors.merge`). */
  merge(reports: SheetAnchors): void;
  /**
   * Takes a placed item over instead of adding it (a leader note: its text comes next),
   * with its reports.
   */
  onPlaced?(item: SheetItem, reports: SheetAnchors): void;
}

export interface PickToolState {
  hover: SheetHit | undefined;
  picks: readonly SheetPick[];
  /** The picked edges and outlines, to draw them in the accent. */
  picked: readonly SheetPickable[];
  /** The item following the pointer: its display items and its text. */
  preview: { items: DisplayItem[]; text?: string } | undefined;
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
 * read back from the kernel. A face hit, or an outline taken `whole`, is the face. `undefined`
 * when the kernel no longer has it.
 */
export async function pickOf(
  kernel: PickKernel,
  sheet: Sheet,
  hit: SheetHit,
  point: Vec2,
  k: number,
  whole = false,
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
  if (pickable.kind === 'face' || (pickable.kind === 'outline' && whole)) {
    return {
      kind: 'face',
      ...base,
      ...(pickable.kind === 'face' && { p: toView(view, k, hit.at ?? point) }),
    };
  }
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

/** Stored places are kept to a thousandth of a mm. */
const round = (n: number) => Math.round(n * 1000) / 1000;

export function usePickTool({
  active,
  sheet,
  units,
  spec,
  hitAt,
  pickables,
  scaleOf,
  kernel,
  stores,
  notify,
  merge,
  onPlaced,
}: PickToolArgs): PickToolState {
  const [hover, setHover] = useState<SheetHit>();
  const [picks, setPicks] = useState<SheetPick[]>([]);
  const [busy, setBusy] = useState(false);
  const [pointer, setPointer] = useState<Vec2>();
  const [candidate, setCandidate] = useState<{ picks: SheetPick[]; anchors: SheetAnchors }>();
  const asking = useRef(0);
  const sheetId = sheet?.id;

  // A new sheet, or the tool ended: start again (a choice on the panel keeps the picks).
  // biome-ignore lint/correctness/useExhaustiveDependencies: those two are the moments.
  useEffect(() => {
    asking.current++;
    setPicks([]);
    setHover(undefined);
    setCandidate(undefined);
    setPointer(undefined);
    setBusy(false);
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

  const add = (item: SheetItem, reports: SheetAnchors) => {
    if (!sheet) return;
    if (onPlaced) {
      onPlaced(item, reports);
      return;
    }
    const error = runSheetCommand(stores, {
      ...addSheetItem({ sheet: sheet.id, item }),
      label: spec.label,
    });
    if (error) {
      notify('error', error);
      return;
    }
    merge(reports);
  };

  // The picks make an item: its anchors, resolved once, for the preview and the new item.
  // Only the picks start a new candidate; the sheet changing under it changes nothing here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the picks are the trigger.
  useEffect(() => {
    setCandidate(undefined);
    const made = spec.item(CANDIDATE, picks, [0, 0]);
    if (!made || !sheet || !kernel) return;
    const n = ++asking.current;
    const probe: Sheet = { ...sheet, items: [made] };
    void kernel.resolveSheet(probe, { quiet: true }).then((anchors) => {
      if (n !== asking.current || !anchors) return;
      const status = sheetItemStatus(probe, made, anchors, { units });
      if (status.state === 'invalid' || status.state === 'detached') {
        notify('info', status.message ?? "That doesn't make one: pick again.");
        setPicks([]);
        return;
      }
      if (spec.placed === 'now') {
        const id = newId<SheetItemId>();
        const item = spec.item(id, picks, [0, 0]);
        const reports = anchors[CANDIDATE];
        if (item) add(item, reports ? { [id]: reports } : {});
        setPicks([]);
        return;
      }
      setCandidate({ picks, anchors });
    });
  }, [picks, kernel]);

  const view = picks[0] ? sheet?.views.find((v) => v.id === picks[0]?.view) : undefined;
  const preview = useMemo(() => {
    if (!sheet || !view || !pointer || candidate?.picks !== picks || !spec.preview) {
      return undefined;
    }
    const k = scaleOf(view.id);
    const at = toView(view, k, pointer);
    const item = spec.item(CANDIDATE, picks, [round(at[0]), round(at[1])]);
    if (!item) return undefined;
    try {
      return spec.preview({ ...sheet, items: [item] }, item, candidate.anchors);
    } catch {
      // The sheet fonts are still loading.
      return undefined;
    }
  }, [sheet, view, pointer, candidate, picks, scaleOf, spec]);

  const onPoint = useCallback(
    (point: Vec2, tolerance: number) => {
      setPointer(point);
      if (picks.length >= spec.most) {
        setHover(undefined);
        return;
      }
      const hit = hitAt(point, tolerance, picks[0]?.view);
      setHover(hit && spec.accepts(hit, picks) ? hit : undefined);
    },
    [picks, hitAt, spec],
  );

  const place = (point: Vec2) => {
    if (!sheet || !view || !candidate || candidate.picks !== picks) return;
    const id = newId<SheetItemId>();
    const at = toView(view, scaleOf(view.id), point);
    const item = spec.item(id, picks, [round(at[0]), round(at[1])]);
    if (!item) return;
    const reports = candidate.anchors[CANDIDATE];
    add(item, reports ? { [id]: reports } : {});
    asking.current++;
    setPicks([]);
    setCandidate(undefined);
  };

  const onClick = (point: Vec2, tolerance: number) => {
    if (busy || !sheet || !kernel) return;
    const near = picks.length < spec.most ? hitAt(point, tolerance, picks[0]?.view) : undefined;
    const hit = near && spec.accepts(near, picks) ? near : undefined;
    const again =
      hit &&
      picks.some(
        (p) => p.key === hit.pickable.key && (p.kind === 'point') === (hit.end !== undefined),
      );
    if (hit && !again) {
      const n = ++asking.current;
      setBusy(true);
      const whole = spec.whole?.(hit, picks) ?? false;
      void pickOf(kernel, sheet, hit, point, scaleOf(hit.pickable.view), whole)
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
    if (spec.placed === 'click') place(point);
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
