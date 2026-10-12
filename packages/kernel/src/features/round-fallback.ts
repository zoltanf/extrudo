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
 * Without `skipLostEdges` nothing here runs: the error is rethrown and the
 * feature fails as before.
 */

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
}

export function buildRound<P extends { index: number }, R>(
  picks: readonly P[],
  options: RoundBuild<P, R>,
): R {
  try {
    return options.build(picks);
  } catch (error) {
    if (!options.skip) throw error;
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

/** "2 of 9 edges left out of the fillet: Radius 3 mm is too large for edge 12 (max ≈ 1.2 mm). Use …" */
function leftOutWarning(left: number, total: number, feature: string, reason: string): string {
  const sentence = reason.trim().replace(/\s+/g, ' ');
  return `${left} of ${total} edges left out of the ${feature}: ${sentence} Use Fix References to pick other edges or a smaller size.`;
}
