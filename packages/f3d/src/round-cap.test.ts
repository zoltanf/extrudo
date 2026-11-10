/**
 * A crafted fillet of very many edges is left out at import: when it failed,
 * the kernel's diagnosis would build each chain alone and bisect it, about
 * nine builds an edge (hand-built, no real file's bytes).
 */
import { describe, expect, it } from 'vitest';
import { f3dToDesign, MAX_ROUND_EDGES } from './map';
import type { F3dDesign, F3dEdge } from './model';

function design(edges: number): F3dDesign {
  const edge = (i: number): F3dEdge => ({
    faces: [
      { tags: [{ token: String(i), designs: [1] }], feature: 1 },
      { tags: [{ token: String(i + 1), designs: [1] }], feature: 1 },
    ],
    bounds: [],
  });
  return {
    parameters: [],
    userParameters: [],
    features: [
      {
        type: 'fillet',
        id: 4,
        kind: 'Fillet',
        name: 'Fillet1',
        suppressed: false,
        parameters: [],
        sets: [
          { edges: Array.from({ length: edges }, (_, i) => edge(i)) },
          { edges: [edge(edges)] },
        ],
      },
    ],
    bodies: [],
    problems: [],
    unreadParameters: 0,
  };
}

describe('edges per round', () => {
  it('leaves out a round of more than MAX_ROUND_EDGES edges, all sets counted', () => {
    const { report } = f3dToDesign(design(MAX_ROUND_EDGES), 'Many');
    expect(report.skipped).toEqual([
      expect.objectContaining({
        name: 'Fillet1',
        reason: `it rounds ${MAX_ROUND_EDGES + 1} edges, more than ${MAX_ROUND_EDGES}`,
      }),
    ]);
  });

  it('reads a round within the cap as before', () => {
    const { report } = f3dToDesign(design(MAX_ROUND_EDGES - 1), 'Many');
    expect(report.skipped.find((s) => s.name === 'Fillet1')?.reason ?? '').not.toMatch(/more than/);
  });
});
