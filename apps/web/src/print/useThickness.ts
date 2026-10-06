/**
 * The wall-thickness check behind the panel (P5-06, ADR-0072, FR-3DP-07): the analysis in the
 * viewport store (view state, like the section and the overhang's), the minimum evaluated in
 * the document's parameters, and the counts, shading flags and thinnest spot it gives the view.
 *
 * The rays are cast once per body mesh and cached (`print/thickness.ts`); a changed minimum
 * only re-classifies. Bodies with more than `SLICE_AT` triangles in total are measured in
 * slices across animation frames (the panel shows "Measuring…"), so the UI never blocks for
 * more than about 50 ms. The BVH is the picking one (`selection/pick.ts`), built once per
 * mesh — which is also why the measurement module is loaded on demand: three-mesh-bvh belongs
 * with the viewport's chunk, not with the home screen's (ADR-0037).
 */
import {
  type BodyId,
  type BodyMeta,
  type EvaluateResult,
  ExprError,
  type ExtrudoDocument,
  evaluateParameters,
  formatQuantity,
  LENGTH,
} from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { Preferences } from '../platform';
import type { ViewportStore } from '../viewport/store';
import { DEFAULT_PRINT, type MaterialChoice, resolveMaterialChoice } from './material';
import {
  cachedThickness,
  defaultMinimum,
  measureThickness,
  measureTriangles,
  rememberThickness,
  type ThicknessReport,
  type ThicknessState,
  type ThinSpot,
  thicknessReport,
  thicknessSummary,
  thinAttribute,
  triangleCount,
} from './thickness';

/** The session's `activeTool` while the panel is open (the tool and command ID too). */
export const THICKNESS_TOOL = 'wallThickness';

/**
 * Above this many triangles in total the rays are cast in slices across frames (the panel
 * shows "Measuring…"). ADR-0072 §1 says 400,000; measured at ~300,000 rays a second (the
 * ADR's Results) a synchronous pass of that size would block the UI for over a second, so
 * the slices start where one still fits the ADR's 50 ms — about 15,000 rays. Smaller meshes,
 * which is every B-rep body's display mesh, measure in one pass while rendering.
 */
export const SLICE_AT = 15_000;

/** A slice of measurement never blocks the UI for more than about this (ms). */
const SLICE_MS = 40;

/** Triangles per step inside a slice: the granularity the time box is checked at. */
const STEP = 2000;

const MATERIAL_PREFERENCE = 'print.material';

export interface ThicknessTool {
  state: ThicknessState | undefined;
  /** The minimum in mm: the last one that evaluated, or none yet. */
  min: number | undefined;
  /** Evaluates a length expression above 0. */
  evaluate(expression: string): EvaluateResult;
  /** The counts over the shown bodies (only while the shading is on and measured). */
  report: ThicknessReport | undefined;
  /** Big meshes are still being measured. */
  pending: boolean;
  /** `data-thickness`: the setting and the counts. */
  summary: string | undefined;
  /** The thinnest spot, where the marker's leader starts (only while something is thin). */
  spot: ThinSpot | undefined;
  /** Per body, the per-node thin flags for the shading (absent while the shading is off). */
  shading: Record<BodyId, Float32Array> | undefined;
  /** Starts the analysis (two line widths of the print preference) if there is none, on. */
  start(): void;
  setMin(expression: string): void;
  setOn(on: boolean): void;
  remove(): void;
}

export interface ThicknessOptions {
  viewport: ViewportStore;
  doc: ExtrudoDocument;
  bodies: Readonly<Record<BodyId, BodyMesh>>;
  meta: Readonly<Record<BodyId, BodyMeta>>;
  /** Model mode: a sketch is drawn without the analysis. */
  model: boolean;
  /** The `print.material` preference: the default minimum is two of its line widths. */
  preferences: Preferences;
}

