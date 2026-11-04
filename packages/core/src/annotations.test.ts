import { describe, expect, it } from 'vitest';
import {
  addAnnotation,
  annotationAnchorProblem,
  annotationByNumber,
  annotationEntityPoint,
  moveAnnotation,
  nextAnnotationNumber,
  raiseAnnotationCounter,
  removeAnnotation,
  updateAnnotation,
} from './annotations';
import { type Command, CommandError } from './commands';
import { removeFeature, restoreVersion } from './document-commands';
import type { AnnotationId, SketchEntityId } from './ids';
import { remintAnnotations } from './remint';
import {
  type Annotation,
  type AnnotationAnchor,
  DocumentSchema,
  type ExtrudoDocument,
} from './schema';
import { modifySketch, removeFromSketch } from './sketch/commands';
import { sketchInputs } from './sketch/feature';
import type { SketchData } from './sketch/schema';
import { createDocumentStore } from './stores';
import { feature, fid, sampleDocument } from './testing';

const aid = (id: string) => id as AnnotationId;
const eid = (id: string) => id as SketchEntityId;

const onFace: AnnotationAnchor = {
  kind: 'model',
  ref: {
    kind: 'face',
    id: 'extrude:f2:cap:end',
    fingerprint: { type: 'plane', at: [0, 0, 10], dir: [0, 0, 1], size: 100 },
  },
  at: [2, 3, 10],
};
const free: AnnotationAnchor = { kind: 'free', at: [1, 2, 3] };

/** A sketch with a point, a line between two more points, and a circle. */
function sketchData(): SketchData {
  return {
    entities: {
      p1: { type: 'point', x: 5, y: 6 },
      a: { type: 'point', x: 0, y: 0 },
      b: { type: 'point', x: 10, y: 4 },
      l1: { type: 'line', start: eid('a'), end: eid('b'), construction: false },
      c: { type: 'point', x: -3, y: 2 },
      k1: { type: 'circle', center: eid('c'), radius: 2, construction: false },
    },
    constraints: {},
    dimensions: {},
  } as unknown as SketchData;
}

/** The sample design with a real sketch (`s1`) first. */
function design(annotations: Annotation[] = [], counter?: number): ExtrudoDocument {
  const doc = sampleDocument();
  return {
    ...doc,
    features: [
      {
        ...feature('s1', 'sketch', 'Sketch2'),
        inputs: sketchInputs({ kind: 'plane', id: 'origin:xy' }, sketchData()),
      },
      ...doc.features,
    ],
    timelineMarker: 4,
    ...(annotations.length > 0 && { annotations }),
    ...(counter !== undefined && { annotationCounter: counter }),
  };
}

const note = (id: string, number: number, anchor: AnnotationAnchor = free): Annotation => ({
  id: aid(id),
  number,
  text: `Note ${number}`,
  anchor,
});

/** Dispatches `command`, checks the result is valid and one undo restores the document exactly. */
function roundTrip(doc: ExtrudoDocument, command: Command<unknown>): ExtrudoDocument {
  const store = createDocumentStore(doc);
  store.getState().dispatch(command);
  const after = store.getState().doc;
  const parsed = DocumentSchema.safeParse(after);
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  store.getState().undo();
  expect(store.getState().doc).toEqual(doc);
  store.getState().redo();
  expect(store.getState().doc).toEqual(after);
  return after;
}

function refused(doc: ExtrudoDocument, command: Command<unknown>): string {
  const store = createDocumentStore(doc);
  try {
    store.getState().dispatch(command);
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError);
    expect(store.getState().doc).toBe(doc);
    return (error as Error).message;
  }
  throw new Error('the command was not refused');
}

