/**
 * The logic of the 3D-print aids (P3-10, ADR-0048), called from `AppShell`:
 *
 * - `usePrintInfo`: the weight, filament and cost estimate of the selected bodies (or every
 *   shown one) from the kernel's exact volumes and areas (`KernelApi.inspect`), with the
 *   walls, infill and price a person prints with in the `print.material` preference.
 * - `useOverhang`: the overhang analysis in the viewport store (view state, like the section),
 *   the angle evaluated in the document's parameters, and the view and counts it gives the
 *   viewport.
 */
import {
  type BodyId,
  type BodyMeta,
  type EvaluateResult,
  ExprError,
  type ExtrudoDocument,
  evaluateParameters,
  formatQuantity,
  type GeomRef,
  type SelectionItem,
  type SessionStore,
} from '@extrudo/core';
import type { BodyMesh, Inspection, InspectTarget } from '@extrudo/kernel';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { initialBodies } from '../export/modelExport';
import type { MeasureKernel } from '../measure/inspection';
import type { Preferences } from '../platform';
import { readTopology } from '../selection/items';
import type { ViewportStore } from '../viewport/store';
import {
  checkPrintField,
  DEFAULT_PRINT,
  type MaterialChoice,
  type PrintEstimate,
  type PrintField,
  presetDensity,
  printEstimate,
  resolveMaterialChoice,
} from './material';
import {
  analyzeOverhang,
  bedLevel,
  DEFAULT_DOWN,
  DEFAULT_OVERHANG_ANGLE,
  type DownId,
  downVector,
  faceDown,
  OVERHANG_RANGE,
  type OverhangReport,
  type OverhangState,
  type OverhangView,
  overhangSummary,
  thresholdOf,
} from './overhang';

/** The tools' IDs: the session's `activeTool` while their panel is open. */
export const PRINT_INFO_TOOL = 'printInfo';
export const OVERHANG_TOOL = 'overhang';

const MATERIAL_PREFERENCE = 'print.material';

// ---------------------------------------------------------------- print info

export interface PrintInfoBody {
  id: BodyId;
  name: string;
  /** mm³. */
  volume: number;
  /** mm², of every face of the body: how much of it a wall's thickness can cover. */
  area: number;
}

export interface PrintInfo {
  /** Estimates come from these bodies: the selected ones, or every shown one. */
  scope: 'selected' | 'shown';
  choice: MaterialChoice;
  setChoice(change: Partial<MaterialChoice>): void;
  /** Evaluates one of the preference's numbers (its unit, and what it may be). */
  evaluate(field: PrintField, expression: string): EvaluateResult;
  /** The density in use, g/cm³; undefined while a custom one doesn't evaluate. */
  density: number | undefined;
  state: 'empty' | 'pending' | 'ready' | 'error';
  bodies: PrintInfoBody[];
  /** Total solid volume, mm³. */
  volume: number | undefined;
  estimate: PrintEstimate | undefined;
  error?: string;
}

export interface PrintInfoOptions {
  kernel: MeasureKernel | undefined;
  preferences: Preferences;
  doc: ExtrudoDocument;
  selection: readonly SelectionItem[];
  /** The model's bodies with their names, and their meshes (a change asks the kernel again). */
  bodyList: readonly { id: BodyId; meta: BodyMeta }[];
  meshes: Readonly<Record<BodyId, BodyMesh>>;
  /** The panel is open. */
  active: boolean;
}

