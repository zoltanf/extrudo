/**
 * Base features (`D7015B81…`): a body kept without history, either a step of
 * the timeline or made, off the timeline, by a body move (Body to Component,
 * CutPasteBodies), which references its base feature and is referenced back.
 *
 * A base feature that holds a body references two body records (`D3937028…`),
 * each with a one-entry property block whose key says which it is:
 *
 * - `BASEFEAT_PM_BODY_REF`: the body as the base feature left it. A hidden
 *   body with its own body container and B-rep stream; that stream's solid
 *   whose faces carry the base feature's operation is the body.
 * - `BASEFEAT_DM_BODY_REF`: the design's body it became, which later features
 *   change; its body link names the base feature as its creator.
 *
 * The two reference each other. A base feature with neither holds no body.
 */
import type { Segment } from '../segment';
import { BODY, baseBodyRole } from './body';

export const BASE_FEATURE = 'D7015B81-AB4D-4C89-BED7-AA4411E1964A';

/** A base feature's bodies (body records); none when it holds no body. */
export interface F3dBase {
  /** The base feature record. */
  id: number;
  /** The body as the base feature left it (its own B-rep stream). */
  kept?: number;
  /** The design body it made. */
  made?: number;
}

/** The bodies a base feature record names, by their role. */
export function readBase(seg: Segment, id: number, refs: readonly number[]): F3dBase {
  const out: F3dBase = { id };
  for (const body of new Set(refs)) {
    if (seg.typeOf(body)?.guid !== BODY) continue;
    const role = baseBodyRole(seg, body)?.role;
    if (role && out[role] === undefined) out[role] = body;
  }
  return out;
}
