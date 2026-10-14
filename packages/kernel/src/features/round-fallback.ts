/**
 * Building a fillet or chamfer whose one failing tangent chain used to fail the
 * whole round (ADR-0038's/ADR-0043's amendment, 2026-10-12): with
 * `skipLostEdges` on, the edges the diagnosis blames are dropped and the rest
 * built once, with a warning, as a lost edge is. The facade's diagnosis has
 * already probed each chain alone (that is how it names the largest radius that
 * works), so a `too-large`/`unfilletable` failure names its failing chain.
 *
 * When the rebuild fails, or more than a third of the feature's edges would be
 * left out, the feature fails with the original error. There is
 * no greedy one-by-one pass: leaving out most of a round is not better than
 * failing it.
 *
 * **At its limit (2026-10-14).** Before any chain is dropped, a round whose
 * every failing chain is `too-large` with the facade's largest working size at
 * least `NEAR_LIMIT` of the size asked for is built once more with those
 * chains a hair smaller (× `UNDER_LIMIT`), with a warning, and if that fails
 * too at the size the diagnosis found working. A round that eats a whole
 * neighbouring face fails at exactly that face's size, and the facade's
 * bisection (7 halvings) can only name 127/128 of it; the round a hair under
 * is the same shape to well within any print or measurement tolerance. Where
 * the limit lies between the two, the round is built at 127/128 of its size
 * (0.8 % under) rather than not at all.
 *
 * Without `skipLostEdges` nothing here runs: the error is rethrown and the
 * feature fails as before.
 */

/** The share of the asked size the diagnosis must find working for the hair-under retry. */
export const NEAR_LIMIT = 0.99;
/** The scale of the hair-under retry. */
export const UNDER_LIMIT = 1 - 1e-4;

export interface RoundBuild<P extends { index: number }, R> {
  /** Builds the round from these picks; throws a `FilletError`/`ChamferError` on failure. */
  build: (kept: readonly P[]) => R;
  /**
   * The edge indices the diagnosis blames (its failing chains), `[]` when it
   * blames none (every chain works alone), or `undefined` for anything that is
   * not a size/geometry failure — a mixed-setting or unknown error is rethrown.
   */
  blame: (error: unknown) => number[] | undefined;
  /** A sentence saying why, for the warning ("Radius 3 mm is too large for edge 12 (max ≈ 1.2 mm)."). */
  reason: (error: unknown) => string;
  /** The feature's word in the warning: "fillet", "chamfer". */
  feature: string;
  /** The feature's `skipLostEdges`. */
  skip: boolean;
  warn: (message: string) => void;
  /**
   * The edge indices of the chains a failure blames and their smallest share
   * (0..1) of the asked size that works, when every problem is `too-large`;
   * `undefined` otherwise. With it and `under`, a round at its limit is
   * retried a hair smaller first.
   */
  limit?: (error: unknown) => { edges: number[]; share: number } | undefined;
  /** The pick with its sizes scaled by `factor`. */
  under?: (pick: P, factor: number) => P;
  /** The pick's size in mm, for the warning, and what it is ("radius", "distance"). */
  size?: (pick: P) => number;
  sizeName?: string;
}

export function buildRound<P extends { index: number }, R>(
  picks: readonly P[],
  options: RoundBuild<P, R>,
): R {
  try {
    return options.build(picks);
  } catch (error) {
    if (!options.skip) throw error;
    const hair = underLimit(picks, error, options);
    if (hair) return hair;
    const blamed = options.blame(error);
    if (blamed === undefined || blamed.length === 0) throw error;
    const kept = picks.filter((p) => !blamed.includes(p.index));
    const dropped = picks.length - kept.length;
    // Leave out at most a third of the edges: dropping much of a round changed
    // downstream geometry in the corpus (a later cut removed a whole body).
    if (kept.length === 0 || dropped * 3 > picks.length) throw error;
    try {
      const result = options.build(kept);
      options.warn(leftOutWarning(dropped, picks.length, options.feature, options.reason(error)));
      return result;
    } catch {
      // The rest can't all be built either: fail with the original error.
      throw error;
    }
  }
}

/**
 * The round built with its failing chains a hair under their size (× `UNDER_LIMIT`)
 * or, when that fails too, at the share the diagnosis found working, when every
 * failing chain is at its limit; `undefined` when not, or when both fail.
 */
function underLimit<P extends { index: number }, R>(
  picks: readonly P[],
  error: unknown,
  options: RoundBuild<P, R>,
): R | undefined {
  const { limit, under, size } = options;
  const near = limit?.(error);
  if (!near || !under || !size || near.share < NEAR_LIMIT || near.edges.length === 0) return;
  const blamed = picks.filter((p) => near.edges.includes(p.index));
  const first = blamed[0];
  if (!first) return;
  for (const [factor, how] of [
    [UNDER_LIMIT, 'a hair under'],
    [near.share, 'just under'],
  ] as const) {
    let result: R;
    try {
      result = options.build(picks.map((p) => (blamed.includes(p) ? under(p, factor) : p)));
    } catch {
      continue;
    }
    const asked = size(first);
    const edges =
      blamed.length === 1
        ? `edge ${first.index + 1}`
        : `edges ${listOf(blamed.map((p) => p.index + 1))}`;
    const what = options.sizeName ? `${options.sizeName} ` : '';
    options.warn(
      `${capitalized(options.feature)} built at ${what}${formatSize(asked * factor)}, ${how} the ${formatSize(asked)} asked for, which is just too large for ${edges}.`,
    );
    return result;
  }
  return undefined;
}

const capitalized = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** "3.9996 mm": enough decimals to tell it from the size asked for (five significant digits). */
function formatSize(value: number): string {
  return `${Number.parseFloat(value.toPrecision(5)).toString()} mm`;
}

/** "3", "3 and 8", "3, 8 and 12". */
function listOf(numbers: readonly number[]): string {
  if (numbers.length < 2) return numbers.join('');
  return `${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`;
}

/** "2 of 9 edges left out of the fillet: Radius 3 mm is too large for edge 12 (max ≈ 1.2 mm). Use …" */
function leftOutWarning(left: number, total: number, feature: string, reason: string): string {
  const sentence = reason.trim().replace(/\s+/g, ' ');
  return `${left} of ${total} edges left out of the ${feature}: ${sentence} Use Fix References to pick other edges or a smaller size.`;
}