describe('addAnnotation', () => {
  it('gives #1, then #2, and moves the counter with it', () => {
    let doc = roundTrip(
      design(),
      addAnnotation({ id: aid('n1'), text: ' Hole M4 ', anchor: onFace }),
    );
    expect(doc.annotations).toEqual([{ id: 'n1', number: 1, text: 'Hole M4', anchor: onFace }]);
    expect(doc.annotationCounter).toBe(1);
    doc = roundTrip(
      doc,
      addAnnotation({ id: aid('n2'), text: 'Free', anchor: free, offset: [10, 20], done: true }),
    );
    expect(doc.annotations?.[1]).toEqual({
      id: 'n2',
      number: 2,
      text: 'Free',
      anchor: free,
      offset: [10, 20],
      done: true,
    });
    expect(doc.annotationCounter).toBe(2);
    expect(nextAnnotationNumber(doc)).toBe(3);
    expect(annotationByNumber(doc, 2)?.id).toBe('n2');
  });

  it('never gives a number again once it was deleted', () => {
    let doc = roundTrip(design(), addAnnotation({ id: aid('n1'), text: 'a', anchor: free }));
    doc = roundTrip(doc, addAnnotation({ id: aid('n2'), text: 'b', anchor: free }));
    doc = roundTrip(doc, removeAnnotation({ ids: [aid('n2')] }));
    expect(doc.annotationCounter).toBe(2);
    doc = roundTrip(doc, addAnnotation({ id: aid('n3'), text: 'c', anchor: free }));
    expect(doc.annotations?.map((a) => a.number)).toEqual([1, 3]);
  });

  it('undo gives the counter back with the annotation', () => {
    const store = createDocumentStore(design([note('n1', 1)], 1));
    store.getState().dispatch(addAnnotation({ id: aid('n2'), text: 'b', anchor: free }));
    expect(store.getState().doc.annotationCounter).toBe(2);
    store.getState().undo();
    expect(store.getState().doc.annotationCounter).toBe(1);
    store.getState().redo();
    expect(store.getState().doc.annotations?.[1]?.number).toBe(2);
  });

  it('takes a number past the counter (a rebuilt design), never one before it', () => {
    const doc = roundTrip(
      design([], 2),
      addAnnotation({ id: aid('n5'), text: 'x', anchor: free, number: 5 }),
    );
    expect(doc.annotations?.[0]?.number).toBe(5);
    expect(doc.annotationCounter).toBe(5);
    expect(refused(doc, addAnnotation({ id: aid('n6'), text: 'x', anchor: free, number: 4 }))).toBe(
      "Annotation #4 can't be given again: the next is #6.",
    );
  });

  it('anchors to a sketch and to a sketch entity', () => {
    const doc = roundTrip(
      design(),
      addAnnotation({
        id: aid('n1'),
        text: 'Here',
        anchor: { kind: 'sketch', sketch: fid('s1'), at: [1, 1], entity: eid('p1') },
      }),
    );
    expect(doc.annotations?.[0]?.anchor).toEqual({
      kind: 'sketch',
      sketch: 's1',
      at: [1, 1],
      entity: 'p1',
    });
  });

  it('refuses an empty text, a long one, an index reference, an unknown sketch or entity, a taken ID', () => {
    const doc = design([note('n1', 1)], 1);
    const add = (text: string, anchor: AnnotationAnchor, id = 'n9') =>
      refused(doc, addAnnotation({ id: aid(id), text, anchor }));
    expect(add('  ', free)).toBe("An annotation's text can't be empty.");
    expect(add('x'.repeat(2001), free)).toBe(
      "An annotation's text can be at most 2000 characters.",
    );
    expect(add('x', { ...onFace, ref: { kind: 'face', id: 'index:b1:face:3' } })).toBe(
      "An annotation can't keep an index reference: pick the geometry again.",
    );
    expect(add('x', { ...onFace, ref: { kind: 'profile', id: 's1/0' } } as never)).toBe(
      "An annotation can't sit on a profile.",
    );
    expect(add('x', { kind: 'sketch', sketch: fid('f2'), at: [0, 0] })).toBe(
      'There is no sketch f2.',
    );
    expect(add('x', { kind: 'sketch', sketch: fid('s1'), at: [0, 0], entity: eid('zz') })).toBe(
      'The sketch has no entity "zz".',
    );
    expect(add('x', free, 'n1')).toBe('Annotation n1 already exists.');
  });
});

