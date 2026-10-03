import {
  addToSketch,
  createDocument,
  createDocumentStore,
  createSketch,
  type FeatureId,
  newId,
  originPlaneRef,
  type SelectionItem,
  type SketchEntityId,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { PRESS_PULL, PRESS_PULL_PROMPT, pressPullTarget } from './pressPull';

const face: SelectionItem = { kind: 'face', id: 'B:0:3' };
const edge: SelectionItem = { kind: 'edge', id: 'B:0:5' };
const profile: SelectionItem = { kind: 'profile', id: 'S/r1' };

describe('what Press Pull does with the selection', () => {
  it('extrudes a profile, moves a face, rounds an edge', () => {
    expect(pressPullTarget([profile])).toBe('extrude');
    expect(pressPullTarget([face])).toBe('offsetFace');
    expect(pressPullTarget([face, { kind: 'face', id: 'B:0:4' }])).toBe('offsetFace');
    expect(pressPullTarget([edge])).toBe('fillet');
  });

  it('prefers a profile over a face over an edge when several kinds are selected', () => {
    expect(pressPullTarget([edge, face])).toBe('offsetFace');
    expect(pressPullTarget([edge, face, profile])).toBe('extrude');
    expect(pressPullTarget([edge, profile])).toBe('extrude');
  });

  it('extrudes a whole text, and leaves a sketch curve alone (P4-03)', () => {
    const eid = (id: string) => id as SketchEntityId;
    const store = createDocumentStore(createDocument());
    const sketch = newId<FeatureId>();
    store.getState().dispatch(createSketch({ id: sketch, plane: originPlaneRef('origin:xy') }));
    store.getState().dispatch(
      addToSketch({
        feature: sketch,
        entities: {
          [eid('a')]: { type: 'point', x: 0, y: 0 },
          [eid('b')]: { type: 'point', x: 10, y: 0 },
          [eid('c')]: { type: 'point', x: 0, y: 10 },
          [eid('anchor')]: { type: 'point', x: 20, y: 0 },
          [eid('top')]: { type: 'point', x: 20, y: 10 },
          [eid('l')]: { type: 'line', start: eid('a'), end: eid('b'), construction: false },
          [eid('word')]: {
            type: 'text',
            anchor: eid('anchor'),
            top: eid('top'),
            text: 'A',
            font: 'inter-regular@1',
            align: 'left',
            construction: false,
          },
        },
        constraints: {},
        dimensions: {},
      }),
    );
    const doc = store.getState().doc;
    const text: SelectionItem = { kind: 'sketchEntity', id: `${sketch}/word` };
    const line: SelectionItem = { kind: 'sketchEntity', id: `${sketch}/l` };
    expect(pressPullTarget([text], doc)).toBe('extrude');
    expect(pressPullTarget([text, edge], doc)).toBe('extrude');
    expect(pressPullTarget([line], doc)).toBeUndefined();
    // Without the document there is no telling a text from a curve.
    expect(pressPullTarget([text])).toBeUndefined();
  });

  it('does nothing with a selection of other things, and says what to select', () => {
    expect(pressPullTarget([])).toBeUndefined();
    expect(pressPullTarget([{ kind: 'body', id: 'B:0' }])).toBeUndefined();
    expect(pressPullTarget([{ kind: 'vertex', id: 'B:0:1' }])).toBeUndefined();
    expect(PRESS_PULL_PROMPT).toMatch(/face.*edge.*profile/);
    expect(PRESS_PULL).toBe('pressPull');
  });
});
