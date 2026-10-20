/**
 * The Bodies field's smarter default for Extrude and Revolve (ADR-0095). The
 * kernel is blind to visibility, so an automatic join, cut or intersect takes
 * every body the tool reaches, hidden ones too. The dialog knows which bodies
 * those are (the preview's `OperationReport`) and which are shown, so it
 * proposes the shown ones as an explicit pick, and refuses when all are hidden.
 */
import type { BodyId } from '@extrudo/core';
import type { DialogIssue, DialogValues, ProposeContext } from './spec';

type Context = Pick<ProposeContext, 'doc' | 'draftOperation' | 'feature'>;

/** A ghost is stored with `visible: false` (ADR-0030's amendment), so it is hidden too. */
const hidden = (ctx: Context, id: BodyId): boolean => ctx.doc.bodies[id]?.visible === false;

/**
 * The Bodies pick to propose: the shown bodies the tool reaches when a hidden
 * one is among them, else "automatic" (empty) when the current pick isn't.
 * Undefined while there is nothing to say: a new body, no report yet, or an
 * edited feature that stores picks (they are the user's, or an earlier
 * proposal's, and a recompute must not change with them).
 */
export function proposeBodies(
  values: DialogValues,
  ctx: Context & { operation?: string },
): Partial<DialogValues> | undefined {
  if ((ctx.operation ?? values.choices.operation ?? 'new-body') === 'new-body') return undefined;
  const touching = ctx.draftOperation?.touching;
  if (!touching?.length) return undefined;
  const current = values.refs.bodies ?? [];
  if (ctx.feature && current.length > 0) return undefined;
  const shown = touching.filter((id) => !hidden(ctx, id));
  if (shown.length > 0 && shown.length < touching.length) {
    return { refs: { bodies: shown.map((id) => ({ kind: 'body' as const, id })) } };
  }
  return current.length > 0 ? { refs: { bodies: [] } } : undefined;
}

/** The refusal for a join, cut or intersect whose every reachable body is hidden. */
export function allHidden(
  values: DialogValues,
  ctx: Pick<Context, 'doc' | 'draftOperation'>,
  noun: string,
): DialogIssue | undefined {
  if ((values.choices.operation ?? 'new-body') === 'new-body') return undefined;
  if ((values.refs.bodies ?? []).length > 0) return undefined;
  const touching = ctx.draftOperation?.touching ?? [];
  if (touching.length === 0 || !touching.every((id) => hidden(ctx, id))) return undefined;
  return {
    field: 'bodies',
    message: `Every body the ${noun} reaches is hidden. Show one, pick it under Bodies, or make a new body.`,
  };
}

/**
 * An extrude or revolve's `propose`: the press-pull operation (when the user
 * hasn't chosen one) with the Bodies proposal for the operation in effect.
 */
export function proposeWithBodies(
  operation: Partial<DialogValues> | undefined,
  values: DialogValues,
  ctx: ProposeContext,
): Partial<DialogValues> | undefined {
  const proposed = ctx.chosen('operation') ? undefined : operation?.choices?.operation;
  const bodies = proposeBodies(values, { ...ctx, operation: proposed });
  return operation || bodies ? { ...operation, ...bodies } : undefined;
}