describe('updateAnnotation, moveAnnotation, removeAnnotation', () => {
  const two = () => design([note('n1', 1), note('n2', 2, onFace)], 2);

  it('edits the text, the offset and the flags; false deletes a flag', () => {
    let doc = roundTrip(
      two(),
      updateAnnotation({
        id: aid('n1'),
        changes: { text: 'New text', offset: [5, 6], hidden: true, done: true },
      }),
    );
    expect(doc.annotations?.[0]).toEqual({
      ...note('n1', 1),
      text: 'New text',
      offset: [5, 6],
      hidden: true,
      done: true,
    });
    doc = roundTrip(
      doc,
      updateAnnotation({ id: aid('n1'), changes: { hidden: false, done: false } }),
    );
    expect(doc.annotations?.[0]).toEqual({ ...note('n1', 1), text: 'New text', offset: [5, 6] });
    expect(updateAnnotation({ id: aid('n1'), changes: {} }).label).toBe('Edit annotation');
  });

  it('refuses an empty text and an unknown annotation', () => {
    expect(refused(two(), updateAnnotation({ id: aid('n1'), changes: { text: '' } }))).toBe(
      "An annotation's text can't be empty.",
    );
    expect(refused(two(), updateAnnotation({ id: aid('zz'), changes: { done: true } }))).toBe(
      "Annotation zz doesn't exist.",
    );
  });

  it('moves an annotation onto other geometry and keeps its number', () => {
    const doc = roundTrip(two(), moveAnnotation({ id: aid('n1'), anchor: onFace }));
    expect(doc.annotations?.[0]).toEqual({ ...note('n1', 1), anchor: onFace });
    expect(
      refused(
        two(),
        moveAnnotation({
          id: aid('n1'),
          anchor: { kind: 'sketch', sketch: fid('nope'), at: [0, 0] },
        }),
      ),
    ).toBe('There is no sketch nope.');
  });

  it('deletes one or several; the list goes when empty, the counter stays', () => {
    expect(removeAnnotation({ ids: [aid('n1')] }).label).toBe('Delete annotation');
    expect(removeAnnotation({ ids: [aid('n1'), aid('n2')] }).label).toBe('Delete annotations');
    let doc = roundTrip(two(), removeAnnotation({ ids: [aid('n1')] }));
    expect(doc.annotations?.map((a) => a.id)).toEqual(['n2']);
    doc = roundTrip(doc, removeAnnotation({ ids: [aid('n2')] }));
    expect('annotations' in doc).toBe(false);
    expect(doc.annotationCounter).toBe(2);
    expect(refused(two(), removeAnnotation({ ids: [aid('n1'), aid('zz')] }))).toBe(
      "Annotation zz doesn't exist.",
    );
  });
});

describe('raiseAnnotationCounter', () => {
  it('moves the counter up, never down', () => {
    const doc = roundTrip(design([note('n1', 1)], 1), raiseAnnotationCounter({ counter: 4 }));
    expect(doc.annotationCounter).toBe(4);
    expect(nextAnnotationNumber(doc)).toBe(5);
    expect(roundTrip(doc, raiseAnnotationCounter({ counter: 4 })).annotationCounter).toBe(4);
    expect(refused(doc, raiseAnnotationCounter({ counter: 3 }))).toBe(
      "The annotation counter only grows: it is 4, so it can't be 3.",
    );
  });
});

