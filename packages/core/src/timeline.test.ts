import { describe, expect, it } from 'vitest';
import { CommandError } from './commands';
import { createDocument } from './document';
import { moveTimelineMarker } from './document-commands';
import { extrudeInputs } from './extrude';
import type { ProjectionId } from './ids';
import type { ExtrudoDocument, Feature, GeomRef } from './schema';
import { redefineSketchPlane } from './sketch/commands';
import { emptySketchData, sketchInputs } from './sketch/feature';
import { originPlaneRef } from './sketch/planes';
import { createDocumentStore } from './stores';
import { fid } from './testing';
import {
  moveFeature,
  moveFeatures,
  moveFeaturesProblem,
  moveProblem,
  referencedFeatures,
  replaceReferences,
  storedRefs,
  timelineDependencies,
} from './timeline';

const top: GeomRef = {
  kind: 'face',
  id: 'extrude:E1:cap:end',
  fingerprint: { type: 'plane', at: [0, 0, 15], dir: [0, 0, 1], size: 2400 },
};

function sketch(id: string, name: string, plane: GeomRef): Feature {
  return { id: fid(id), type: 'sketch', name, suppressed: false, inputs: sketchInputs(plane) };
}

function extrude(id: string, name: string, profiles: string[], bodies?: string[]): Feature {
  return {
    id: fid(id),
    type: 'extrude',
    name,
    suppressed: false,
    inputs: extrudeInputs(
      profiles.map((p) => ({ kind: 'profile', id: p })),
      bodies ? { operation: 'join', bodies } : {},
    ),
  };
}

/**
 * Sketch1 (XY) → Extrude1 → Sketch2 on Extrude1's top face → Extrude2
 * joining Extrude1's body; Sketch3 on XZ uses nothing. Marker at `marker`.
 */
function timeline(marker = 5): ExtrudoDocument {
  const features = [
    sketch('S1', 'Sketch1', originPlaneRef('origin:xy')),
    extrude('E1', 'Extrude1', ['S1/r1']),
    sketch('S2', 'Sketch2', top),
    extrude('E2', 'Extrude2', ['S2/r2'], ['E1:0']),
    sketch('S3', 'Sketch3', originPlaneRef('origin:xz')),
  ];
  return { ...createDocument({ name: 'Timeline' }), features, timelineMarker: marker };
}

const order = (doc: ExtrudoDocument) => doc.features.map((f) => f.id).join(' ');

describe('feature dependencies', () => {
  it('come from profiles, bodies and persistent face names', () => {
    const deps = timelineDependencies(timeline());
    expect(deps.get(fid('S1'))).toEqual([]);
    expect(deps.get(fid('E1'))).toEqual(['S1']);
    expect(deps.get(fid('S2'))).toEqual(['E1']);
    expect(deps.get(fid('E2'))?.sort()).toEqual(['E1', 'S2']);
    expect(deps.get(fid('S3'))).toEqual([]);
  });

  it("include a sketch's projection sources, but not the feature itself", () => {
    const data = emptySketchData();
    data.projections = {
      ['p1' as ProjectionId]: {
        ref: { kind: 'edge', id: 'e[extrude:E1:cap:end|extrude:E1:side:l1]' },
        curves: {},
      },
    };
    const s = { id: fid('S4'), inputs: sketchInputs({ kind: 'face', id: 'extrude:S4:x' }, data) };
    expect(storedRefs(s).map((r) => r.projection ?? r.input)).toEqual(['plane', 'p1']);
    expect(referencedFeatures(s, new Set(['E1', 'S4', 'l1']))).toEqual(['E1', 'l1']);
  });

  it('treat a whole-text reference like a profile reference (P4-03, ADR-0058 §5)', () => {
    const text: GeomRef = { kind: 'sketchEntity', id: 'S1/t9' };
    const e = {
      id: fid('E3'),
      type: 'extrude',
      name: 'Extrude3',
      suppressed: false,
      inputs: extrudeInputs([text]),
    } as Feature;
    expect(referencedFeatures(e, new Set(['S1', 'E3']))).toEqual(['S1']);
    const doc = {
      ...createDocument({ name: 'Timeline' }),
      features: [sketch('S1', 'Sketch1', originPlaneRef('origin:xy')), e],
      timelineMarker: 2,
    };
    expect(timelineDependencies(doc).get(fid('E3'))).toEqual([fid('S1')]);
    // Moving the extrude before its sketch is refused, like a profile's.
    expect(moveProblem(doc, fid('E3'), 0)).toContain('uses Sketch1');
  });
});

