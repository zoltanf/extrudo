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
