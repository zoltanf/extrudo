/**
 * Reading a unit off an expression (ADR-0004): `d.parameter('tilt', '45 deg')`
 * stores a parameter that measures an angle, so a later input that takes an
 * angle can use it.
 *
 * The expression language's own default is a length (a plain number is a length
 * in the document's unit), so anything without an angle unit is a length. Only
 * an explicit `unit` in the options overrides this.
 */
import type { UnitKind } from '@extrudo/core';
import { ANGLE, UNITS } from '@extrudo/core';

/** What an expression's own unit says, or `length` for a plain number. */
export function inferUnit(expression: string): UnitKind {
  const unit = expression.trim().split(/\s+/).at(-1) ?? '';
  const known = UNITS[unit as keyof typeof UNITS];
  if (!known) return 'length';
  return known.dim.angle === ANGLE.angle ? 'angle' : 'length';
}
