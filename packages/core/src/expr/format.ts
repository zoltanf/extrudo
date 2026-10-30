import type { LengthUnit } from '../schema';
import { ANGLE, type Dim, isUnitless, LENGTH, lengthFactor, sameDim } from './units';

/**
 * A value for display: lengths in the document unit, angles in degrees, at
 * the document precision. Trailing zeros are kept so columns line up.
 */
export function formatQuantity(
  value: number,
  dim: Dim,
  settings: { units: LengthUnit; precision: number },
): string {
  const fixed = (v: number) => {
    const text = v.toFixed(settings.precision);
    // Avoid "-0.00".
    return /^-0\.?0*$/.test(text) ? text.slice(1) : text;
  };
  if (sameDim(dim, LENGTH))
    return `${fixed(value / lengthFactor(settings.units))} ${settings.units}`;
  if (sameDim(dim, ANGLE)) return `${fixed(value)}°`;
  if (isUnitless(dim)) return fixed(value);
  if (dim.angle === 0) {
    const power = dim.length === 2 ? '²' : dim.length === 3 ? '³' : `^${dim.length}`;
    return `${fixed(value / lengthFactor(settings.units) ** dim.length)} ${settings.units}${power}`;
  }
  return fixed(value);
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
