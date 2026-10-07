/**
 * The face roles of ADR-0068 §4: every feature that makes or changes a body
 * lists the roles its faces are named with, a pattern matches a role, and the
 * patterns say what the API's `handle.face(role)` builds. The kernel's
 * `features/face-roles.test.ts` checks the lists against real geometry; this
 * checks the lists against themselves (nothing is missing, every pattern
 * matches something, the shared lists are used where they apply).
 */
import { describe, expect, it } from 'vitest';
import {
  faceRoleIssues,
  faceRolePattern,
  KEEPS_FACE_ROLES,
  matchesFaceRole,
  ownFaceRole,
} from './face-roles';
import { documentFeatures } from './registry';

/**
 * The features that make no face of its own, and why. Every other feature in
 * the registry that makes or changes a body must list its roles.
 */
const NAMES_NO_FACE: Readonly<Record<string, string>> = {
  sketch: 'a sketch makes no body',
  remove: 'Remove takes bodies away',
  offsetFace: 'every face keeps the name it had (ADR-0051)',
  draft: 'every face keeps the name it had (ADR-0053)',
  placeOnBed: 'it is a transform, so every face keeps its name (ADR-0048)',
  canvas: 'a canvas is a picture on a plane, not a body (P4-06)',
  script:
    'a script names no face itself: the features it generates do, under their own IDs (ADR-0070)',
  plugin:
    "a plugin feature names no face itself: its handler's features do, under their own IDs (ADR-0077)",
};

describe('the face roles of the registry', () => {
  it('lists roles for every feature that makes or changes a body', () => {
    const missing: string[] = [];
    for (const definition of documentFeatures().list()) {
      if (definition.category === 'construct') continue; // planes, axes and points
      if (NAMES_NO_FACE[definition.type]) {
        expect(definition.faceRoles, definition.type).toBeUndefined();
        continue;
      }
      if (!definition.faceRoles?.length) missing.push(definition.type);
    }
    expect(missing).toEqual([]);
  });

  it('gives every role a pattern that matches itself and a line of prose', () => {
    for (const definition of documentFeatures().list()) {
      for (const role of definition.faceRoles ?? []) {
        expect(matchesFaceRole([role], role.pattern), `${definition.type}: ${role.pattern}`).toBe(
          true,
        );
        expect(role.description.length, `${definition.type}: ${role.pattern}`).toBeGreaterThan(20);
        // No pattern may match a role of another feature's shape by accident:
        // it is a matcher, not a prefix test.
        expect(faceRolePattern(role.pattern).source.startsWith('^')).toBe(true);
      }
    }
  });

  it('reuses the shared lists where the kernel names the same way', () => {
    const registry = documentFeatures();
    // Every swept solid names its caps and sides the same way (`nameSweep`).
    for (const type of ['extrude', 'revolve', 'sweep', 'loft', 'coil', 'emboss']) {
      expect(registry.get(type)?.faceRoles?.[0]?.pattern, type).toBe('cap:start');
    }
    // Every feature that keeps the names of the faces it is made of lists the
    // same two: the faces a boolean or a transform generates, and the fallback.
    for (const type of ['combine', 'move', 'mirror', 'scale']) {
      expect(registry.get(type)?.faceRoles, type).toEqual(KEEPS_FACE_ROLES);
    }
  });
});

describe('the matcher', () => {
  it('reads the role out of a face name, and only of its own feature', () => {
    expect(ownFaceRole('f1', 'extrude:f1:cap:end')).toBe('cap:end');
    expect(ownFaceRole('f1', 'extrude:f1:side:l3')).toBe('side:l3');
    expect(ownFaceRole('f1', 'fillet:f1:from:(extrude:f1:side:l3)')).toBe(
      'from:(extrude:f1:side:l3)',
    );
    // A face an operation split in two: the `#n` is not part of the role.
    expect(ownFaceRole('f1', 'split:f1:cut:above#2')).toBe('cut:above');
    // Another feature's name is none of this one's business.
    expect(ownFaceRole('f1', 'extrude:f2:cap:end')).toBeUndefined();
    expect(ownFaceRole('f1', 'e[extrude:f1:cap:end|extrude:f1:side:l3]')).toBeUndefined();
  });

  it('matches `<…>` as whatever varies, and nothing else', () => {
    const roles = [{ pattern: 'side:<curve>', description: 'a wall' }];
    expect(matchesFaceRole(roles, 'side:l3')).toBe(true);
    expect(matchesFaceRole(roles, 'side:(extrude:f1:cap:end)')).toBe(true);
    expect(matchesFaceRole(roles, 'cap:start')).toBe(false);
    expect(matchesFaceRole(roles, 'side2:l3')).toBe(false);
    expect(matchesFaceRole(undefined, 'side:l3')).toBe(false);
  });

  it('reports only the names a feature made itself', () => {
    const roles = documentFeatures().get('extrude')?.faceRoles;
    expect(
      faceRoleIssues(roles, 'f1', [
        'extrude:f1:cap:start',
        'extrude:f1:side:l3#2',
        // Another feature's faces, which an operation kept.
        'box:b1:side:top',
        'fillet:f9:from:(extrude:f1:side:l3)',
      ]),
    ).toEqual([]);
    expect(faceRoleIssues(roles, 'f1', ['extrude:f1:cap:middle'])).toEqual(['"cap:middle"']);
  });
});
