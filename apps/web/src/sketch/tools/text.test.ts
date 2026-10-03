/**
 * The Text tool (P4-03, ADR-0058 §6): the click places the anchor, the panel's
 * values come from `textDraftStore`, and OK commits two points, the text, a
 * vertical constraint and the height dimension as one undo step. The solver
 * is the real one; the shaper needs its font, loaded here from the package
 * directory as `packages/sketch/src/text/text.test.ts` does.
 */
import { readFileSync } from 'node:fs';
import { type SketchEntityId, textPolylines } from '@extrudo/core';
import { loadFont } from '@extrudo/sketch/text';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  resetTextDraft,
  setTextDraft,
  takeTextFocus,
  textDraftStore,
  textFocusStore,
} from '../textDraft';
import { at, disposeHosts, setup } from './testing';
import { TEXT_TOOL } from './text';

const FONTS_DIR = new URL('../../../../../packages/fonts/fonts/', import.meta.url);

beforeAll(() => {
  // The tool asks the app's font loader; in a test the bytes come from the package.
  loadFont('inter-regular@1', readFileSync(new URL('inter-regular.ttf', FONTS_DIR)));
});

afterEach(() => {
  disposeHosts();
  resetTextDraft();
});

/** A click that opens the panel, then OK. */
async function place(options: Partial<typeof textDraftStore.getState> = {}) {
  const t = await setup({ tool: TEXT_TOOL });
  t.host.click(at(0, 0));
  if (Object.keys(options).length > 0) setTextDraft(options);
  t.host.enter();
  return t;
}

describe('Text tool', () => {
  it('commits two points, the text, a vertical constraint and its height', async () => {
    const t = await place({ text: 'Ag' });
    expect(t.byType('point')).toHaveLength(2);
    const texts = t.byType('text');
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({ text: 'Ag', font: 'inter-regular@1', align: 'left' });
    // Upright, plus what the click at the origin inferred.
    expect(t.constraints()).toContain('vertical (0,0) (0,10)');
    expect(Object.values(t.data().dimensions).map((d) => d.expr)).toEqual(['10 mm']);
    // One undo step: one command took it all in, and one undo takes it out.
    expect(t.store.getState().undoLabel).toBe('Draw');
    t.store.getState().undo();
    expect(t.byType('text')).toHaveLength(0);
    expect(t.byType('point')).toHaveLength(0);
    expect(Object.keys(t.data().constraints)).toHaveLength(0);
    expect(Object.keys(t.data().dimensions)).toHaveLength(0);
  });

  it('draws the glyph curves, so the text has ink', async () => {
    const t = await place({ text: 'Ag' });
    const [text] = t.byType('text');
    const id = Object.entries(t.data().entities).find(([, e]) => e === text)?.[0];
    const polylines = textPolylines(t.data(), id as SketchEntityId);
    expect(polylines.size).toBeGreaterThan(10);
  });

  it('puts the top point a typed height above the anchor', async () => {
    const t = await place({ text: 'A', expr: '12 mm', mm: 12 });
    const [text] = t.byType('text');
    const anchor = t.point((text as { anchor: SketchEntityId }).anchor);
    const top = t.point((text as { top: SketchEntityId }).top);
    expect(anchor[0]).toBeCloseTo(0, 6);
    expect(anchor[1]).toBeCloseTo(0, 6);
    expect(top[0]).toBeCloseTo(0, 6);
    expect(top[1]).toBeCloseTo(12, 6);
    expect(Object.values(t.data().dimensions).map((d) => d.expr)).toEqual(['12 mm']);
  });

  it('makes construction text when the X toggle is on', async () => {
    const t = await setup({ tool: TEXT_TOOL });
    t.host.toggleConstruction();
    t.host.click(at(0, 0));
    t.host.enter();
    expect(t.byType('text')[0]).toMatchObject({ construction: true });
  });

  it('aligns left, centre or right about the anchor', async () => {
    const left = await place({ text: 'Ag', align: 'left' });
    const right = await place({ text: 'Ag', align: 'right' });
    const box = (t: Awaited<ReturnType<typeof place>>) => {
      const [text] = t.byType('text');
      const id = Object.entries(t.data().entities).find(([, e]) => e === text)?.[0] as string;
      const xs = [...textPolylines(t.data(), id as SketchEntityId).values()]
        .flat()
        .map((p) => p[0]);
      return { min: Math.min(...xs), max: Math.max(...xs) };
    };
    // Left-aligned starts at the anchor (bar the font's own side bearing), and
    // right-aligned ends at it: the whole word moves across it.
    expect(box(left).min).toBeLessThan(1);
    expect(box(right).max).toBeLessThan(1);
    expect(box(right).min).toBeLessThan(box(left).min - 5);
  });

  it('cancels with Esc and with an empty string', async () => {
    const t = await setup({ tool: TEXT_TOOL });
    t.host.click(at(0, 0));
    t.host.escape();
    expect(t.byType('text')).toHaveLength(0);
    expect(t.byType('point')).toHaveLength(0);
    expect(textDraftStore.getState().open).toBe(false);

    // The tool is still running, so the next click starts again.
    t.host.click(at(5, 5));
    expect(textDraftStore.getState().open).toBe(true);
    setTextDraft({ text: '' });
    t.host.enter();
    expect(t.byType('text')).toHaveLength(0);
    expect(t.host.state.getState().error).toMatch(/type some text/i);
  });

  it('a double-click on a text asks the panel for its Text field', async () => {
    const t = await place({ text: 'A' });
    // The tool is done; nothing runs, so the click selects (P1-09).
    t.host.stop();
    const [text] = t.byType('text');
    const id = Object.entries(t.data().entities).find(([, e]) => e === text)?.[0] as string;
    // On a glyph curve well away from the anchor (points win a pick, P1-09).
    const ink = [...textPolylines(t.data(), id as SketchEntityId).values()].flat();
    const far = ink.reduce((best, p) =>
      Math.hypot(p[0], p[1]) > Math.hypot(best[0], best[1]) ? p : best,
    );
    t.host.click({ ...at(far[0], far[1]), double: true });
    expect(t.session.getState().selection).toEqual([{ kind: 'sketchEntity', id }]);
    expect(textFocusStore.getState().id).toBe(id);
    expect(takeTextFocus()).toBe(id);
    // A single click asks for nothing.
    t.host.click(at(far[0], far[1]));
    expect(t.session.getState().selection).toEqual([{ kind: 'sketchEntity', id }]);
  });

  it('previews the text at the anchor while the panel is open', async () => {
    const t = await setup({ tool: TEXT_TOOL });
    expect(t.host.state.getState().tool?.preview().points).toEqual([]);
    t.host.click(at(1, 2));
    const preview = t.host.state.getState().tool?.preview();
    expect(preview?.points).toEqual([
      [1, 2],
      [1, 12],
    ]);
    expect(preview?.polylines?.length).toBeGreaterThan(4);
    setTextDraft({ text: '' });
    expect(t.host.state.getState().tool?.preview().polylines).toBeUndefined();
  });
});
