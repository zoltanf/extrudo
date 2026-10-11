import type { GeomRef } from '@extrudo/core';
import { LostReferenceError, type ResolvedRef } from '../naming/resolve';
import type { EvalContext } from '../recompute/types';

/**
 * How a fillet or chamfer resolves its edges (ADR-0005), with or without its
 * `skipLostEdges` input (ADR-0038's and ADR-0043's amendments, 2026-10-11).
 *
 * Without it a lost edge is thrown, as `ctx.resolve` throws it: the feature
 * fails and Fix References offers the edge (ADR-0033). With it a lost edge is
 * left out (`resolve` answers `undefined`) and counted, and `finish` warns how
 * many were left out — the engine has noted each one as lost, so the warning
 * status still lists them for Fix References. When no edge at all is found,
 * `finish` throws the first loss: the feature fails as it would without.
 */
export function edgeResolver(
  ctx: Pick<EvalContext, 'resolve' | 'warn'>,
  options: { label: string; feature: string; skip: boolean },
) {
  let total = 0;
  let lost = 0;
  let first: LostReferenceError | undefined;
  return {
    resolve(ref: GeomRef): ResolvedRef | undefined {
      total++;
      try {
        return ctx.resolve(ref, { label: options.label });
      } catch (error) {
        if (!options.skip || !(error instanceof LostReferenceError)) throw error;
        lost++;
        first ??= error;
        return undefined;
      }
    },
    finish(): void {
      if (lost === 0) return;
      if (lost === total && first) throw first;
      ctx.warn(lostEdgesMessage(lost, total, options.feature));
    },
  };
}

/** "2 of 7 edges can't be found and are left out of the fillet. …" */
export function lostEdgesMessage(lost: number, total: number, feature: string): string {
  const one = lost === 1;
  return `${lost} of ${total} edges can't be found and ${one ? 'is' : 'are'} left out of the ${feature}. Use Fix References to pick ${one ? 'it' : 'them'} again.`;
}
