/**
 * Model-mode selection glue (P2-03, ADR-0026): turns the viewport's picks
 * into session changes, and keeps the session's selection and hover valid
 * as bodies are recomputed and modes change. The shell and the kernel debug
 * page use it the same way.
 */
import type { BodyId, SelectionItem, SessionStore } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { useEffect, useMemo, useRef } from 'react';
import type { ModelSelect } from '../viewport/Viewport';
import { pruneSelection } from './items';

/** Kinds that model-mode picking sets as the session's hover. */
const PICKED: ReadonlySet<string> = new Set([
  'body',
  'face',
  'edge',
  'vertex',
  'profile',
  'sketchEntity',
  'axis',
]);

/** Clears the session's hover if model picking set it. */
export function clearPickedHover(session: SessionStore): void {
  const hover = session.getState().hover;
  if (hover && PICKED.has(hover.kind)) session.getState().setHover(undefined);
}

/**
 * The viewport's model-mode selection handlers on a session:
 *
 * - hover → the session's `hover` (leaving the view clears only a hover
 *   that picking set, not a browser row's);
 * - click → select the item (`replace`), Shift/Ctrl/⌘ toggles it; a click
 *   on empty space clears the selection unless a modifier is held;
 * - box → select what it took (`replace`, or `add` with a modifier).
 */
export function createModelSelect(session: SessionStore): ModelSelect {
  return {
    onHover: (item) => {
      const current = session.getState().hover;
      if (item || (current && PICKED.has(current.kind))) session.getState().setHover(item);
    },
    onClick: (item, toggle) => {
      const s = session.getState();
      if (item) s.select([item], toggle ? 'toggle' : 'replace');
      else if (!toggle) s.clearSelection();
    },
    onBox: (items: SelectionItem[], add) =>
      session.getState().select(items, add ? 'add' : 'replace'),
  };
}

/**
 * `createModelSelect` while `enabled` (model mode, no command running),
 * else `undefined`. While mounted, the selection follows the bodies
 * (`pruneSelection`), and a hover that picking set is cleared when picking
 * stops.
 */
export function useModelSelection(
  session: SessionStore,
  bodies: Readonly<Record<BodyId, BodyMesh>>,
  enabled: boolean,
): ModelSelect | undefined {
  const select = useMemo(
    () => (enabled ? createModelSelect(session) : undefined),
    [session, enabled],
  );

  useEffect(() => {
    if (!enabled) clearPickedHover(session);
  }, [session, enabled]);

  // Recomputed bodies: drop or follow selected topology (and a hover on it).
  const previous = useRef(bodies);
  useEffect(() => {
    const from = previous.current;
    previous.current = bodies;
    if (from === bodies) return;
    const s = session.getState();
    const next = pruneSelection(s.selection, from, bodies);
    if (next !== s.selection) s.select(next, 'replace');
    if (s.hover && pruneSelection([s.hover], from, bodies).length === 0) s.setHover(undefined);
  }, [session, bodies]);

  return select;
}
