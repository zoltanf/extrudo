import { describe, expect, it } from 'vitest';
import type { HistoryRecord } from '../history';
import type { Vec3 } from '../kernel';
import type { ShapeDescription } from './description';
import { fingerprintOf, fingerprintScore } from './fingerprint';
import { deriveNames, nameSweep, positionalNames, propagateNames } from './names';

/** Faces at the given centroids; edges between the listed faces; a vertex per edge end. */
function shape(
  faces: Vec3[],
  edges: { faces: number[]; at: Vec3 }[] = [],
  vertices: { faces: number[]; at: Vec3 }[] = [],
): ShapeDescription {
  return {
    faces: faces.map((centroid) => ({ type: 'plane', area: 1, centroid, direction: [0, 0, 1] })),
    edges: edges.map((e) => ({ type: 'line', length: 1, midpoint: e.at, faces: e.faces })),
    vertices: vertices.map((v) => ({ point: v.at, faces: v.faces })),
  };
}

describe('deriveNames', () => {
  it('numbers faces sharing a name by position: x, then y, then z', () => {
    const d = shape([
      [5, 0, 0],
      [1, 9, 0],
      [1, 2, 0],
      [0, 0, 0],
    ]);
    expect(deriveNames(['a', 'a', 'a', 'b'], d).faces).toEqual(['a#3', 'a#2', 'a#1', 'b']);
  });

  it('names edges and vertices after their faces, @n by position where they repeat', () => {
    const d = shape(
      [
        [0, 0, 0],
        [0, 0, 1],
      ],
      [
        { faces: [0, 1], at: [3, 0, 0] },
        { faces: [1, 0], at: [1, 0, 0] },
        { faces: [0], at: [0, 0, 0] },
      ],
      [{ faces: [1, 0, 1], at: [0, 0, 0] }],
    );
    const names = deriveNames(['top', 'side'], d);
    expect(names.edges).toEqual(['e[side|top]@2', 'e[side|top]@1', 'e[top]']);
    expect(names.vertices).toEqual(['v[side|top]']);
  });

  it('keeps numbering until every name differs', () => {
    // Splitting `a` into two meets an `a#1` that already existed.
    const d = shape([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
    const faces = deriveNames(['a', 'a', 'a#1'], d).faces;
    expect(new Set(faces).size).toBe(3);
  });

  it('refuses a face list of the wrong length', () => {
    expect(() => deriveNames(['a'], shape([]))).toThrow(/1 face names for 0 faces/);
  });
});

describe('nameSweep', () => {
  it('names caps from first/last and sides from the edge sources', () => {
    const d = shape([
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 0],
      [1, 1, 0],
    ]);
    const history: HistoryRecord[] = [
      {
        input: 0,
        from: { kind: 'face', index: 0 },
        relation: 'first',
        to: [{ kind: 'face', index: 0 }],
      },
      {
        input: 0,
        from: { kind: 'face', index: 0 },
        relation: 'last',
        to: [{ kind: 'face', index: 1 }],
      },
      {
        input: 0,
        from: { kind: 'edge', index: 0 },
        relation: 'generated',
        to: [{ kind: 'face', index: 2 }],
      },
      {
        input: 0,
        from: { kind: 'edge', index: 1 },
        relation: 'generated',
        to: [{ kind: 'face', index: 3 }],
      },
      // Vertices generate edges, which are named from faces instead.
      {
        input: 0,
        from: { kind: 'vertex', index: 0 },
        relation: 'generated',
        to: [{ kind: 'edge', index: 0 }],
      },
    ];
    const names = nameSweep({
      op: 'extrude',
      feature: 'F',
      history,
      edgeSources: ['l1'],
      result: d,
    });
    expect(names.faces).toEqual([
      'extrude:F:cap:start',
      'extrude:F:cap:end',
      'extrude:F:side:l1',
      'extrude:F:side:_',
    ]);
  });
});

describe('propagateNames', () => {
  const inputs = [
    { faces: ['a', 'b'], edges: ['e[a|b]'], vertices: [] },
    { faces: ['t'], edges: ['e[t]'], vertices: [] },
  ];

  it('keeps kept and modified names, numbers split pieces, prefers the target on merges', () => {
    const d = shape([
      [0, 0, 0],
      [2, 0, 0],
      [1, 0, 0],
      [5, 0, 0],
    ]);
    const history: HistoryRecord[] = [
      // a split into faces 0 and 2; b merged with t into face 3; t also kept as 1.
      {
        input: 0,
        from: { kind: 'face', index: 0 },
        relation: 'modified',
        to: [
          { kind: 'face', index: 0 },
          { kind: 'face', index: 2 },
        ],
      },
      {
        input: 1,
        from: { kind: 'face', index: 0 },
        relation: 'modified',
        to: [{ kind: 'face', index: 3 }],
      },
      {
        input: 0,
        from: { kind: 'face', index: 1 },
        relation: 'modified',
        to: [{ kind: 'face', index: 3 }],
      },
      {
        input: 1,
        from: { kind: 'face', index: 0 },
        relation: 'kept',
        to: [{ kind: 'face', index: 1 }],
      },
    ];
    const names = propagateNames({ op: 'boolean', feature: 'G', inputs, history, result: d });
    expect(names.faces).toEqual(['a#1', 't', 'a#2', 'b']);
  });

  it('names generated faces after their source and the rest as new', () => {
    const d = shape([
      [0, 0, 0],
      [1, 0, 0],
    ]);
    const history: HistoryRecord[] = [
      {
        input: 0,
        from: { kind: 'edge', index: 0 },
        relation: 'generated',
        to: [{ kind: 'face', index: 0 }],
      },
      { input: 0, from: { kind: 'edge', index: 0 }, relation: 'deleted', to: [] },
    ];
    const names = propagateNames({ op: 'fillet', feature: 'G', inputs, history, result: d });
    expect(names.faces).toEqual(['fillet:G:from:(e[a|b])', 'fillet:G:new']);
  });
});

describe('positionalNames', () => {
  it('names faces by position when there is no history', () => {
    const d = shape([
      [1, 0, 0],
      [0, 0, 0],
    ]);
    expect(positionalNames('box', 'F', d).faces).toEqual(['box:F:face#2', 'box:F:face#1']);
  });
});

describe('fingerprints', () => {
  const d: ShapeDescription = {
    faces: [
      { type: 'plane', area: 100, centroid: [5, 5, 10], direction: [0, 0, 1] },
      { type: 'plane', area: 40, centroid: [0, 5, 5], direction: [-1, 0, 0] },
      { type: 'cylinder', area: 60, centroid: [5, 5, 5], direction: [0, 0, 1] },
    ],
    edges: [
      { type: 'line', length: 10, midpoint: [0, 5, 10], direction: [0, 1, 0], faces: [0, 1] },
    ],
    vertices: [{ point: [0, 0, 10], faces: [0, 1] }],
  };
  const names = {
    faces: ['top', 'left#1', 'hole'],
    edges: ['e[left#1|top]'],
    vertices: ['v[left#1|top]'],
  };

  it('records type, position, direction, size and neighbours', () => {
    expect(fingerprintOf(d, names, 'face', 0)).toEqual({
      type: 'plane',
      at: [5, 5, 10],
      dir: [0, 0, 1],
      size: 100,
      adj: ['left#1'],
    });
    expect(fingerprintOf(d, names, 'edge', 0)).toEqual({
      type: 'line',
      at: [0, 5, 10],
      dir: [0, 1, 0],
      size: 10,
      adj: ['left#1', 'top'],
    });
    expect(fingerprintOf(d, names, 'vertex', 0)).toEqual({
      type: 'point',
      at: [0, 0, 10],
      adj: ['left#1', 'top'],
    });
  });

  it('scores the same geometry 1, other types 0, a flipped plane lower', () => {
    const top = fingerprintOf(d, names, 'face', 0);
    expect(fingerprintScore(top, top, 'face')).toBeCloseTo(1);
    expect(fingerprintScore(top, fingerprintOf(d, names, 'face', 2), 'face')).toBe(0);
    const flipped = { ...top, dir: [0, 0, -1] as [number, number, number] };
    expect(fingerprintScore(top, flipped, 'face')).toBeLessThan(0.85);
    // Moved a little, neighbours renamed by a split: still a strong match.
    const moved = { ...top, at: [6, 5, 10] as [number, number, number], adj: ['left#2'] };
    expect(fingerprintScore(top, moved, 'face')).toBeGreaterThan(0.9);
  });
});