export function useThickness({
  viewport,
  doc,
  bodies,
  meta,
  model,
  preferences,
}: ThicknessOptions): ThicknessTool {
  const state = useStore(viewport, (s) => s.thickness);
  const evaluation = useMemo(() => evaluateParameters(doc), [doc]);
  const evaluate = useCallback(
    (expression: string): EvaluateResult => {
      const result = evaluation.evaluate(expression, 'length');
      if (!result.ok) return result;
      if (result.value > 0) return result;
      return {
        ok: false,
        error: new ExprError('A minimum wall thickness is more than 0.', {
          start: 0,
          end: expression.length,
        }),
      };
    },
    [evaluation],
  );

  // A minimum that stopped evaluating (a parameter it used was deleted) keeps its last value.
  const lastMin = useRef<number>(undefined);
  const result = state ? evaluate(state.min) : undefined;
  if (!state) lastMin.current = undefined;
  else if (result?.ok) lastMin.current = result.value;
  const min = lastMin.current;

  const shown = useMemo(
    () =>
      (Object.entries(bodies) as [BodyId, BodyMesh][])
        .filter(([id]) => meta[id]?.visible ?? true)
        .map(([id, mesh]) => ({ id, mesh })),
    [bodies, meta],
  );
  const on = (model && state?.on) ?? false;

  // The measured thickness per body: whatever the cache has for the meshes shown now.
  // `measured` counts finished measurement runs — it stands for the cache growing.
  const [measured, setMeasured] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `measured` stands for the cache.
  const values = useMemo(() => {
    const out: Record<BodyId, Float32Array> = {};
    let complete = true;
    for (const { id, mesh } of shown) {
      const found = cachedThickness(mesh);
      if (!found) complete = false;
      else out[id] = found;
    }
    return complete ? out : undefined;
  }, [shown, measured]);
  const pending = on && shown.length > 0 && values === undefined;

  const shownRef = useRef(shown);
  shownRef.current = shown;
  const bvhOf = useRef<((mesh: BodyMesh) => import('three-mesh-bvh').MeshBVH) | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!on || shown.length === 0) return;
    let current = true;
    void (async () => {
      if (!bvhOf.current) {
        // The picking BVHs, already loaded with the viewport: one BVH per mesh (ADR-0026).
        const pick = await import('../selection/pick');
        if (!current) return;
        bvhOf.current = pick.meshBvh;
      }
      const bvh = bvhOf.current;
      // Meshes measured before (a recompute that left a body alone) are in the cache already.
      const items = shownRef.current.filter(({ mesh }) => !cachedThickness(mesh));
      const total = items.reduce((n, s) => n + triangleCount(s.mesh), 0);
      if (items.length === 0) return;
      if (total <= SLICE_AT) {
        for (const { mesh } of items) measureThickness(mesh, bvh(mesh));
        if (current) setMeasured((n) => n + 1);
        return;
      }
      // Sliced across animation frames: one body's chunk at a time, at most SLICE_MS a frame.
      const jobs = items.map(({ id, mesh }) => ({
        id,
        mesh,
        values: new Float32Array(triangleCount(mesh)).fill(Number.NaN),
      }));
      let job = 0;
      let from = 0;
      const step = () => {
        if (!current) return;
        const started = performance.now();
        while (job < jobs.length) {
          const work = jobs[job] as (typeof jobs)[number];
          while (from < work.values.length && performance.now() - started < SLICE_MS) {
            const count = Math.min(STEP, work.values.length - from);
            measureTriangles(work.mesh, bvh(work.mesh), work.values, from, count);
            from += count;
          }
          if (from < work.values.length) {
            requestAnimationFrame(step);
            return;
          }
          rememberThickness(work.mesh, work.values);
          job++;
          from = 0;
          setMeasured((n) => n + 1);
          if (job < jobs.length && performance.now() - started >= SLICE_MS) {
            requestAnimationFrame(step);
            return;
          }
        }
      };
      step();
    })();
    return () => {
      current = false;
    };
  }, [on, shown]);

  const report = useMemo(
    () =>
      values && min !== undefined
        ? thicknessReport(
            shown.map(({ id, mesh }) => ({ id, mesh, values: values[id] as Float32Array })),
            min,
          )
        : undefined,
    [values, min, shown],
  );
  const shading = useMemo(() => {
    if (!on || !values || min === undefined) return undefined;
    const out: Record<BodyId, Float32Array> = {};
    for (const { id, mesh } of shown) {
      const found = values[id];
      if (found) out[id] = thinAttribute(mesh, found, min);
    }
    return out;
  }, [on, values, min, shown]);
  const spot = useMemo(() => (report && report.thin > 0 ? report.thinnest : undefined), [report]);
  const summary = state ? thicknessSummary(state, min, report, pending) : undefined;

  /** Two line widths of the `print.material` preference (0.9 mm at the default 0.45). */
  const defaultLineWidth = () => {
    const choice = resolveMaterialChoice(
      preferences.get<Partial<MaterialChoice>>(MATERIAL_PREFERENCE, {}),
    );
    const result = evaluation.evaluate(choice.lineWidth, 'unitless');
    return result.ok ? result.value : DEFAULT_PRINT.lineWidth;
  };
  const start = () => {
    const current = viewport.getState().thickness;
    if (current) {
      viewport.getState().setThickness({ ...current, on: true });
      return;
    }
    viewport.getState().setThickness({ min: defaultMinimum(defaultLineWidth()), on: true });
  };

  return {
    state,
    min,
    evaluate,
    report,
    pending,
    summary,
    spot,
    shading,
    start,
    setMin: (expression) => viewport.getState().updateThickness({ min: expression }),
    setOn: (value) => viewport.getState().updateThickness({ on: value }),
    remove: () => viewport.getState().setThickness(undefined),
  };
}

/**
 * The panel's result lines (ADR-0072 §3): "Thinnest wall: 0.80 mm" and "Thin area: 226 mm² in
 * 2 bodies", or "No wall is thinner than 0.9 mm." when nothing is thin.
 */
export function thicknessLines(
  report: ThicknessReport,
  min: number | undefined,
  settings: ExtrudoDocument['settings'],
): string[] {
  const text = (value: number, precision: number) =>
    formatQuantity(value, LENGTH, { ...settings, precision });
  if (report.thin === 0 || !report.thinnest) {
    return min === undefined ? [] : [`No wall is thinner than ${text(min, 1)}.`];
  }
  return [
    `Thinnest wall: ${text(report.thinnest.value, 2)}`,
    `Thin area: ${Math.round(report.area)} mm² in ${report.thinBodies} ${
      report.thinBodies === 1 ? 'body' : 'bodies'
    }`,
  ];
}