export function usePrintInfo({
  kernel,
  preferences,
  doc,
  selection,
  bodyList,
  meshes,
  active,
}: PrintInfoOptions): PrintInfo {
  const [choice, setChoiceState] = useState<MaterialChoice>(() =>
    resolveMaterialChoice(preferences.get<Partial<MaterialChoice>>(MATERIAL_PREFERENCE, {})),
  );
  const setChoice = useCallback(
    (change: Partial<MaterialChoice>) =>
      setChoiceState((current) => {
        const next = { ...current, ...change };
        preferences.set(MATERIAL_PREFERENCE, next);
        return next;
      }),
    [preferences],
  );

  const evaluation = useMemo(() => evaluateParameters(doc), [doc]);
  // Every field is a plain number of its own unit (a density in g/cm³, a line width in mm):
  // these are the printer's settings, not the drawing's, so the document's units don't change
  // them. A bare number in a length field would take them.
  const evaluate = useCallback(
    (field: PrintField, expression: string): EvaluateResult =>
      checkPrintField(field, expression, evaluation.evaluate(expression, 'unitless')),
    [evaluation],
  );
  /** The number of a field, or its default while an expression that used a deleted parameter fails. */
  const number = useCallback(
    (field: Exclude<PrintField, 'density'>): number => {
      // The wall count is kept as a number, the rest as the expressions they are.
      const expression = field === 'walls' ? String(choice[field]) : choice[field];
      const result = evaluate(field, expression);
      return result.ok ? result.value : DEFAULT_PRINT[field];
    },
    [evaluate, choice],
  );
  const density = useMemo(() => {
    if (choice.material !== 'custom') return presetDensity(choice.material);
    const result = evaluate('density', choice.density);
    return result.ok ? result.value : undefined;
  }, [choice.material, choice.density, evaluate]);

  // The bodies: those selected (a face or an edge picks its body), else every shown one.
  const ids = useMemo(() => initialBodies(bodyList, selection), [bodyList, selection]);
  const scope = useMemo(() => {
    const live = new Set(bodyList.map((b) => b.id));
    return selection.some((item) => {
      const body = readTopology(item)?.body;
      return body !== undefined && live.has(body);
    })
      ? 'selected'
      : 'shown';
  }, [selection, bodyList]);
  const key = ids.join(' ');

  const [measured, setMeasured] = useState<{
    key: string;
    inspection?: Inspection;
    error?: string;
  }>();
  const kernelRef = useRef(kernel);
  kernelRef.current = kernel;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `ids`; new meshes ask again.
  useEffect(() => {
    const k = kernelRef.current;
    if (!active || !k || ids.length === 0) return;
    let current = true;
    const targets: InspectTarget[] = ids.map((body) => ({ kind: 'body', body, index: 0 }));
    k.inspect(targets).then(
      (inspection) => {
        if (current) setMeasured({ key, inspection });
      },
      (error: unknown) => {
        if (current)
          setMeasured({ key, error: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [active, key, meshes, kernel !== undefined]);

  const names = useMemo(() => new Map(bodyList.map((b) => [b.id, b.meta.name])), [bodyList]);
  const fresh = measured?.key === key ? measured : undefined;
  const bodies = useMemo<PrintInfoBody[]>(() => {
    const items = fresh?.inspection?.items ?? [];
    return ids.flatMap((id, i) => {
      const item = items[i];
      return item?.kind === 'body'
        ? [{ id, name: names.get(id) ?? id, volume: item.volume, area: item.area }]
        : [];
    });
  }, [fresh, ids, names]);
  const volume = fresh?.inspection ? bodies.reduce((sum, b) => sum + b.volume, 0) : undefined;
  const settings = {
    density: density ?? 0,
    diameter: choice.diameter,
    walls: number('walls'),
    lineWidth: number('lineWidth'),
    infill: number('infill'),
    price: number('price'),
  };
  const estimate =
    volume !== undefined && density !== undefined ? printEstimate(bodies, settings) : undefined;
  const state: PrintInfo['state'] =
    ids.length === 0 ? 'empty' : fresh?.error ? 'error' : fresh?.inspection ? 'ready' : 'pending';
  return {
    scope,
    choice,
    setChoice,
    evaluate,
    density,
    state,
    bodies,
    volume,
    estimate,
    ...(fresh?.error && { error: fresh.error }),
  };
}

// ------------------------------------------------------------------ overhang

export interface OverhangTool {
  state: OverhangState | undefined;
  /** The angle in degrees: the last one that evaluated, or none yet. */
  degrees: number | undefined;
  /** Evaluates an angle expression, 0…90°. */
  evaluate(expression: string): EvaluateResult;
  /** What the viewport shades with (absent while off, in sketch mode or with no bodies). */
  view: OverhangView | undefined;
  /** The counts over the shown bodies (only while `view` is there). */
  report: OverhangReport | undefined;
  /** `data-overhang`: the setting and the counts. */
  summary: string | undefined;
  /** What "down" is, as the browser row and the panel say it: "-Z", "Face". */
  downLabel: string;
  /** The picked face's direction while it is found; undefined with an axis or a lost face. */
  faceVector: readonly [number, number, number] | undefined;
  /** One flat face is selected in the model: Down can take it. */
  selectedFace: SelectionItem | undefined;
  /** Starts the analysis (default 45°, -Z) if there is none, and switches it on. */
  start(): void;
  setAngle(expression: string): void;
  /** Puts "down" on an axis (and drops a picked face). */
  setDown(down: DownId): void;
  /** Puts "down" on a flat face (its outward normal); false with a curved one. */
  pickFace(item: SelectionItem): Promise<boolean>;
  setOn(on: boolean): void;
  remove(): void;
}

export interface OverhangOptions {
  viewport: ViewportStore;
  doc: ExtrudoDocument;
  bodies: Readonly<Record<BodyId, BodyMesh>>;
  meta: Readonly<Record<BodyId, BodyMeta>>;
  /** Model mode: a sketch is drawn without the analysis. */
  model: boolean;
  /** The selection: a flat face in it can become "down". */
  session: SessionStore;
  /** The kernel side of naming a face: the project's `Recomputer`. */
  kernel: OverhangKernel | undefined;
  notify(tone: 'info' | 'error', text: string): void;
}

/** The kernel side of picking a face. */
export interface OverhangKernel {
  reference(body: BodyId, kind: 'face', index: number): Promise<GeomRef | undefined>;
}

export function useOverhang({
  viewport,
  doc,
  bodies,
  meta,
  model,
  session,
  kernel,
  notify,
}: OverhangOptions): OverhangTool {
  const state = useStore(viewport, (s) => s.overhang);
  const selection = useStore(session, (s) => s.selection);
  const selectedFace = useMemo(() => {
    const [only] = selection;
    return selection.length === 1 && only && readTopology(only)?.kind === 'face' ? only : undefined;
  }, [selection]);
  const evaluation = useMemo(() => evaluateParameters(doc), [doc]);
  const settings = doc.settings;
  const evaluate = useCallback(
    (expression: string): EvaluateResult => {
      const result = evaluation.evaluate(expression, 'angle');
      if (!result.ok) return result;
      if (result.value >= OVERHANG_RANGE.min && result.value <= OVERHANG_RANGE.max) return result;
      const text = (v: number) => formatQuantity(v, result.dim, { ...settings, precision: 0 });
      return {
        ok: false,
        error: new ExprError(
          `Between ${text(OVERHANG_RANGE.min)} and ${text(OVERHANG_RANGE.max)}.`,
          {
            start: 0,
            end: expression.length,
          },
        ),
      };
    },
    [evaluation, settings],
  );

  // An angle that stopped evaluating (a parameter it used was deleted) keeps its last value.
  const lastAngle = useRef<number>(undefined);
  const result = state ? evaluate(state.angle) : undefined;
  if (!state) lastAngle.current = undefined;
  else if (result?.ok) lastAngle.current = result.value;
  const degrees = lastAngle.current;

  const shown = useMemo(
    () =>
      (Object.entries(bodies) as [BodyId, BodyMesh][])
        .filter(([id]) => meta[id]?.visible ?? true)
        .map(([id, mesh]) => ({ id, mesh })),
    [bodies, meta],
  );
  const on = state?.on ?? false;
  const down = state?.down ?? DEFAULT_DOWN;
  const face = state?.face;
  // A picked face gives the direction (its outward normal) and the bed (its plane); the face
  // follows the model, so this is worked out from the meshes as they are now.
  const picked = useMemo(() => (face ? faceDown(face, bodies) : undefined), [face, bodies]);
  const view = useMemo<OverhangView | undefined>(() => {
    if (!model || !on || degrees === undefined || shown.length === 0) return undefined;
    if (face) {
      return picked && { down: picked.down, threshold: thresholdOf(degrees), bed: picked.bed };
    }
    const vector = downVector(down);
    return {
      down: vector,
      threshold: thresholdOf(degrees),
      bed: bedLevel(
        shown.map((s) => s.mesh),
        vector,
      ),
    };
  }, [model, on, degrees, down, face, picked, shown]);
  const report = useMemo(() => (view ? analyzeOverhang(shown, view) : undefined), [view, shown]);
  const summary = state ? overhangSummary(state, degrees, report, picked?.down) : undefined;

  const pickFace = useCallback(
    async (item: SelectionItem) => {
      const topology = readTopology(item);
      if (topology?.kind !== 'face') return false;
      const ref = await kernel?.reference(topology.body, 'face', topology.index);
      if (ref?.fingerprint?.type === 'plane') {
        const current = viewport.getState().overhang;
        viewport.getState().setOverhang({
          angle: current?.angle ?? DEFAULT_OVERHANG_ANGLE,
          down: current?.down ?? DEFAULT_DOWN,
          face: ref,
          on: true,
        });
        return true;
      }
      notify(
        'error',
        ref
          ? 'Overhangs need a flat face to go down: that face is curved.'
          : "Can't use that face yet: the model is still computing.",
      );
      return false;
    },
    [kernel, viewport, notify],
  );

  return {
    state,
    degrees,
    evaluate,
    view,
    report,
    summary,
    start: () => {
      const current = viewport.getState().overhang;
      viewport
        .getState()
        .setOverhang(
          current
            ? { ...current, on: true }
            : { angle: DEFAULT_OVERHANG_ANGLE, down: DEFAULT_DOWN, on: true },
        );
    },
    setAngle: (angle) => viewport.getState().updateOverhang({ angle }),
    setDown: (next) => {
      const current = viewport.getState().overhang;
      if (!current) return;
      // An axis replaces a picked face.
      const { face: _dropped, ...rest } = current;
      viewport.getState().setOverhang({ ...rest, down: next });
    },
    pickFace,
    downLabel: face ? 'Face' : down.toUpperCase(),
    faceVector: picked?.down,
    selectedFace,
    setOn: (value) => viewport.getState().updateOverhang({ on: value }),
    remove: () => viewport.getState().setOverhang(undefined),
  };
}