describe('moveFeature', () => {
  it('moves a feature that nothing ties down, as one undo step', () => {
    const store = createDocumentStore(timeline());
    store.getState().dispatch(moveFeature({ id: fid('S3'), index: 0 }));
    expect(order(store.getState().doc)).toBe('S3 S1 E1 S2 E2');
    expect(store.getState().doc.timelineMarker).toBe(5);
    expect(store.getState().undoLabel).toBe('Move feature');
    store.getState().dispatch(moveFeature({ id: fid('S3'), index: 2 }));
    expect(order(store.getState().doc)).toBe('S1 E1 S3 S2 E2');
    store.getState().undo();
    store.getState().undo();
    expect(order(store.getState().doc)).toBe('S1 E1 S2 E2 S3');
  });

  it('refuses to put a feature before what it uses, or after what uses it', () => {
    const doc = timeline();
    expect(moveProblem(doc, fid('S2'), 0)).toBe(
      "Can't move Sketch2 before Extrude1: Sketch2 uses Extrude1.",
    );
    expect(moveProblem(doc, fid('E2'), 2)).toBe(
      "Can't move Extrude2 before Sketch2: Extrude2 uses Sketch2.",
    );
    // It uses both: the message names the nearer one.
    expect(moveProblem(doc, fid('E2'), 1)).toBe(
      "Can't move Extrude2 before Extrude1: Extrude2 uses Extrude1.",
    );
    expect(moveProblem(doc, fid('E1'), 4)).toBe(
      "Can't move Extrude1 after Extrude2: Extrude2 uses Extrude1.",
    );
    expect(moveProblem(doc, fid('S1'), 2)).toBe(
      "Can't move Sketch1 after Extrude1: Extrude1 uses Sketch1.",
    );
    expect(moveProblem(doc, fid('S1'), 5)).toBe("Can't move Sketch1 to position 5.");
    expect(moveProblem(doc, fid('S2'), 2)).toBeUndefined();
    expect(moveProblem(doc, fid('S3'), 2)).toBeUndefined();

    const store = createDocumentStore(doc);
    expect(() => store.getState().dispatch(moveFeature({ id: fid('E1'), index: 4 }))).toThrow(
      CommandError,
    );
    expect(store.getState().doc).toBe(doc);
    expect(store.getState().canUndo).toBe(false);
  });

  it('keeps the marker between the same features', () => {
    // Sketch1 Extrude1 Sketch2 | Extrude2 Sketch3
    const store = createDocumentStore(timeline(3));
    const s = store.getState;
    // Among the active features it becomes active.
    s().dispatch(moveFeature({ id: fid('S3'), index: 1 }));
    expect(order(s().doc)).toBe('S1 S3 E1 S2 E2');
    expect(s().doc.timelineMarker).toBe(4);
    // Past the marker, rolled back.
    s().dispatch(moveFeature({ id: fid('S3'), index: 4 }));
    expect(order(s().doc)).toBe('S1 E1 S2 E2 S3');
    expect(s().doc.timelineMarker).toBe(3);
    // Right at the marker it keeps its state, unless told.
    s().dispatch(moveFeature({ id: fid('S3'), index: 3 }));
    expect(order(s().doc)).toBe('S1 E1 S2 S3 E2');
    expect(s().doc.timelineMarker).toBe(3);
    s().dispatch(moveFeature({ id: fid('S3'), index: 3, active: true }));
    expect(s().doc.timelineMarker).toBe(4);
    s().dispatch(moveFeature({ id: fid('S3'), index: 3, active: false }));
    expect(s().doc.timelineMarker).toBe(3);
    // Nothing changes: no undo step.
    const steps = s().undoLabel;
    const before = s().doc;
    s().dispatch(moveFeature({ id: fid('S3'), index: 3 }));
    expect(s().doc).toBe(before);
    expect(s().undoLabel).toBe(steps);
    // Undo restores order and marker together.
    s().undo();
    expect(s().doc.timelineMarker).toBe(4);
    s().undo();
    s().undo();
    s().undo();
    s().undo();
    expect(order(s().doc)).toBe('S1 E1 S2 E2 S3');
    expect(s().doc.timelineMarker).toBe(3);
  });

  it('moves a feature to the end with the marker there too', () => {
    const store = createDocumentStore(timeline());
    // Already there: no step.
    store.getState().dispatch(moveFeature({ id: fid('S3'), index: 4 }));
    expect(store.getState().canUndo).toBe(false);
    store.getState().dispatch(moveFeature({ id: fid('S3'), index: 0 }));
    store.getState().dispatch(moveFeature({ id: fid('S3'), index: 4 }));
    expect(store.getState().doc.timelineMarker).toBe(5);
    expect(() => store.getState().dispatch(moveFeature({ id: fid('S2'), index: 4 }))).toThrow(
      "Can't move Sketch2 after Extrude2: Extrude2 uses Sketch2.",
    );
    expect(order(store.getState().doc)).toBe('S1 E1 S2 E2 S3');
  });
});

