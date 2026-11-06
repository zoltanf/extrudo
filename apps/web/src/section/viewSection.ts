/**
 * What a named view keeps of the section on screen (ADR-0045's amendment of 2026-11-06). Pure
 * over the viewport store's section state; the document and the view state never share objects.
 */
import type { ViewSection } from '@extrudo/core';
import type { ViewportStore } from '../viewport/store';
import type { SectionBoxState, SectionState } from './clip';

/**
 * What a named view stores of the section on screen: the box while it is shown, else every plane
 * row while at least one is shown, else nothing.
 */
export function sectionForView(
  planes: readonly SectionState[],
  box: SectionBoxState | undefined,
): ViewSection | undefined {
  if (box?.on) {
    const [cx, cy, cz] = box.center;
    const [hx, hy, hz] = box.half;
    return { kind: 'box', center: [cx, cy, cz], half: [hx, hy, hz], on: true };
  }
  if (!planes.some((p) => p.on)) return undefined;
  return { kind: 'planes', planes: planes.map((p) => ({ ...p, plane: { ...p.plane } })) };
}

/** `planes:<n>` or `box`: the rows' and menu entries' `data-view-section` (none without a section). */
export function viewSectionMark(section: ViewSection | undefined): string | undefined {
  if (!section) return undefined;
  return section.kind === 'box' ? 'box' : `planes:${section.planes.length}`;
}

/**
 * Puts a view's section on screen through the viewport store: planes replace the planes (and
 * clear a box), a box replaces the box (and clears the planes).
 */
export function showViewSection(viewport: ViewportStore, section: ViewSection): void {
  if (section.kind === 'box') {
    const [cx, cy, cz] = section.center;
    const [hx, hy, hz] = section.half;
    viewport.getState().setSectionBox({ center: [cx, cy, cz], half: [hx, hy, hz], on: section.on });
  } else {
    viewport.getState().setSection(section.planes.map((p) => ({ ...p, plane: { ...p.plane } })));
  }
}
