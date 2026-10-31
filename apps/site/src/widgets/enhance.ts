/**
 * The scripts that wake the docs widgets, by the names `index.ts` lists (ADR-0116
 * §1). `docs-widgets.ts` calls each on its `[data-widget]` figure.
 */
import { enhancePaletteSwitches } from './palette-switches';

export const ENHANCERS: Readonly<Record<string, (root: HTMLElement) => void>> = {
  'palette-switches': enhancePaletteSwitches,
};
