/**
 * The `canvas` feature in the kernel (P4-06, ADR-0066 §5, FR-IO-07): a
 * reference image on a plane, which makes no geometry at all. The evaluator
 * does what a construction feature does — read the plane with `planeOf` and
 * report a frame (P3-05, ADR-0040) — and nothing else:
 *
 * - **No shapes**, so `strictLeaks` has nothing to catch here, and the
 *   feature adds no bodies (its body access is only what its plane needs: a
 *   flat face comes from a body, an origin or construction plane from
 *   nothing).
 * - **No bytes**: the image is an attachment the view reads on the UI thread
 *   (`createImageBitmap`, ADR-0061 §3), so nothing of it is in the worker and
 *   nothing of it can end up in an export (a canvas is a reference picture,
 *   not model geometry).
 * - The report's frame is the plane's, by the rule of a sketch on a flat face
 *   (`faceSketchFrame`, ADR-0031), so a canvas follows its plane wherever it
 *   goes.
 *
 * What fails, worded for the user: a plane that is gone (Fix References),
 * nothing flat to lie on, a width of zero or less, and an opacity outside
 * 0.05…1.
 */
import {
  CANVAS_OPACITY_RANGE,
  type CanvasInputs,
  type CanvasReport,
  canvasFeature,
  canvasNumbers,
  canvasSettings,
  type FeatureInputs,
  usesBodies,
} from '@extrudo/core';
import { KernelError } from '../kernel';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';
import { planeOf } from './references';

export const kernelCanvas: KernelFeatureDefinition<CanvasInputs> = {
  ...canvasFeature,
  // A plane is nothing to read; a flat face is a body's, so the bodies before
  // it are needed (as for every construction feature, ADR-0040).
  bodyAccess: (inputs: FeatureInputs) => (usesBodies({ inputs }) ? 'read' : 'none'),
  evaluate: evaluateCanvas,
};

function evaluateCanvas(ctx: EvalContext<CanvasInputs>): FeatureOutput {
  const settings = canvasSettings(ctx.inputs);
  const numbers = canvasNumbers(ctx.inputs, (name) =>
    settings.exprs.has(name) ? ctx.value(name) : undefined,
  );
  // The numbers the kernel refuses rather than draws with: a canvas of no
  // width is nothing, and an opacity of 0 hides it (the view's floor keeps a
  // traceable picture on screen, ADR-0066 §5).
  if (!(numbers.width > 0)) {
    throw new KernelError('A canvas needs a width. Set one, or pick a wider image.');
  }
  if (numbers.opacity < CANVAS_OPACITY_RANGE.min || numbers.opacity > CANVAS_OPACITY_RANGE.max) {
    throw new KernelError(
      `Opacity must be between ${CANVAS_OPACITY_RANGE.min} and ${CANVAS_OPACITY_RANGE.max}.`,
    );
  }
  const plane = planeOf(ctx, settings.plane, 'the plane the canvas lies on');
  const report: CanvasReport = { kind: 'canvas', frame: plane.frame };
  return { data: report, report };
}
