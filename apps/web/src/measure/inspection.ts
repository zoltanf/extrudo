/**
 * Measure and inspect (P2-13, ADR-0035): what the kernel says about the
 * selected bodies, faces, edges and vertices. The status bar shows the
 * size of the box around the selection; the Measure panel shows the rest.
 */
import type { BodyId, SelectionItem, SessionStore } from '@extrudo/core';
import type { BodyMesh, Inspection, InspectTarget } from '@extrudo/kernel';
import { useEffect, useMemo, useState } from 'react';
import { readTopology, topologyCount } from '../selection/items';
import type { ModelSelect } from '../viewport/Viewport';

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
 * while `enabled` is false or nothing measurable is selected.
 */
export function useInspection(
  kernel: MeasureKernel | undefined,
  selection: readonly SelectionItem[],
  bodies: Readonly<Record<BodyId, BodyMesh>>,
  enabled = true,
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
    return () => {
      current = false;
    };
  }, [kernel, enabled, key, bodies]);
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
