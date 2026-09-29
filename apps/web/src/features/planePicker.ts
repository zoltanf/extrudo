/**
 * Picking a plane into a feature dialog (P2-10, ADR-0032): while an open
 * dialog's pick field takes planes (a primitive's Plane), the view offers
 * the origin planes and flat faces as Create Sketch does (ADR-0031), and a
 * click puts the plane or face into the field. The field's own picks show
 * as the selected plane.
 */
import type { SelectionItem, SessionStore } from '@extrudo/core';
import type { PlanePicker } from '../viewport/Viewport';
import type { DialogController, OpenDialog } from './dialog';
import type { SelectionField } from './spec';

/** The open dialog's pick field, when it takes planes. */
function planeField(open: OpenDialog | undefined): SelectionField | undefined {
  const field = open?.spec.fields.find((f) => f.name === open.pickField);
  return field?.kind === 'selection' && field.accepts.includes('plane') ? field : undefined;
}

/**
 * Whether the open dialog picks planes now: the view then picks through
 * `dialogPlanePicker` instead of the dialog's model selection.
 */
export function dialogPlanePick(
  controller: DialogController | undefined,
  open: OpenDialog | undefined,
): boolean {
  return controller !== undefined && planeField(open) !== undefined;
}

/** The plane picker for an open dialog, or undefined when its pick field doesn't take planes. */
export function dialogPlanePicker(
  controller: DialogController | undefined,
  open: OpenDialog | undefined,
  session: SessionStore,
  hover: SelectionItem | undefined,
): PlanePicker | undefined {
  const field = planeField(open);
  if (!controller || !field) return undefined;
  const { select } = controller;
  const selected = (open?.values.refs[field.name] ?? [])
    .filter((r) => r.kind === 'plane')
    .map((r) => r.id);
  return {
    hover: hover?.kind === 'plane' ? hover.id : undefined,
    ...(selected.length > 0 && { selected }),
    onHover: (plane) => select.onHover({ kind: 'plane', id: plane }),
    onLeave: (plane) => {
      const current = session.getState().hover;
      if (current?.kind === 'plane' && current.id === plane) session.getState().setHover(undefined);
    },
    onPick: (plane) => select.onClick({ kind: 'plane', id: plane }, false),
    ...(field.accepts.includes('face') && {
      faces: {
        onHover: (item: SelectionItem | undefined) => select.onHover(item),
        onPick: (item: SelectionItem) => select.onClick(item, false),
      },
    }),
  };
}