describe('cascades (ADR-0126 §3)', () => {
  it('deleting a sketch takes its own annotations along, in the same step', () => {
    const doc = design(
      [
        note('n1', 1, { kind: 'sketch', sketch: fid('s1'), at: [0, 0] }),
        note('n2', 2, onFace),
        note('n3', 3, free),
      ],
      3,
    );
    const after = roundTrip(doc, removeFeature({ id: fid('s1') }));
    expect(after.annotations?.map((a) => a.id)).toEqual(['n2', 'n3']);
    expect(after.annotationCounter).toBe(3);
  });

  it('deleting another feature leaves model annotations alone (they detach at the recompute)', () => {
    const doc = design([note('n1', 1, onFace)], 1);
    const after = roundTrip(doc, removeFeature({ id: fid('f3') }));
    expect(after.annotations).toEqual(doc.annotations);
  });

  it('deleting a sketch entity clears `entity` and keeps the annotation where it was drawn', () => {
    const doc = design(
      [
        note('n1', 1, { kind: 'sketch', sketch: fid('s1'), at: [1, 2], entity: eid('p1') }),
        note('n2', 2, { kind: 'sketch', sketch: fid('s1'), at: [0, 1], entity: eid('l1') }),
        note('n3', 3, { kind: 'sketch', sketch: fid('s1'), at: [0, 0], entity: eid('k1') }),
      ],
      3,
    );
    const after = roundTrip(
      doc,
      removeFromSketch({ feature: fid('s1'), entities: [eid('p1'), eid('l1')] }),
    );
    expect(after.annotations?.map((a) => a.anchor)).toEqual([
      { kind: 'sketch', sketch: 's1', at: [6, 8] },
      { kind: 'sketch', sketch: 's1', at: [5, 3] },
      { kind: 'sketch', sketch: 's1', at: [0, 0], entity: 'k1' },
    ]);
  });

  it('a sketch change that removes an entity (trim, offset…) does the same', () => {
    const doc = design(
      [note('n1', 1, { kind: 'sketch', sketch: fid('s1'), at: [0, 0], entity: eid('p1') })],
      1,
    );
    const after = roundTrip(
      doc,
      modifySketch({ feature: fid('s1'), label: 'Trim', remove: { entities: [eid('p1')] } }),
    );
    expect(after.annotations?.[0]?.anchor).toEqual({ kind: 'sketch', sketch: 's1', at: [5, 6] });
  });

  it('restoreVersion brings back annotations, components and joints, and never lowers the counter', () => {
    const version: ExtrudoDocument = {
      ...design([note('n1', 1)], 1),
      components: [{ id: 'c1' as never, name: 'Lid', visible: true }],
    };
    const now = design([note('n1', 1), note('n4', 4, onFace)], 4);
    const after = roundTrip(now, restoreVersion({ doc: version }));
    expect(after.annotations).toEqual([note('n1', 1)]);
    expect(after.annotationCounter).toBe(4);
    expect(after.components).toEqual(version.components);
    // A version with none takes the current ones away.
    const bare = roundTrip(now, restoreVersion({ doc: design() }));
    expect(bare.annotations).toBeUndefined();
    expect(bare.annotationCounter).toBe(4);
  });

  it('remintAnnotations renames the references to reminted features', () => {
    const annotations = [
      note('n1', 1, {
        kind: 'model',
        ref: { kind: 'face', id: 'extrude:cmd.f2:cap:end' },
        at: [0, 0, 0],
      }),
      note('n2', 2, {
        kind: 'model',
        ref: { kind: 'sketchEntity', id: 'cmd.f1/l1' },
        at: [0, 0, 0],
      }),
      note('n3', 3, { kind: 'sketch', sketch: fid('cmd.f1'), at: [0, 0] }),
      note('n4', 4),
    ];
    const out = remintAnnotations(
      annotations,
      [{ id: fid('cmd.f1') }, { id: fid('cmd.f2') }],
      [fid('u1'), fid('u2')],
    );
    expect(out.map((a) => a.anchor)).toEqual([
      { kind: 'model', ref: { kind: 'face', id: 'extrude:u2:cap:end' }, at: [0, 0, 0] },
      { kind: 'model', ref: { kind: 'sketchEntity', id: 'u1/l1' }, at: [0, 0, 0] },
      { kind: 'sketch', sketch: 'u1', at: [0, 0] },
      free,
    ]);
  });
});

describe('helpers', () => {
  it("annotationEntityPoint is a point's position, a line's middle, a circle's centre", () => {
    const data = sketchData();
    expect(annotationEntityPoint(data, eid('p1'))).toEqual([5, 6]);
    expect(annotationEntityPoint(data, eid('l1'))).toEqual([5, 2]);
    expect(annotationEntityPoint(data, eid('k1'))).toEqual([-3, 2]);
    expect(annotationEntityPoint(data, eid('zz'))).toBeUndefined();
  });

  it('annotationAnchorProblem passes a free point and a known sketch', () => {
    const doc = design();
    expect(annotationAnchorProblem(doc, free)).toBeUndefined();
    expect(annotationAnchorProblem(doc, onFace)).toBeUndefined();
    expect(
      annotationAnchorProblem(doc, { kind: 'sketch', sketch: fid('s1'), at: [0, 0] }),
    ).toBeUndefined();
  });
});
