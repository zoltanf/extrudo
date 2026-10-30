import type { LengthUnit } from '../schema';
import { ANGLE, type Dim, isUnitless, LENGTH, lengthFactor, sameDim } from './units';

/**
 * A value for display: lengths in the document unit, angles in degrees, at
 * the document precision. Trailing zeros are kept so columns line up. With
 * `units: "in"` and `fractions: true`, a length shows as the nearest binary
 * fraction (`1 1/2 in`, `3/8 in`); other units and other dimensions are
 * unchanged (ADR-0113 §3).
 */
export function formatQuantity(
  value: number,
  dim: Dim,
  settings: { units: LengthUnit; precision: number; fractions?: boolean },
): string {
  if (sameDim(dim, LENGTH)) return `${formatLength(value, settings)} ${settings.units}`;
  const fixed = (v: number) => {
    const text = v.toFixed(settings.precision);
    // Avoid "-0.00".
    return /^-0\.?0*$/.test(text) ? text.slice(1) : text;
  };
  if (sameDim(dim, ANGLE)) return `${fixed(value)}°`;
  if (isUnitless(dim)) return fixed(value);
  if (dim.angle === 0) {
    const power = dim.length === 2 ? '²' : dim.length === 3 ? '³' : `^${dim.length}`;
    return `${fixed(value / lengthFactor(settings.units) ** dim.length)} ${settings.units}${power}`;
  }
  return fixed(value);
}

/**
 * A length as text without its unit, so several can share one (`triple`'s
 * "40.00, 80.00, 60.00 mm"). An inch design's `fractions` shows the fraction
 * form (`1 1/2`), which has a space in it: never split a formatted length.
 */
export function formatLength(
  value: number,
  settings: { units: LengthUnit; precision: number; fractions?: boolean },
): string {
  if (settings.fractions && settings.units === 'in') {
    return formatInches(value, settings.precision);
  }
  const text = (value / lengthFactor(settings.units)).toFixed(settings.precision);
  // Avoid "-0.00".
  return /^-0\.?0*$/.test(text) ? text.slice(1) : text;
}

/** The denominator the precision setting allows: `2^(precision + 2)`, capped at 64. */
export function fractionDenominator(precision: number): number {
  return Math.min(64, 2 ** (precision + 2));
}

/** An inch value as a whole number and a reduced fraction, without the unit. */
export function formatInches(value: number, precision: number): string {
  const denominator = fractionDenominator(precision);
  const numerator = Math.round((value / lengthFactor('in')) * denominator);
  const whole = Math.trunc(numerator / denominator);
  const remainder = numerator - whole * denominator;
  if (remainder === 0) return `${whole}`;
  const divisor = gcd(Math.abs(remainder), denominator);
  const num = Math.abs(remainder) / divisor;
  const den = denominator / divisor;
  if (whole === 0) return `${remainder < 0 ? '-' : ''}${num}/${den}`;
  return `${whole} ${num}/${den}`;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** The decimals a tool-written length keeps in each unit: about a micrometre. */
const EXPR_DECIMALS: Record<LengthUnit, number> = { mm: 3, cm: 4, m: 6, in: 4 };

/**
 * A length in mm as an expression a tool writes (a clicked point, a face
 * centre, a proposed size), in the document unit: "12.5 mm", "0.4921 in".
 */
export function lengthExpr(mm: number, unit: LengthUnit, decimals = EXPR_DECIMALS[unit]): string {
  const scale = 10 ** decimals;
  const rounded = Math.round((mm / lengthFactor(unit)) * scale) / scale;
  return `${Object.is(rounded, -0) ? 0 : rounded} ${unit}`;
}
