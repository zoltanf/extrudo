/**
 * Tool defaults in the document's unit (ADR-0113 §1). Every dialog field's
 * default is written in mm; in a design in another unit the dialog opens
 * with the same size in that unit. Inches use a table of the sizes a US
 * user would pick (10 mm → 3/8 in, not 0.3937 in); cm and m convert exactly.
 */
import { type LengthUnit, lengthFactor } from '@extrudo/core';

/** The inch size for each mm default a tool uses, as a decimal the parser takes today. */
const INCH_DEFAULTS: Record<string, string> = {
  '0': '0 in',
  '0.01': '0.001 in',
  '1': '0.03125 in', // 1/32
  '2': '0.0625 in', // 1/16
  '4': '0.125 in', // 1/8
  '5': '0.1875 in', // 3/16
  '10': '0.375 in', // 3/8
  '20': '0.75 in', // 3/4
  '40': '1.5 in',
};

const MM_DEFAULT = /^(\d+(?:\.\d+)?) mm$/;

/** `expr` for a design in `unit`: a `<number> mm` default converted, anything else as is. */
export function defaultInUnit(expr: string, unit: LengthUnit): string {
  const match = MM_DEFAULT.exec(expr);
  if (!match || unit === 'mm') return expr;
  const mm = match[1] ?? '0';
  if (unit === 'in') return INCH_DEFAULTS[mm] ?? `${trim(Number(mm) / lengthFactor('in'))} in`;
  return `${trim(Number(mm) / lengthFactor(unit))} ${unit}`;
}

/** A number without binary-float noise (`0.1`, not `0.10000000000000002`). */
function trim(n: number): string {
  return String(Number(n.toPrecision(12)));
}
