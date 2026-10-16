/**
 * What a solid feature does with its tool, in OpenSCAD (P6-09, ADR-0088):
 * the counterpart of the evaluators' `operate` (`features/operation.ts`),
 * shared by every feature that makes a tool and joins, cuts or intersects
 * with it (the primitives, extrude, revolve). It reads what the operation did
 * from the body maps (`changed`, `removed`), never from the inputs, which
 * leave "automatic" to the evaluation.
 */
import type { BodyOperation } from '@extrudo/core';
import type { CsgContext, CsgResult } from './context';
import { boolean, type CsgNode } from './ir';

/**
 * Each body the operation made or changed, built from `tool` (the solid in
 * place, as OpenSCAD):
 *
 * - **new body** (and a join with nothing to join to): the one new body is
 *   the tool; several (the solid fell apart) are left to the mesh fallback.
 * - **join**: the body it joined to is the union of its version, the
 *   versions of the bodies the join merged into it, and the tool.
 * - **cut**, **intersect**: each changed body is the difference or
 *   intersection of its version and the tool; a body the cut removed is
 *   simply gone. A tool two or more bodies use is shared (`ctx.tool`).
 *
 * A body broken into pieces gets no special case: the version walk meshes it.
 */
export function operationCsg(ctx: CsgContext, operation: BodyOperation, tool: CsgNode): CsgResult {
  const fresh = ctx.changed.filter((id) => !ctx.before.has(id));
  const kept = ctx.changed.filter((id) => ctx.before.has(id));
  if (operation === 'new-body' || (operation === 'join' && kept.length === 0)) {
    const [only] = fresh;
    if (only === undefined || fresh.length > 1) {
      return ctx.unsupported('a solid that falls apart into several bodies');
    }
    return new Map([[only, tool]]);
  }
  if (operation === 'join') {
    const [into] = kept;
    if (into === undefined || kept.length > 1) return ctx.unsupported('a join into several bodies');
    return new Map([
      [into, boolean('union', [ctx.body(into), ...ctx.removed.map((id) => ctx.body(id)), tool])],
    ]);
  }
  const kind = operation === 'cut' ? 'difference' : 'intersection';
  const shared = kept.length >= 2 ? ctx.tool(tool) : tool;
  return new Map(kept.map((id) => [id, boolean(kind, [ctx.body(id), shared])] as const));
}
