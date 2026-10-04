/**
 * Editing a text in a sketch (P4-03, ADR-0058 §6): the commands the selection
 * panel writes, the height dimension they drive, and the panel's own fields.
 * The panel is React, and this project has no DOM in tests, so the commands it
 * runs are tested here and the panel is checked with `renderToStaticMarkup`.
 */

import {
  addToSketch,
  type ConstraintId,
  createDocument,
  createDocumentStore,
  createSessionStore,
  type DimensionId,
  type FeatureId,
  originPlaneRef,
  readSketch,
  type SketchDimension,
  type SketchEntityId,
  updateSketchDimension,
} from '@extrudo/core';
import { loadPlanegcs, SketchSolver } from '@extrudo/sketch';
import { memoryProjectStore } from '@extrudo/storage';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { memoryPreferences } from '../platform';
import { createViewportStore } from '../viewport/store';
import { createSketchOn } from './mode';
import { TextFields } from './panels';
import { textHeight, textHeightDimension, textPatch } from './textEditing';
import { createToolHost, type ToolHost } from './tools/host';

const eid = (id: string) => id as SketchEntityId;
/** A Font select that can offer "Add font…" but never has a file to add (P4-03b). */
const noFonts = { files: { pick: async () => undefined }, projects: memoryProjectStore() };
const hosts: ToolHost[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.dispose();
});

/** A sketch in sketch mode holding "Ag" 10 mm tall, with its height dimension. */
async function setup(withDimension = true) {
  const stores = {
    store: createDocumentStore(createDocument()),
    session: createSessionStore(),
    viewport: createViewportStore({ preferences: memoryPreferences(), reducedMotion: () => true }),
  };
  const sketch = createSketchOn(stores, originPlaneRef('origin:xy'));
  const dimensions: Record<string, SketchDimension> = {};
  if (withDimension) {
    dimensions['h1' as DimensionId] = {
      type: 'distance',
      orientation: 'aligned',
      a: eid('anchor'),
      b: eid('top'),
      expr: '10 mm',
      paramName: 'd1',
      driven: false,
    };
  }
  stores.store.getState().dispatch(
    addToSketch({
      feature: sketch,
      entities: {
        [eid('anchor')]: { type: 'point', x: 0, y: 0 },
        [eid('top')]: { type: 'point', x: 0, y: 10 },
        [eid('word')]: {
          type: 'text',
          anchor: eid('anchor'),
          top: eid('top'),
          text: 'Ag',
          font: 'inter-regular@1',
          align: 'left',
          construction: false,
        },
      },
      constraints: {
        ['v' as ConstraintId]: { type: 'vertical', a: eid('anchor'), b: eid('top') },
      },
      dimensions,
    }),
  );
  const planegcs = await loadPlanegcs();
  const host = createToolHost({
    ...stores,
    loadSolver: async () => new SketchSolver(planegcs),
  });
  hosts.push(host);
  const data = () => {
    const feature = stores.store.getState().doc.features.find((f) => f.id === sketch);
    const view = feature && readSketch(feature);
    if (!view) throw new Error('no sketch');
    return view.data;
  };
  return { ...stores, host, sketch: sketch as FeatureId, data };
}

describe('editing a text', () => {
  it('changes the string, font, alignment and construction through setText', async () => {
    const { sketch, data } = await setup();
    // Each patch is its own command, as the panel writes it.
    const change = (patch: Parameters<typeof textPatch>[2]) =>
      textPatch(sketch, eid('word'), patch);
    expect(change({ text: 'Extrudo' })).toMatchObject({
      type: 'sketch.text',
      payload: { feature: sketch, id: 'word', patch: { text: 'Extrudo' } },
    });
    expect(change({ font: 'fredoka-semibold@1' }).payload).toMatchObject({
      patch: { font: 'fredoka-semibold@1' },
    });
    expect(change({ align: 'center' }).payload).toMatchObject({ patch: { align: 'center' } });
    expect(change({ construction: true }).payload).toMatchObject({
      patch: { construction: true },
    });
    expect(data().entities[eid('word')]?.type).toBe('text');
  });

  it('applies each change as one undo step, and the height through its dimension', async () => {
    const t = await setup();
    // The sketch's own transaction (sketch mode) is open; a change inside it is
    // still its own step, as the panel's are.
    t.host.apply(textPatch(t.sketch, eid('word'), { text: 'Extrudo' }));
    expect((t.data().entities[eid('word')] as { text: string }).text).toBe('Extrudo');
    t.store.getState().undo();
    expect((t.data().entities[eid('word')] as { text: string }).text).toBe('Ag');
    t.store.getState().redo();
    expect((t.data().entities[eid('word')] as { text: string }).text).toBe('Extrudo');

    // The height is the dimension between the text's own points.
    const height = textHeightDimension(t.data(), t.data().entities[eid('word')]);
    expect(height?.dimension.expr).toBe('10 mm');
    t.host.apply(
      updateSketchDimension({
        feature: t.sketch,
        id: height?.id as DimensionId,
        changes: { expr: '18 mm' },
      }),
    );
    expect(textHeightDimension(t.data(), t.data().entities[eid('word')])?.dimension.expr).toBe(
      '18 mm',
    );
    // The text is taller now: the solve moved its top point.
    expect(textHeight(t.data(), eid('word')) ?? 0).toBeCloseTo(18, 3);
    t.store.getState().undo();
    expect(textHeight(t.data(), eid('word')) ?? 0).toBeCloseTo(10, 3);
  });

  it('measures the height when the text has no dimension of its own', async () => {
    const t = await setup(false);
    expect(textHeightDimension(t.data(), t.data().entities[eid('word')])).toBeUndefined();
    expect(textHeight(t.data(), eid('word'))).toBeCloseTo(10, 6);
    expect(textHeight(t.data(), eid('anchor'))).toBeUndefined();
  });
});

describe('the selection panel for a text', () => {
  it('shows the string, font, alignment and height of the selected text', async () => {
    const t = await setup();
    const html = renderToStaticMarkup(
      <TextFields
        store={t.store}
        data={t.data()}
        id={'word' as SketchEntityId}
        text={t.data().entities[eid('word')] as never}
        sketchId={t.sketch}
        doc={t.store.getState().doc}
        host={t.host}
        fonts={noFonts}
        notify={() => {}}
      />,
    );
    expect(html).toContain('aria-label="Text"');
    expect(html).toContain('>Ag<');
    expect(html).toContain('aria-label="Font"');
    expect(html).toContain('Fredoka');
    expect(html).toContain('>Alignment<');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Height"');
    expect(html).toContain('10 mm');
  });

  it('shows the measured height when the text has no dimension, without a font list change', async () => {
    const t = await setup(false);
    const html = renderToStaticMarkup(
      <TextFields
        store={t.store}
        data={t.data()}
        id={'word' as SketchEntityId}
        text={t.data().entities[eid('word')] as never}
        sketchId={t.sketch}
        doc={t.store.getState().doc}
        host={t.host}
        fonts={noFonts}
        notify={() => {}}
      />,
    );
    expect(html).toContain('10.00 mm');
    expect(html).not.toContain('aria-label="Height"');
  });
});
