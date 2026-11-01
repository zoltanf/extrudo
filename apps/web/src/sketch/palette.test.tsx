/**
 * The sketch palette's rows and their docs sections (P6-22 S2, ADR-0116
 * §4): every row's label turns into the sketching guide anchor F1 opens, and
 * every such anchor is listed in `shell/docsAnchors.json`, so a new row
 * without a docs section fails here.
 *
 * This project has no DOM in tests, so the palette is checked with
 * `renderToStaticMarkup` (like `textEditing.test.tsx`): each row names
 * itself in an `aria-label` (the switch's checkbox, or the Look at button).
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { TooltipProvider } from '../design-system';
import { memoryPreferences } from '../platform';
import docsAnchors from '../shell/docsAnchors.json';
import { anchorFor } from '../shell/helpTarget';
import { createViewportStore } from '../viewport/store';
import { SketchPalette } from './panels';
import type { ToolHost, ToolHostState } from './tools/host';

/** The palette's rows, in the order they render, named by their own label. */
const ROWS = [
  'Look at',
  'Construction',
  'Sketch grid',
  'Snap to grid',
  'Show points',
  'Show dimensions',
  'Show constraints',
  'Show profiles',
  'Slice',
  'Auto-project',
  'Face outline',
];

const HOST_STATE: ToolHostState = {
  tool: undefined,
  pointer: undefined,
  screen: undefined,
  revision: 0,
  error: undefined,
  overConstrained: undefined,
  status: undefined,
  editing: undefined,
  solverReady: false,
  construction: false,
  dragging: false,
  moving: false,
};

/** Enough of a tool host to draw the Construction row: its toggle, not used. */
const host = {
  state: createStore<ToolHostState>(() => ({ ...HOST_STATE })),
  toggleConstruction: () => {},
} as unknown as ToolHost;

const palette = () =>
  renderToStaticMarkup(
    <TooltipProvider>
      <SketchPalette
        name="Sketch1"
        viewport={createViewportStore({
          preferences: memoryPreferences(),
          reducedMotion: () => true,
        })}
        host={host}
        outline={undefined}
        onOutline={() => {}}
        onLookAt={() => {}}
        onFinish={() => {}}
      />
    </TooltipProvider>,
  );

describe('the sketch palette docs anchors', () => {
  it('renders every row once, named by its label', () => {
    const labels = [...palette().matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
    // The panel section's own label is the palette's; the rest are the rows.
    expect(labels.filter((label) => label !== 'Sketch palette')).toEqual(ROWS);
  });

  it('lists a sketching section for every row, so a new row without docs fails', () => {
    const entries = docsAnchors as readonly { guide: string; anchor: string }[];
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) expect(entry.guide).toBe('sketching');
    const anchors = new Set(entries.map((e) => e.anchor));
    for (const row of ROWS) {
      expect(anchors, `${row} has no sketching docs section`).toContain(anchorFor(row));
    }
  });
});