describe('moveFeatures (P3-17)', () => {
  it('moves several features as a block, in their order, as one undo step', () => {
    const store = createDocumentStore(timeline());
    const s = store.getState;
    // Sketch2 and Extrude2 together go to the end, after Sketch3.
    s().dispatch(moveFeatures({ ids: [fid('E2'), fid('S2')], index: 3 }));
    expect(order(s().doc)).toBe('S1 E1 S3 S2 E2');
    expect(s().undoLabel).toBe('Move features');
    expect(s().doc.timelineMarker).toBe(5);
    // Sketch1 and Sketch3 to the front (Sketch3 lands after Sketch1, keeping the order).
    s().dispatch(moveFeatures({ ids: [fid('S3'), fid('S1')], index: 0 }));
    expect(order(s().doc)).toBe('S1 S3 E1 S2 E2');
    s().undo();
    s().undo();
    expect(order(s().doc)).toBe('S1 E1 S2 E2 S3');
  });

  it('refuses a block that would break a reference, naming it', () => {
    const doc = timeline();
    // Sketch2 and Extrude2 before Extrude1, which Sketch2 sits on.
    expect(moveFeaturesProblem(doc, [fid('S2'), fid('E2')], 0)).toBe(
      "Can't move Sketch2 before Extrude1: Sketch2 uses Extrude1.",
    );
    // Sketch1 and Sketch3 after Extrude1: Extrude1 uses Sketch1.
    expect(moveFeaturesProblem(doc, [fid('S1'), fid('S3')], 3)).toBe(
      "Can't move Sketch1 after Extrude1: Extrude1 uses Sketch1.",
    );
    expect(moveFeaturesProblem(doc, [fid('S1'), fid('E1')], 4)).toBe(
      "Can't move 2 features to position 4.",
    );
    expect(moveFeaturesProblem(doc, [fid('S1'), fid('E1')], 3)).toBe(
      "Can't move Extrude1 after Sketch2: Sketch2 uses Extrude1.",
    );
    expect(moveFeaturesProblem(doc, [fid('S2'), fid('E2')], 3)).toBeUndefined();
    // One feature: moveProblem's wording.
    expect(moveFeaturesProblem(doc, [fid('S2')], 0)).toBe(moveProblem(doc, fid('S2'), 0));
    const store = createDocumentStore(doc);
    expect(() =>
      store.getState().dispatch(moveFeatures({ ids: [fid('S1'), fid('E1')], index: 3 })),
    ).toThrow(CommandError);
    expect(store.getState().canUndo).toBe(false);
  });

  it('keeps the marker between the same other features', () => {
    // Sketch1 Extrude1 Sketch2 | Extrude2 Sketch3
    const store = createDocumentStore(timeline(3));
    const s = store.getState;
    // Sketch2 (active) and Sketch3 (rolled back) to the front: both active.
    s().dispatch(moveFeatures({ ids: [fid('S2'), fid('S3')], index: 2 }));
    expect(order(s().doc)).toBe('S1 E1 S2 S3 E2');
    // At the marker (2 other active features): not all were active, so rolled back.
    expect(s().doc.timelineMarker).toBe(2);
    s().dispatch(moveFeatures({ ids: [fid('S2'), fid('S3')], index: 2, active: true }));
    expect(s().doc.timelineMarker).toBe(4);
    // Nothing changes: no new step.
    const before = s().doc;
    s().dispatch(moveFeatures({ ids: [fid('S2'), fid('S3')], index: 2 }));
    expect(s().doc).toBe(before);
  });
});

describe('moveTimelineMarker', () => {
  it('rolls back to any position, one step each', () => {
    const store = createDocumentStore(timeline());
    store.getState().dispatch(moveTimelineMarker({ index: 2 }));
    expect(store.getState().doc.timelineMarker).toBe(2);
    store.getState().undo();
    expect(store.getState().doc.timelineMarker).toBe(5);
  });
});

