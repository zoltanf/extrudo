/**
 * The one remembered help target (P6-22 S2, ADR-0116 §4): a toolbar tile sets
 * a tool target, a sketch palette row sets a sketching section. F1 opens it;
 * the `help` command falls back to the sketching guide while a sketch is
 * open, else the guide. Module state, read when F1 runs or the panel opens;
 * it needs nothing else from React. Opening or closing a sketch clears it
 * (`sketch/mode.ts`), so F1 right after opening a sketch goes to the
 * sketching page. The Menu's **Help for This Tool** reads only a tool target
 * (`Toolbar.lastHoveredTool`).
 */
import type { DocsPage } from './docsLinks';

let target: DocsPage | undefined;

/** The remembered help target, if any tile or palette row was hovered last. */
export function helpTarget(): DocsPage | undefined {
  return target;
}

/** Remembers the target a hovered tile or palette row points at. */
export function setHelpTarget(page: DocsPage): void {
  target = page;
}

/** Forgets the target; the shell calls it when a sketch opens or closes. */
export function clearHelpTarget(): void {
  target = undefined;
}

/**
 * A docs heading's anchor (ADR-0116 §3), the way the docs build ids its
 * headings: lower case, runs of anything but `a-z0-9` as one `-`, trimmed.
 * "Auto-project" → `auto-project`, "Show points" → `show-points`.
 */
export function anchorFor(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
