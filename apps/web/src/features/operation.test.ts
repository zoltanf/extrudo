import {
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  type GeomRef,
  originPlaneRef,
  sketchInputs,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { outline, profilesOf } from '../project/templates';
import { isOnBody, proposeSweep } from './operation';

const FACE: GeomRef = { kind: 'face', id: 'box:top' };

/** A document with one sketch, on the XY plane or on a face, and a profile of it. */
function withSketch(onFace: boolean) {
  const id = 'S' as FeatureId;
  const data = outline([
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ]);
  const feature: Feature = {
    id,
    type: 'sketch',
    name: 'Sketch1',
    suppressed: false,
    inputs: sketchInputs(onFace ? FACE : originPlaneRef('origin:xy'), data),
  };
  const doc = { features: [feature] } as unknown as ExtrudoDocument;
  return { doc, profile: profilesOf(id, data)[0] as GeomRef };
}

describe('the press-pull proposal rule', () => {
  it('counts faces, and profiles of a sketch on a face, as parts of a body', () => {
    const plain = withSketch(false);
    const lid = withSketch(true);
    expect(isOnBody(FACE)).toBe(true);
    expect(isOnBody(plain.profile, plain.doc)).toBe(false);
    expect(isOnBody(lid.profile, lid.doc)).toBe(true);
    // Without the document a profile can't be told from a plain one.
    expect(isOnBody(lid.profile)).toBe(false);
    expect(isOnBody({ kind: 'body', id: 'B:0' })).toBe(false);
  });

  it('makes a new body of profiles on a plane, whichever way they go', () => {
    const { doc, profile } = withSketch(false);
    for (const travel of ['out', 'in', 'both', undefined] as const) {
      expect(proposeSweep([profile], travel, doc)).toBe('new-body');
    }
  });

  it('joins what goes out of its body or both ways, and cuts what goes in', () => {
    const lid = withSketch(true);
    for (const pick of [FACE, lid.profile]) {
      expect(proposeSweep([pick], 'out', lid.doc)).toBe('join');
      expect(proposeSweep([pick], 'both', lid.doc)).toBe('join');
      expect(proposeSweep([pick], 'in', lid.doc)).toBe('cut');
    }
  });

  it('proposes nothing when nothing is picked, or when the way is unknown', () => {
    const lid = withSketch(true);
    expect(proposeSweep([], 'out')).toBeUndefined();
    expect(proposeSweep([FACE], undefined)).toBeUndefined();
    expect(proposeSweep([lid.profile], undefined, lid.doc)).toBeUndefined();
  });

  it('follows a mixed pick by its face: one part of a body makes the sweep join or cut', () => {
    const plain = withSketch(false);
    expect(proposeSweep([plain.profile, FACE], 'in', plain.doc)).toBe('cut');
  });
});
