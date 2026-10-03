import {
  addToSketch,
  createDocument,
  createDocumentStore,
  createSketch,
  type FeatureId,
  newId,
  originPlaneRef,
  type SketchEntityId,
} from '@extrudo/core';
import { BUNDLED_FONTS } from '@extrudo/fonts';
import { describe, expect, it } from 'vitest';
import { fontUrls, usedFonts } from './fonts';

const eid = (id: string) => id as SketchEntityId;

/** A document with one sketch holding a text entity of `font`. */
function documentWithText(font: string) {
  const store = createDocumentStore(createDocument());
  const sketch = newId<FeatureId>();
  store.getState().dispatch(createSketch({ id: sketch, plane: originPlaneRef('origin:xy') }));
  store.getState().dispatch(
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
          font,
          align: 'left',
          construction: false,
        },
      },
      constraints: {},
      dimensions: {},
    }),
  );
  return store.getState().doc;
}

describe('usedFonts', () => {
  it('collects the fonts of every text entity of every sketch', () => {
    const doc = documentWithText('inter-bold@1');
    expect([...usedFonts(doc)]).toEqual(['inter-bold@1']);
    expect([...usedFonts(createDocument())]).toEqual([]);
  });

  it('counts a font once, however many texts use it', () => {
    const store = createDocumentStore(createDocument());
    const sketch = newId<FeatureId>();
    store.getState().dispatch(createSketch({ id: sketch, plane: originPlaneRef('origin:xy') }));
    const text = (id: string, anchor: SketchEntityId, top: SketchEntityId) => ({
      [eid(id)]: {
        type: 'text' as const,
        anchor,
        top,
        text: id,
        font: 'jetbrains-mono-regular@1',
        align: 'center' as const,
        construction: false,
      },
    });
    store.getState().dispatch(
      addToSketch({
        feature: sketch,
        entities: {
          [eid('a')]: { type: 'point', x: 0, y: 0 },
          [eid('b')]: { type: 'point', x: 0, y: 10 },
          [eid('c')]: { type: 'point', x: 20, y: 0 },
          [eid('d')]: { type: 'point', x: 20, y: 10 },
          ...text('one', eid('a'), eid('b')),
          ...text('two', eid('c'), eid('d')),
        },
        constraints: {},
        dimensions: {},
      }),
    );
    expect([...usedFonts(store.getState().doc)]).toEqual(['jetbrains-mono-regular@1']);
  });
});

describe('fontUrls', () => {
  it('has an asset URL for every bundled font', () => {
    for (const font of BUNDLED_FONTS) {
      const url = (fontUrls as Record<string, string | undefined>)[font.id];
      expect(url, font.id).toBeDefined();
      expect(url).toMatch(/\.ttf$/);
    }
  });

  it('names exactly the bundled fonts', () => {
    expect(Object.keys(fontUrls).sort()).toEqual(BUNDLED_FONTS.map((f) => f.id).sort());
  });
});
