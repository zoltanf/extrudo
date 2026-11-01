/**
 * The scripts that wake the docs widgets, by the names `index.ts` lists (ADR-0116
 * §1). `docs-widgets.ts` calls each on its `[data-widget]` figure.
 */
import { enhanceDimensionLabel } from './dimension-label';
import { enhanceDofPlayground } from './dof-playground';
import { enhancePaletteSwitches } from './palette-switches';
import { enhanceTrim } from './trim';

export const ENHANCERS: Readonly<Record<string, (root: HTMLElement) => void>> = {
  'palette-switches': enhancePaletteSwitches,
  'dof-playground': enhanceDofPlayground,
  'dimension-label': enhanceDimensionLabel,
  trim: enhanceTrim,
};
