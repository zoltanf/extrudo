/**
 * The clearance check behind the Clearance section (P6-05 J3, ADR-0081 §4): the check's
 * setting in the viewport store (view state: the joint, the minimum gap, whether the marks
 * show), and the run itself here — asked of the kernel worker on demand, with its progress,
 * its result, and `stale` once the design changes after it. A newer run, `cancel`, closing
 * the panel or the next recompute stops a running one (the worker cancels on recompute).
 */
import {
  type BodyId,
  type ComponentId,
  type EvaluateResult,
  ExprError,
  type ExtrudoDocument,
  evaluateParameters,
  type Joint,
  type JointId,
} from '@extrudo/core';
import type { CheckProgress, JointCheck, JointCheckRequest } from '@extrudo/kernel';
import { isCheckCancelled } from '@extrudo/kernel';
import { useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { ViewportStore } from '../viewport/store';
import {
  type ClearanceLine,
  type ClearanceStatus,
  checkBodies,
  checkRange,
  clearanceLines,
  clearanceSummary,
  defaultMinGap,
  type JointCheckState,
} from './clearance';

/** What the check needs of the project's kernel (its `Recomputer`). */
export interface JointCheckKernel {
  checkJoint(request: JointCheckRequest, onProgress?: CheckProgress): Promise<JointCheck>;
  cancelCheck(): void;
}

/** The last run, and what it was asked. */
interface Run {
  status: 'idle' | 'pending' | 'ready' | 'error';
  joint?: JointId;
  /** The document and minimum it ran on: any change after it makes the result stale. */
  doc?: ExtrudoDocument;
  min?: string;
  range?: { min: number; max: number };
  minGap?: number;
  result?: JointCheck;
  progress?: { done: number; of: number };
  error?: string;
}

export interface JointCheckDeps {
  viewport: ViewportStore;
  doc(): ExtrudoDocument;
  /** The live body IDs of the last finished recompute. */
  bodies(): readonly BodyId[];
  componentOf(id: BodyId): ComponentId | undefined;
  kernel: JointCheckKernel | undefined;
}

export interface JointCheckController {
  run: StoreApi<Run>;
  /**
   * Makes `joint` the one checked, with `min` or the default minimum gap (the minimum kept when
   * it is the same joint and none is given). Doesn't run it.
   */
  open(joint: JointId, min?: string): void;
  /** Runs the check as set; a running one is stopped first. */
  start(): Promise<void>;
  cancel(): void;
  setMin(expression: string): void;
  setOn(on: boolean): void;
  remove(): void;
  /** A minimum gap: a length of 0 or more. */
  evaluate(expression: string): EvaluateResult;
  /** The run's status as the design stands: `stale` after a change. */
  status(doc: ExtrudoDocument, state: JointCheckState | undefined): ClearanceStatus;
}

export function createJointCheck(deps: JointCheckDeps): JointCheckController {
  const run = createStore<Run>(() => ({ status: 'idle' }));
  let sequence = 0;

  const evaluate = (expression: string): EvaluateResult => {
    const result = evaluateParameters(deps.doc()).evaluate(expression, 'length');
    if (!result.ok || result.value >= 0) return result;
    return {
      ok: false,
      error: new ExprError("A minimum gap can't be less than 0.", {
        start: 0,
        end: expression.length,
      }),
    };
  };

  const stop = () => {
    if (run.getState().status !== 'pending') return;
    sequence++;
    deps.kernel?.cancelCheck();
    run.setState({ status: 'idle', progress: undefined });
  };

  return {
    run,
    open(joint, min) {
      const state = deps.viewport.getState().jointCheck;
      if (state?.joint === joint) {
        if (min !== undefined) deps.viewport.getState().updateJointCheck({ min });
        return;
      }
      stop();
      deps.viewport
        .getState()
        .setJointCheck({ joint, min: min ?? defaultMinGap(deps.doc()), on: true });
      run.setState({ status: 'idle' }, true);
    },
    async start() {
      const state = deps.viewport.getState().jointCheck;
      const doc = deps.doc();
      const joint = doc.joints?.find((j) => j.id === state?.joint);
      if (!state || !joint) return;
      stop();
      const id = ++sequence;
      const fail = (error: string) =>
        run.setState({ status: 'error', error, joint: joint.id, doc, min: state.min }, true);
      if (!deps.kernel) return fail("The kernel isn't running.");
      const min = evaluate(state.min);
      if (!min.ok) return fail(`The minimum gap doesn't evaluate: ${min.error.message}`);
      const evaluation = evaluateParameters(doc);
      const range = checkRange(joint, (input) => {
        const result = evaluation.evaluate(input.expr, input.unit ?? 'length');
        if (!result.ok) throw result.error;
        return result.value;
      });
      if ('error' in range) return fail(range.error);
      const { moving, others } = checkBodies(doc, joint, deps.bodies(), deps.componentOf);
      if (moving.length === 0) return fail(`${joint.name} moves no body.`);
      run.setState(
        { status: 'pending', joint: joint.id, doc, min: state.min, range, minGap: min.value },
        true,
      );
      try {
        const result = await deps.kernel.checkJoint(
          { joint, moving, others, range, minGap: min.value },
          (done, of) => {
            if (id === sequence) run.setState({ progress: { done, of } });
          },
        );
        if (id !== sequence) return;
        run.setState({ status: 'ready', result, progress: undefined });
      } catch (error) {
        if (id !== sequence) return;
        if (isCheckCancelled(error)) {
          // A recompute stopped it: the design changed, so there is nothing to show.
          run.setState({ status: 'idle', progress: undefined });
          return;
        }
        run.setState({
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
          progress: undefined,
        });
      }
    },
    cancel: stop,
    setMin(expression) {
      deps.viewport.getState().updateJointCheck({ min: expression });
    },
    setOn(on) {
      deps.viewport.getState().updateJointCheck({ on });
    },
    remove() {
      stop();
      deps.viewport.getState().setJointCheck(undefined);
      run.setState({ status: 'idle' }, true);
    },
    evaluate,
    status(doc, state) {
      const r = run.getState();
      if (r.status !== 'ready') return r.status;
      if (r.doc !== doc || r.min !== state?.min || r.joint !== state?.joint) return 'stale';
      return 'ready';
    },
  };
}

export interface JointCheckTool {
  controller: JointCheckController;
  state: JointCheckState | undefined;
  joint: Joint | undefined;
  status: ClearanceStatus;
  result: JointCheck | undefined;
  progress: { done: number; of: number } | undefined;
  error: string | undefined;
  /** The result's lines (ADR-0081 §4's sentences), while there is a result. */
  lines: ClearanceLine[];
  /** `data-joint-check`, while there is a check. */
  summary: string | undefined;
}

/**
 * The check for the shell: one controller per project, the lines and the summary for the
 * design as it stands. `open` is the panel: closing it stops a running check.
 */
export function useJointCheck(deps: JointCheckDeps & { open: boolean }): JointCheckTool {
  const { viewport, open } = deps;
  // The controller reads the latest props through this.
  const latest = useRef(deps);
  latest.current = deps;
  const controller = useMemo(
    () =>
      createJointCheck({
        viewport,
        doc: () => latest.current.doc(),
        bodies: () => latest.current.bodies(),
        componentOf: (id) => latest.current.componentOf(id),
        get kernel() {
          return latest.current.kernel;
        },
      }),
    [viewport],
  );
  const state = useStore(viewport, (s) => s.jointCheck);
  const run = useStore(controller.run);
  const doc = deps.doc();
  useEffect(() => {
    if (!open) controller.cancel();
  }, [open, controller]);
  const joint = doc.joints?.find((j) => j.id === state?.joint);
  const status = controller.status(doc, state);
  const result = run.joint === state?.joint ? run.result : undefined;
  const lines =
    result && run.range && run.minGap !== undefined && joint
      ? clearanceLines(joint, run.range, run.minGap, result)
      : [];
  const minResult = state ? controller.evaluate(state.min) : undefined;
  const minGap = minResult?.ok ? minResult.value : undefined;
  const summary =
    state && joint ? clearanceSummary(joint.name, run.minGap ?? minGap, status, result) : undefined;
  return {
    controller,
    state,
    joint,
    status,
    result,
    progress: run.status === 'pending' ? run.progress : undefined,
    error: run.status === 'error' ? run.error : undefined,
    lines,
    summary,
  };
}