describe('replaceReferences', () => {
  const side: GeomRef = { kind: 'face', id: 'extrude:E1:side:l9', fingerprint: top.fingerprint };

  it('replaces a reference in every input that stores it, as one undo step', () => {
    const doc = timeline();
    const store = createDocumentStore(doc);
    store
      .getState()
      .dispatch(replaceReferences({ id: fid('S2'), replace: [{ from: top, to: side }] }));
    const plane = store.getState().doc.features[2]?.inputs.plane;
    expect(plane).toEqual({ kind: 'ref', refs: [side] });
    expect(store.getState().undoLabel).toBe('Fix references');
    store.getState().undo();
    expect(store.getState().doc).toEqual(doc);
  });

  it('removes a lost profile, but never the plane a sketch lies on', () => {
    const store = createDocumentStore(timeline());
    store.getState().dispatch(
      replaceReferences({
        id: fid('E2'),
        replace: [{ from: { kind: 'body', id: 'E1:0' }, to: null }],
      }),
    );
    expect(store.getState().doc.features[3]?.inputs.bodies).toEqual({ kind: 'ref', refs: [] });
    expect(() =>
      store
        .getState()
        .dispatch(replaceReferences({ id: fid('S2'), replace: [{ from: top, to: null }] })),
    ).toThrow('Sketch2 needs a plane or a flat face to lie on.');
  });

  it('refuses references to later features, and references it lacks', () => {
    const store = createDocumentStore(timeline());
    const later: GeomRef = { kind: 'face', id: 'extrude:E2:cap:end' };
    expect(() =>
      store
        .getState()
        .dispatch(replaceReferences({ id: fid('S2'), replace: [{ from: top, to: later }] })),
    ).toThrow("Sketch2 can't use geometry of Extrude2, which comes after it in the timeline.");
    expect(() =>
      store
        .getState()
        .dispatch(replaceReferences({ id: fid('S1'), replace: [{ from: top, to: null }] })),
    ).toThrow('Sketch1 has none of those references.');
  });

  it('updates the source of a projection', () => {
    const data = emptySketchData();
    const edge: GeomRef = { kind: 'edge', id: 'e[extrude:E1:cap:end|extrude:E1:side:l1]' };
    data.projections = { ['p1' as ProjectionId]: { ref: edge, curves: {} } };
    const doc = timeline();
    const s4: Feature = {
      id: fid('S4'),
      type: 'sketch',
      name: 'Sketch4',
      suppressed: false,
      inputs: sketchInputs(originPlaneRef('origin:xy'), data),
    };
    const store = createDocumentStore({
      ...doc,
      features: [...doc.features, s4],
      timelineMarker: 6,
    });
    const moved: GeomRef = { kind: 'edge', id: 'e[extrude:E1:cap:end|extrude:E1:side:l2]' };
    store
      .getState()
      .dispatch(replaceReferences({ id: fid('S4'), replace: [{ from: edge, to: moved }] }));
    const input = store.getState().doc.features[5]?.inputs.sketch;
    expect(
      input?.kind === 'sketchData' && input.sketch.projections?.['p1' as ProjectionId]?.ref,
    ).toEqual(moved);
  });
});

describe('redefineSketchPlane', () => {
  it('puts a sketch on another plane or an earlier face, as one undo step', () => {
    const doc = timeline();
    const store = createDocumentStore(doc);
    store
      .getState()
      .dispatch(redefineSketchPlane({ id: fid('S2'), plane: originPlaneRef('origin:xz') }));
    expect(store.getState().doc.features[2]?.inputs.plane).toEqual({
      kind: 'ref',
      refs: [originPlaneRef('origin:xz')],
    });
    expect(store.getState().undoLabel).toBe('Redefine sketch plane');
    store.getState().dispatch(redefineSketchPlane({ id: fid('S3'), plane: top }));
    store.getState().undo();
    store.getState().undo();
    expect(store.getState().doc).toEqual(doc);
  });

  it('refuses faces of later features, non-planes and non-sketches', () => {
    const store = createDocumentStore(timeline());
    const later: GeomRef = { kind: 'face', id: 'extrude:E2:side:l1' };
    const dispatch = (id: string, plane: GeomRef) =>
      store.getState().dispatch(redefineSketchPlane({ id: fid(id), plane }));
    expect(() => dispatch('S2', later)).toThrow(
      "Sketch2 can't use geometry of Extrude2, which comes after it in the timeline.",
    );
    expect(() => dispatch('S1', top)).toThrow(
      "Sketch1 can't use geometry of Extrude1, which comes after it in the timeline.",
    );
    expect(() => dispatch('S2', { kind: 'edge', id: 'e[a|b]' })).toThrow(
      'A sketch needs a plane or a flat face.',
    );
    expect(() => dispatch('E1', originPlaneRef('origin:xy'))).toThrow("isn't a sketch");
    expect(store.getState().canUndo).toBe(false);
  });
});
