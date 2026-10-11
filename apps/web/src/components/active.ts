/**
 * The active component (P6-05 S4, ADR-0081 §6): session state that decides which component the
 * features the app inserts are stamped into. Nothing here is stored except the stamp itself
 * (`Feature.component`), which the core's `componentOfBody` rule reads for new bodies.
 */
import type {
  ComponentId,
  DocumentStore,
  ExtrudoDocument,
  Feature,
  SessionStore,
} from '@extrudo/core';

/** What a stamp reads: only the session's active component. */
type ActiveSource = Pick<SessionStore, 'getState'>;

/** The active component an insert should stamp, if the design still has it. */
export function activeComponentOf(session: ActiveSource): ComponentId | undefined {
  return session.getState().activeComponent;
}

/**
 * `feature` with `component` set to the active component when one is active and the feature has
 * none (a stamp that is already there is kept). Every app insert goes through this.
 */
export function withActiveComponent<T extends Feature>(feature: T, session: ActiveSource): T {
  const active = activeComponentOf(session);
  if (active === undefined || feature.component !== undefined) return feature;
  return { ...feature, component: active };
}

const has = (doc: Pick<ExtrudoDocument, 'components'>, id: ComponentId | undefined) =>
  id === undefined || (doc.components?.some((c) => c.id === id) ?? false);

/**
 * Clears the active and the isolated component when the document no longer has them (an undo
 * of New Component, a delete, a version restore). Returns the unsubscribe function.
 */
export function followComponentSession(store: DocumentStore, session: SessionStore): () => void {
  const check = () => {
    const { doc } = store.getState();
    const s = session.getState();
    if (!has(doc, s.activeComponent)) s.activateComponent(undefined);
    if (!has(doc, s.isolatedComponent)) s.isolateComponent(undefined);
  };
  check();
  return store.subscribe(check);
}
