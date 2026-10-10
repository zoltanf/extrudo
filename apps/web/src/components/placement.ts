/**
 * Placing a component as one (P6-05 S5, ADR-0081 §3): a component stores no
 * transform, so moving, copying or laying it on the bed is the existing Move
 * and Place on Bed features over its live bodies.
 *
 * - **Move Component** selects the component's live bodies and opens the Move
 *   dialog.
 * - **Copy Component** opens the Move dialog with the bodies and `copy` set,
 *   and its OK makes the Move, a new "<name> (2)" component and the stamp on
 *   the Move in **one undo step**, so the copies follow the rule of §2 into
 *   the new component. Cancel leaves nothing.
 * - **Place Component on Bed** fills Place on Bed with the picked face and
 *   the component's other live bodies as `carry` (ADR-0081 §3), so they take
 *   the same turn and drop as the face's body.
 */
import {
  addComponent,
  type BodyId,
  type Command,
  type ComponentId,
  copyComponentName,
  type DocumentStore,
  type ExtrudoDocument,
  type FeatureId,
  newId,
  type SelectionItem,
  type SessionStore,
  setFeatureComponent,
} from '@extrudo/core';
import type { DialogController } from '../features/dialog';
import { moveDialog } from '../features/move';
import type { FeatureDialogSpec } from '../features/spec';

export interface PlacementActions {
  /** Selects the live members and opens the Move dialog. */
  move(id: ComponentId): void;
  /** Opens the Move dialog as a copy; its OK makes the Move, the component and the stamp. */
  copy(id: ComponentId): void;
  /**
   * Opens Place on Bed with the picked face (already selected) and the
   * component's other live bodies as `carry`. `faceBody` is the body the
   * picked face belongs to, left out.
   */
  placeOnBed(component: ComponentId, faceBody: BodyId): void;
}

export interface PlacementDeps {
  store: DocumentStore;
  session: SessionStore;
  dialog: Pick<DialogController, 'start' | 'startSpec'>;
  /** A component's live body IDs, in browser order. */
  members: (id: ComponentId) => readonly BodyId[];
  notify: (tone: 'info' | 'error', text: string) => void;
}

export function createPlacementActions(deps: PlacementDeps): PlacementActions {
  const { store, session, dialog, members, notify } = deps;
  const nameOf = (id: ComponentId) =>
    store.getState().doc.components?.find((c) => c.id === id)?.name;
  const bodyItems = (ids: readonly BodyId[]): SelectionItem[] =>
    ids.map((id) => ({ kind: 'body' as const, id }));

  return {
    move(id) {
      const label = nameOf(id);
      if (label === undefined) return;
      const bodies = members(id);
      if (bodies.length === 0) {
        notify('info', `${label} has no bodies to move.`);
        return;
      }
      session.getState().select(bodyItems(bodies), 'replace');
      dialog.start('move');
    },
    copy(id) {
      const label = nameOf(id);
      if (label === undefined) return;
      const bodies = members(id);
      if (bodies.length === 0) {
        notify('info', `${label} has no bodies to copy.`);
        return;
      }
      // The session selection is left alone: the derived spec fills the fields.
      dialog.startSpec(copyComponentSpec(store.getState().doc, label, bodies));
    },
    placeOnBed(component, faceBody) {
      const others = members(component).filter((body) => body !== faceBody);
      // Keep the picked face (the right-click selected it) and add the carried
      // bodies; pre-selection fills `face` and then `carry`.
      const face = session.getState().selection.filter((item) => item.kind === 'face');
      session.getState().select([...face, ...bodyItems(others)], 'replace');
      dialog.start('placeOnBed');
    },
  };
}

/**
 * The Move dialog as Copy Component (ADR-0081 §3): the component's bodies
 * with `copy` on, and a `commitWith` that adds a "<name> (2)" component and
 * stamps the new Move with it — all in the dialog's one undo step.
 */
export function copyComponentSpec(
  doc: Pick<ExtrudoDocument, 'components'>,
  name: string,
  bodies: readonly BodyId[],
): FeatureDialogSpec {
  const component: ComponentId = newId<ComponentId>();
  return {
    ...moveDialog,
    initialValues: () => ({
      refs: { bodies: bodies.map((body) => ({ kind: 'body' as const, id: body })) },
      toggles: { copy: true },
    }),
    commitWith: (values, ctx): readonly Command<unknown>[] => [
      ...(moveDialog.commitWith?.(values, ctx) ?? []),
      addComponent({ id: component, name: copyComponentName(doc, name) }),
      setFeatureComponent({ id: ctx.featureId as FeatureId, component }),
    ],
  };
}
