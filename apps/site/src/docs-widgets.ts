/**
 * The one script a docs page with a widget loads (ADR-0116 §1), as a hashed module
 * asset (`docs-plugin.ts`); a page without a widget loads nothing. The page is
 * complete without it: each widget is drawn in its starting state with its
 * controls disabled, and this wakes it.
 */
import { ENHANCERS } from './widgets/enhance';

for (const root of document.querySelectorAll<HTMLElement>('[data-widget]')) {
  ENHANCERS[root.dataset.widget ?? '']?.(root);
}
