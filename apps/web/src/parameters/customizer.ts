/**
 * The customizer's numbers as text (P4-07, ADR-0059 §1).
 *
 * A parameter's slider range is stored in the parameter's **base unit** (mm,
 * degrees, plain), while the fields that edit it and the ones that show it
 * speak the document's length unit. Both sides go through the two functions
 * here, so `1 in` becomes `25.4` in the document and shows as `25.40 mm` in an
 * mm document: one place decides how a number reads.
 */
import {
  type Customizer,
  dimOfKind,
  type EvaluateResult,
  type ExtrudoDocument,
  formatQuantity,
  type UnitKind,
} from '@extrudo/core';

export type Settings = ExtrudoDocument['settings'];

/** The editable parts of a `Customizer`: the range and its step. */
export const CUSTOMIZER_FIELDS = ['min', 'max', 'step'] as const;
export type CustomizerField = (typeof CUSTOMIZER_FIELDS)[number];

/**
 * A plain value in the parameter's unit as an expression the field can read
 * back: `12.50 mm`, `30 deg`, `2.00`. Angles say `deg` rather than `°`, which
 * the expression language doesn't take (ADR-0004).
 */
export function valueExpression(unit: UnitKind, value: number, settings: Settings): string {
  // Floating point leaves tails (0.30000000000000004); six decimals is finer than any step.
  const rounded = String(Number(value.toFixed(6)));
  return unit === 'angle' ? `${rounded} deg` : formatQuantity(value, dimOfKind(unit), settings);
}

/** What a range field shows: its value as an expression, or empty when unset. */
export function rangeText(unit: UnitKind, value: number | undefined, settings: Settings): string {
  return value === undefined ? '' : valueExpression(unit, value, settings);
}

/**
 * The customizer settings with `field` set to what `text` evaluates to in the
 * parameter's unit (an empty field takes the range end away). The number is the
 * evaluated base-unit value, so the document holds one unit and the field can
 * be written in any.
 */
export function withRangeField(
  current: Customizer | undefined,
  field: CustomizerField,
  text: string,
  evaluate: (expression: string) => EvaluateResult,
): Customizer {
  const next: Customizer = { ...current };
  if (text.trim() === '') {
    delete next[field];
    return next;
  }
  const result = evaluate(text);
  // An expression that doesn't evaluate is never committed (ExpressionInput).
  if (result.ok) next[field] = Number(result.value.toFixed(6));
  return next;
}

/**
 * The settings without one range field, which is what the details row's
 * "Clear Min/Max/Step" buttons write (P4-07): a parameter whose range runs
 * backwards can only be fixed by taking an end away, and clearing all three
 * leaves the parameter exposed with no slider at all.
 */
export function withoutRangeField(
  current: Customizer | undefined,
  field: CustomizerField,
): Customizer {
  const next: Customizer = { ...current };
  delete next[field];
  return next;
}

/** The slider's step: the row's own, or a hundredth of its range (ADR-0059 §1). */
export function sliderStep(min: number, max: number, step: number | undefined): number {
  if (step !== undefined && step > 0) return step;
  const span = (max - min) / 100;
  return span > 0 ? span : 1;
}

/** A plain number without floating point tails, for an `<input type="range">`. */
export function rangeValue(min: number, max: number, value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * A slider's new value on its step and inside its range. The browser's range
 * input steps its own value already; writing through a command and back
 * through a drag (or a test) goes through this, so the stored expression has no
 * tails like `12.500000000000002 mm`.
 */
export function snapValue(
  min: number,
  max: number,
  step: number | undefined,
  value: number,
): number {
  if (Number.isNaN(value)) return min;
  const size = sliderStep(min, max, step);
  const snapped = min + Math.round((value - min) / size) * size;
  // Six decimals is finer than any range step, and keeps 0.1 + 0.2 out of the document.
  return Number(Math.min(max, Math.max(min, snapped)).toFixed(6));
}
