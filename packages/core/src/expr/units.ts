/**
 * Units and dimensions for expressions (FR-PAR-02).
 *
 * A dimension is a pair of exponents: length and angle. `10 mm` is length¹,
 * `a * b` of two lengths is length², `30 deg` is angle¹, `2` is unitless.
 * Values are held in base units: millimetres for length, degrees for angle.
 */
import type { LengthUnit, UnitKind } from '../schema';

export interface Dim {
  readonly length: number;
  readonly angle: number;
}

export const UNITLESS: Dim = { length: 0, angle: 0 };
export const LENGTH: Dim = { length: 1, angle: 0 };
export const ANGLE: Dim = { length: 0, angle: 1 };

export interface Unit {
  dim: Dim;
  /** Base units (mm or deg) per one of this unit. */
  factor: number;
}

export const UNITS: Readonly<Record<string, Unit>> = {
  mm: { dim: LENGTH, factor: 1 },
  cm: { dim: LENGTH, factor: 10 },
  m: { dim: LENGTH, factor: 1000 },
  in: { dim: LENGTH, factor: 25.4 },
  ft: { dim: LENGTH, factor: 304.8 },
  deg: { dim: ANGLE, factor: 1 },
  rad: { dim: ANGLE, factor: 180 / Math.PI },
};

export const UNIT_NAMES = Object.keys(UNITS);

export function lengthFactor(unit: LengthUnit): number {
  // biome-ignore lint/style/noNonNullAssertion: every LengthUnit is in UNITS.
  return UNITS[unit]!.factor;
}

export function dimOfKind(kind: UnitKind): Dim {
  return kind === 'length' ? LENGTH : kind === 'angle' ? ANGLE : UNITLESS;
}

export function sameDim(a: Dim, b: Dim): boolean {
  return a.length === b.length && a.angle === b.angle;
}

export function isUnitless(d: Dim): boolean {
  return d.length === 0 && d.angle === 0;
}

export function mulDim(a: Dim, b: Dim, sign = 1): Dim {
  return { length: a.length + sign * b.length, angle: a.angle + sign * b.angle };
}

export function scaleDim(d: Dim, k: number): Dim {
  return { length: d.length * k, angle: d.angle * k };
}

const SUPERSCRIPT: Record<string, string> = {
  '-': '⁻',
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
};

/** "a length", "an angle", "a number", "an area (length²)", "length·angle"… for messages. */
export function describeDim(d: Dim): string {
  if (isUnitless(d)) return 'a number';
  if (sameDim(d, LENGTH)) return 'a length';
  if (sameDim(d, ANGLE)) return 'an angle';
  if (d.length === 2 && d.angle === 0) return 'an area (length²)';
  if (d.length === 3 && d.angle === 0) return 'a volume (length³)';
  const part = (name: string, exp: number) =>
    exp === 0
      ? []
      : [
          exp === 1
            ? name
            : name +
              String(exp)
                .split('')
                .map((c) => SUPERSCRIPT[c] ?? c)
                .join(''),
        ];
  return `a value in ${[...part('length', d.length), ...part('angle', d.angle)].join('·')}`;
}
