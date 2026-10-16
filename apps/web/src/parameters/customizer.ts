/**
 * The customizer's numbers (P4-07, ADR-0059 §1, ADR-0086 §2).
 *
 * A parameter's slider range is stored as expressions in its unit, as typed;
 * a slider's value is written back as a plain value in the document's length
 * unit (`valueExpression`), so one place decides how a number reads.
 */
import {
  type Customizer,
  dimOfKind,
  type ExtrudoDocument,
  formatQuantity,
  type RangeField,
  type UnitKind,
} from '@extrudo/core';

export type Settings = ExtrudoDocument['settings'];

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

/**
 * The customizer settings with `field` set to `text`, kept as typed; an empty
 * field takes that end of the range away (the command trims and drops it).
 */
export function withRangeField(
  current: Customizer | undefined,
  field: RangeField,
  text: string,
): Customizer {
  const next: Customizer = { ...current };
  if (text.trim() === '') delete next[field];
  else next[field] = text;
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
