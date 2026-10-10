/**
 * Where a joint's clearance check samples its motion (P6-05, ADR-0081 §4):
 * an even coarse pass over the range, then a golden-section search for the
 * smallest gap and a bisection of each boundary between a free and a
 * colliding (or too tight) pose. Pure: the check wraps the measurements.
 */

/** Coarse samples per type over the range (10° over a whole turn for a revolute). */
export const JOINT_SAMPLES = { revolute: 36, slider: 25 } as const;
export const MAX_JOINT_SAMPLES = 72;
/** Evaluations (poses measured) per check, all passes together. */
export const MAX_JOINT_EVALS = 120;
/** `common` booleans per check (telling touching from interference). */
export const MAX_JOINT_COMMONS = 12;

/** The golden ratio's conjugate, (√5 − 1) / 2. */
const PHI = (Math.sqrt(5) - 1) / 2;

/**
 * Evenly spaced values over [min, max], both ends and 0 (when inside)
 * included, at most MAX_JOINT_SAMPLES.
 */
export function coarseSamples(range: { min: number; max: number }, count: number): number[] {
  const { min, max } = range;
  if (!(max > min)) return [min];
  // 0 may add one value, so the evenly spaced part stops one short of the cap.
  const zeroInside = min < 0 && max > 0;
  const n = Math.max(2, Math.min(Math.round(count), MAX_JOINT_SAMPLES - (zeroInside ? 1 : 0)));
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(i === n - 1 ? max : min + ((max - min) * i) / (n - 1));
  if (zeroInside && !out.some((v) => Math.abs(v) < 1e-12)) {
    out.push(0);
    out.sort((a, b) => a - b);
  }
  return out;
}

/** Golden-section search for the smallest gap in [lo, hi]; stops at `step` or `evals`. */
export function narrowMinimum(
  gap: (v: number) => number,
  lo: number,
  hi: number,
  step: number,
  evals: number,
): { at: number; gap: number; used: number } {
  let used = 0;
  let best = { at: lo, gap: Number.POSITIVE_INFINITY };
  const measure = (v: number) => {
    used++;
    const g = gap(v);
    if (g < best.gap) best = { at: v, gap: g };
    return g;
  };
  if (evals < 1 || !(hi > lo)) return { ...best, used };
  let a = lo;
  let b = hi;
  let c = b - PHI * (b - a);
  let fc = measure(c);
  if (used >= evals) return { ...best, used };
  let d = a + PHI * (b - a);
  let fd = measure(d);
  while (used < evals && b - a > step) {
    if (fc <= fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - PHI * (b - a);
      fc = measure(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + PHI * (b - a);
      fd = measure(d);
    }
  }
  return { ...best, used };
}

/**
 * Bisection of a free/colliding boundary in [free, hit] (either order): the
 * value where contact starts, on the colliding side, within `step` or after
 * `evals` evaluations.
 */
export function narrowBoundary(
  collides: (v: number) => boolean,
  free: number,
  hit: number,
  step: number,
  evals: number,
): { at: number; used: number } {
  let used = 0;
  while (used < evals && Math.abs(hit - free) > step) {
    const mid = (free + hit) / 2;
    used++;
    if (collides(mid)) hit = mid;
    else free = mid;
  }
  return { at: hit, used };
}
