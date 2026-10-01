/**
 * Measure and inspect (P2-13, ADR-0035): what the kernel says about the
 * selected bodies, faces, edges and vertices. The status bar shows the
 * size of the box around the selection; the Measure panel shows the rest.
 */
import type { BodyId, SelectionItem, SessionStore } from '@extrudo/core';
import {
  type BodyMesh,
  type Box,
  type Inspection,
  type InspectTarget,
  type ItemMeasure,
  itemBox,
  type PairMeasure,
  pairMeasure,
  unionBox,
} from '@extrudo/kernel';
import { useEffect, useMemo, useState } from 'react';
import { readTopology, topologyCount } from '../selection/items';
import type { ModelSelect } from '../viewport/Viewport';
import { closestBetween } from './analytic';

/** The kernel side of measuring (the project's `Recomputer`). */
export interface MeasureKernel {
  inspect(targets: readonly InspectTarget[]): Promise<Inspection>;
}

/** The Measure tool's ID: the session's `activeTool` while it runs. */
export const MEASURE_TOOL = 'measure';

/** The topology items of a selection that exist in `bodies`, in selection order. */
export function inspectTargets(
  selection: readonly SelectionItem[],
  bodies: Readonly<Record<BodyId, BodyMesh>>,
): InspectTarget[] {
  const out: InspectTarget[] = [];
  for (const item of selection) {
    const t = readTopology(item);
    const mesh = t && bodies[t.body];
    if (!t || !mesh) continue;
    if (t.kind !== 'body' && t.index >= topologyCount(mesh, t.kind)) continue;
    out.push({ kind: t.kind, body: t.body, index: t.index });
  }
  return out;
}

export interface InspectionState {
  targets: InspectTarget[];
  /** The kernel's answer for `targets`; undefined until it comes, or with none. */
  inspection?: Inspection;
  /** The kernel couldn't measure them (a body went away, the kernel restarted). */
  error?: string;
}

/**
 * Asks the kernel about the selection's topology whenever it or the bodies
 * change; an answer for an older selection is dropped. Nothing is asked
 * while `enabled` is false or nothing measurable is selected. With `delay`
 * (ms), the question waits until the selection has been still that long, so a
 * box select or quick clicks ask once (the status bar's size, P3-17).
 */
