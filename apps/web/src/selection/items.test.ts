import { type BodyId, createSessionStore, type SelectionItem } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import {
  isIndexRef,
  pruneSelection,
  readTopology,
  selectedTopology,
  selectionKey,
  selectionRefs,
  selectionSummary,
  topologyItem,
  topologyRef,
} from './items';
import { boxMesh } from './testing';

const A = 'body-a' as BodyId;
const mesh = boxMesh();
const named = {
  ...mesh,
  faceIds: ['f0', 'f1', 'f2', 'f3', 'f4', 'f5'],
  edgeIds: [],
  vertexIds: [],
};

describe('topology items', () => {
  it('round-trips through the session form', () => {
    for (const item of [
      { kind: 'face', body: A, index: 3 },
      { kind: 'edge', body: A, index: 0 },
      { kind: 'vertex', body: A, index: 7 },
      { kind: 'body', body: A, index: 0 },
    ] as const) {
      expect(readTopology(topologyItem(item))).toEqual(item);
    }
    expect(topologyItem({ kind: 'face', body: A, index: 3 })).toEqual({
      kind: 'face',
      id: 'body-a:3',
    });
    expect(readTopology({ kind: 'profile', id: 's/r1' })).toBeUndefined();
    expect(readTopology({ kind: 'face', id: 'nonsense' })).toBeUndefined();
  });

  it('gives persistent references when the mesh has IDs, index references on request', () => {
    const face = { kind: 'face', body: A, index: 2 } as const;
    expect(topologyRef(face, { [A]: named })).toEqual({ kind: 'face', id: 'f2' });
    expect(topologyRef(face, { [A]: mesh })).toBeUndefined();
    const fallback = topologyRef(face, { [A]: mesh }, { indexFallback: true });
    expect(fallback).toEqual({ kind: 'face', id: 'index:body-a:2' });
    expect(fallback && isIndexRef(fallback)).toBe(true);
    expect(topologyRef({ kind: 'body', body: A, index: 0 }, { [A]: mesh })).toEqual({
      kind: 'body',
      id: A,
    });
    // Gone or out of range.
    expect(topologyRef({ ...face, index: 6 }, { [A]: named })).toBeUndefined();
    expect(topologyRef(face, {})).toBeUndefined();
  });

  it('turns a selection into references', () => {
    const selection: SelectionItem[] = [
      { kind: 'face', id: 'body-a:1' },
      { kind: 'edge', id: 'body-a:4' },
      { kind: 'profile', id: 's/r1' },
      { kind: 'sketchEntity', id: 's/l1' },
      { kind: 'sketchEntity', id: 'bare' },
      { kind: 'feature', id: 'f' },
    ];
    expect(selectionRefs(selection, { [A]: named })).toEqual([
      { kind: 'face', id: 'f1' },
      { kind: 'profile', id: 's/r1' },
      { kind: 'sketchEntity', id: 's/l1' },
    ]);
  });

  it('reads the topology selected in the session', () => {
    const session = createSessionStore();
    session
      .getState()
      .select([topologyItem({ kind: 'face', body: A, index: 1 }), { kind: 'profile', id: 's/r' }]);
    expect(selectedTopology(session)).toEqual([{ kind: 'face', body: A, index: 1 }]);
  });
});

describe('pruneSelection', () => {
  const selection: SelectionItem[] = [
    { kind: 'face', id: 'body-a:1' },
    { kind: 'body', id: 'body-a' },
    { kind: 'profile', id: 's/r' },
  ];

  it('keeps a selection on an unchanged mesh as it is', () => {
    expect(pruneSelection(selection, { [A]: mesh }, { [A]: mesh })).toBe(selection);
  });

  it('drops items of bodies that are gone and indices on new meshes', () => {
    expect(pruneSelection(selection, { [A]: mesh }, {})).toEqual([{ kind: 'profile', id: 's/r' }]);
    expect(pruneSelection(selection, { [A]: mesh }, { [A]: boxMesh() })).toEqual([
      { kind: 'body', id: 'body-a' },
      { kind: 'profile', id: 's/r' },
    ]);
  });

  it('follows persistent IDs to their new index', () => {
    const moved = { ...boxMesh(), faceIds: ['f1', 'f0', 'f2', 'f3', 'f4', 'f5'] };
    expect(pruneSelection(selection, { [A]: named }, { [A]: moved })).toEqual([
      { kind: 'face', id: 'body-a:0' },
      { kind: 'body', id: 'body-a' },
      { kind: 'profile', id: 's/r' },
    ]);
  });
});

describe('selectionSummary', () => {
  it('counts each kind', () => {
    expect(selectionSummary([])).toBe('');
    expect(
      selectionSummary([
        { kind: 'face', id: 'a:1' },
        { kind: 'face', id: 'a:2' },
      ]),
    ).toBe('2 faces');
    expect(
      selectionSummary([
        { kind: 'edge', id: 'a:1' },
        { kind: 'vertex', id: 'a:1' },
        { kind: 'vertex', id: 'a:2' },
        { kind: 'body', id: 'a' },
      ]),
    ).toBe('1 edge, 2 vertices, 1 body');
    expect(
      selectionSummary([
        { kind: 'sketchEntity', id: 's/l1' },
        { kind: 'sketchEntity', id: 'p1' },
      ]),
    ).toBe('1 sketch curve, 1 sketch entity');
  });

  it('keys items for tests', () => {
    expect(selectionKey([{ kind: 'face', id: 'a:1' }, undefined, { kind: 'body', id: 'a' }])).toBe(
      'face:a:1 body:a',
    );
  });
});
