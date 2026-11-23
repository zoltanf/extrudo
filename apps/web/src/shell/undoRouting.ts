/**
 * What Ctrl+Z and the top bar's Undo do during a long update (ADR-0161). The
 * command list's Undo (search, marking menu, the agent) stays a plain undo.
 */

import type { UpdateNotice } from '../viewport/ModelProgress';

/** `cancel`: run Cancel; `nothing`: a pressed Cancel waits; `undo`: the plain undo. */
export type UndoRoute = 'undo' | 'cancel' | 'nothing';

export function undoRoute({
  notice,
  cancelUndoes,
  editing,
}: {
  notice: UpdateNotice;
  /** Cancel would only undo: the shown model's step is on the undo stack (`revertToShownUndoes`). */
  cancelUndoes: boolean;
  /** A dialog, a sketch or another transaction is open: Ctrl+Z is its own undo, as always. */
  editing: boolean;
}): UndoRoute {
  if (editing) return 'undo';
  if (notice === 'cancelling') return 'nothing';
  return notice === 'cancel' && cancelUndoes ? 'cancel' : 'undo';
}