export function useInspection(
  kernel: MeasureKernel | undefined,
  selection: readonly SelectionItem[],
  bodies: Readonly<Record<BodyId, BodyMesh>>,
  enabled = true,
  delay = 0,
): InspectionState {
  const targets = useMemo(() => inspectTargets(selection, bodies), [selection, bodies]);
  const key = targets.map((t) => `${t.kind}:${t.body}:${t.index}`).join(' ');
  const [state, setState] = useState<InspectionState>({ targets: [] });
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `targets`; new bodies ask again.
  useEffect(() => {
    if (!kernel || !enabled || targets.length === 0) {
      setState({ targets: [] });
      return;
    }
    let current = true;
    setState((s) => (s.targets === targets ? s : { targets }));
    const ask = () =>
      kernel.inspect(targets).then(
        (inspection) => {
          if (current) setState({ targets, inspection });
        },
        (error: unknown) => {
          if (current) {
            setState({ targets, error: error instanceof Error ? error.message : String(error) });
          }
        },
      );
    const timer = delay > 0 ? setTimeout(ask, delay) : undefined;
    if (!timer) ask();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [kernel, enabled, key, bodies, delay]);
  return state;
}

/**
 * The view's picking while Measure runs: a click adds to the selection
 * until two things are picked, and the next click starts again with that
 * one (so two clicks measure between two things, no Shift needed).
 * Shift/Ctrl/⌘ toggles as usual; a click on empty space clears.
 */
export function createMeasureSelect(session: SessionStore, base: ModelSelect): ModelSelect {
  return {
    ...base,
    onClick: (item, toggle) => {
      const s = session.getState();
      if (!item) {
        if (!toggle) s.clearSelection();
        return;
      }
      if (toggle) {
        s.select([item], 'toggle');
        return;
      }
      const picked = s.selection.some((i) => i.kind === item.kind && i.id === item.id);
      if (picked) return;
      s.select([item], s.selection.length >= 2 ? 'replace' : 'add');
    },
  };
}

/** A pair whose distance may be unknown: a plane and a face, say, still have an angle (P3-17). */
export type MeasuredPair = Omit<PairMeasure, 'distance' | 'from' | 'to'> &
  Partial<Pick<PairMeasure, 'distance' | 'from' | 'to'>>;

/** What the Measure panel and the status bar show: the kernel's items and the ones measured here. */
export interface Measurement {
  items: ItemMeasure[];
  bbox?: Box;
  pair?: MeasuredPair;
}

export interface MeasureState {
  status: 'empty' | 'pending' | 'ready' | 'error';
  error?: string;
  measurement?: Measurement;
  /** Each measured item's label, in selection order. */
  labels: string[];
  /** How many selected items are measured (kernel targets and items measured here). */
  count: number;
}

/** An item measured on the UI thread (`analyticItem`), with its label. */
export interface LocalItem {
  item: ItemMeasure;
  label: string;
}

/**
 * The selection measured: kernel items (from `kernel`, the `useInspection` answer, labelled by
 * `kernelLabel`) and items measured here (`local`), in selection order (P3-17). Two items get a
 * pair: the kernel's when both are its own, else the closest points where `closestBetween`
 * knows them, and the angle and centre distance where both have them.
 */
export function measureState(
  selection: readonly SelectionItem[],
  kernel: InspectionState,
  local: (item: SelectionItem) => LocalItem | undefined,
  kernelLabel: (target: InspectTarget) => string,
): MeasureState {
  type Slot = { kernel: number } | LocalItem;
  const slots: Slot[] = [];
  const used = new Set<number>();
  for (const item of selection) {
    const t = readTopology(item);
    if (t) {
      const index = kernel.targets.findIndex(
        (k, i) => !used.has(i) && k.kind === t.kind && k.body === t.body && k.index === t.index,
      );
      if (index >= 0) {
        used.add(index);
        slots.push({ kernel: index });
      }
      continue;
    }
    const measured = local(item);
    if (measured) slots.push(measured);
  }
  const labels = slots.map((s) =>
    'kernel' in s ? kernelLabel(kernel.targets[s.kernel] as InspectTarget) : s.label,
  );
  const count = slots.length;
  if (count === 0) return { status: 'empty', labels, count };
  const needsKernel = slots.some((s) => 'kernel' in s);
  if (needsKernel && kernel.error) return { status: 'error', error: kernel.error, labels, count };
  if (needsKernel && !kernel.inspection) return { status: 'pending', labels, count };
  const answer = kernel.inspection;
  const items = slots.map((s) =>
    'kernel' in s ? (answer?.items[s.kernel] as ItemMeasure) : s.item,
  );
  if (slots.every((s) => 'kernel' in s) && answer) {
    // All the kernel's, in the kernel's order (the selection's): its answer as it is.
    return { status: 'ready', measurement: answer, labels, count };
  }
  const measurement: Measurement = { items };
  const bbox = unionBox(items.flatMap((i) => itemBox(i) ?? []));
  if (bbox) measurement.bbox = bbox;
  const [a, b] = items;
  if (count === 2 && a && b) {
    const pair = localPair(a, b);
    if (pair) measurement.pair = pair;
  }
  return { status: 'ready', measurement, labels, count };
}

function localPair(a: ItemMeasure, b: ItemMeasure): MeasuredPair | undefined {
  const closest = closestBetween(a, b);
  if (closest) return pairMeasure(a, b, closest);
  // No distance: what pairMeasure says besides it (a distance no centre distance can equal).
  const {
    distance: _d,
    from: _f,
    to: _t,
    ...rest
  } = pairMeasure(a, b, {
    distance: -1,
    from: [0, 0, 0],
    to: [0, 0, 0],
  });
  return rest.angle !== undefined || rest.centers ? rest : undefined;
}
