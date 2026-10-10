/**
 * The browser's component rows (P6-05 S3, ADR-0081 §6): the Bodies folder's live bodies
 * grouped under their components. Pure, so unit tests don't load React.
 */
import type { Component, ComponentId, ExtrudoDocument } from '@extrudo/core';
import type { BodyDisplay, BodyEntry } from '../shell/bodies';

export interface ComponentRow {
  component: Component;
  /** The component's live bodies, in the order of the entries. */
  bodies: BodyEntry[];
  /** How the component itself is shown (its eye). */
  display: BodyDisplay;
}

/** The component's own state: shown, ghost (visible false + ghost) or hidden. */
export function componentDisplay(component: Component): BodyDisplay {
  if (component.visible) return 'shown';
  return component.ghost ? 'ghost' : 'hidden';
}

/**
 * Component rows in `doc.components` order (an empty one too), and the loose bodies
 * after them. A body naming a component the design doesn't have is loose.
 */
export function componentRows(
  doc: Pick<ExtrudoDocument, 'components'>,
  entries: readonly BodyEntry[],
): { rows: ComponentRow[]; loose: BodyEntry[] } {
  const rows: ComponentRow[] = (doc.components ?? []).map((component) => ({
    component,
    bodies: [],
    display: componentDisplay(component),
  }));
  const byId = new Map<ComponentId, ComponentRow>(rows.map((r) => [r.component.id, r]));
  const loose: BodyEntry[] = [];
  for (const entry of entries) {
    const row = entry.component === undefined ? undefined : byId.get(entry.component);
    if (row) row.bodies.push(entry);
    else loose.push(entry);
  }
  return { rows, loose };
}

/**
 * The Viewport's `data-components` for tests: `Lid:Body1,Body2;Box:Body3` — component name,
 * its live body names, `;` between components in browser order, spaces as `_`. Absent
 * (`undefined`) with no components.
 */
export function componentsSummary(rows: readonly ComponentRow[]): string | undefined {
  if (rows.length === 0) return undefined;
  const flat = (text: string) => text.replace(/\s+/g, '_');
  return rows
    .map((r) => `${flat(r.component.name)}:${r.bodies.map((b) => flat(b.meta.name)).join(',')}`)
    .join(';');
}
