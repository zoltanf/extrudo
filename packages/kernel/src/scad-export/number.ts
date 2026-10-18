/**
 * Numbers as OpenSCAD source (P6-09, ADR-0088): at most 12 significant digits,
 * so `0.1 + 0.2` is written `0.3`, and never `-0`. OpenSCAD reads JavaScript's
 * exponent form (`1e-7`) as it is.
 */
export function scadNumber(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`Not a finite number: ${n}`);
  const rounded = Number(n.toPrecision(12));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}
