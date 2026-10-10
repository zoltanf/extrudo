/**
 * Which features Hide/Show works on (P1-12, ADR-0021): `Feature.visible`
 * changes what the view draws only for a sketch's curves (AppShell's sketch
 * list), construction geometry (its construction list) and canvas images
 * (`canvasGeometry`). Bodies are shown, ghosted and hidden by their own
 * metadata (ADR-0030). For every other feature type — a fillet, a chamfer, a
 * shell, a pattern — hiding the feature draws exactly what it drew before,
 * so its menus offer no Hide.
 */
import { CANVAS_TYPE, CONSTRUCTION_TYPES, type Feature } from '@extrudo/core';

export const VISIBILITY_FEATURE_TYPES: readonly string[] = [
  'sketch',
  ...CONSTRUCTION_TYPES,
  CANVAS_TYPE,
];

/** Whether hiding the feature would change what the view draws. */
export function visibilityApplies(feature: Pick<Feature, 'type'>): boolean {
  return VISIBILITY_FEATURE_TYPES.includes(feature.type);
}
