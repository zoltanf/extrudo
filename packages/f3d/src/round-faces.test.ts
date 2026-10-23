/**
 * Naming a round's faces and faces an offset moved, on a hand-built decoded
 * design (no real file's bytes): a 20 mm square box 10 mm high, a fillet of
 * its vertical edges, then face deletions that name the fillet's faces or a
 * side of the box. The file's tokens on a round's faces count other faces
 * too, so the edge a round face came from is told by geometry; an offset
 * leaves a face's solved surface off its sketch curve, so its other states
 * name it.
 */
import { describe, expect, it } from 'vitest';
import type { AsmSurface } from './asm';
import type { ParameterValue } from './decode/parameters';
import { f3dToDesign } from './map';
import {
  type F3dDesign,
  type F3dEdge,
  type F3dExtrude,
  type F3dFace,
  type F3dFeature,
  type F3dSketchFeature,
  IDENTITY,
} from './model';

const parameter = (p: Partial<ParameterValue> & Pick<ParameterValue, 'name'>): ParameterValue => ({
  id: 0,
  number: 0,
  expression: '',
  kind: 'Radius',
  comment: '',
  user: false,
  unit: 'mm',
  value: 0,
  ...p,
});
const base = { suppressed: false, parameters: [] as ParameterValue[] };

const SKETCH = 10;
const EXTRUDE = 12;
const FILLET = 20;
/** The square's corners (cm) in the sketch's order; side i runs from corner i to corner i + 1. */
const CORNERS: [number, number, number][] = [
  [0, 0, 0],
  [2, 0, 0],
  [2, 2, 0],
  [0, 2, 0],
];
/** Each side's outward normal. */
const NORMALS: [number, number, number][] = [
  [0, -1, 0],
  [1, 0, 0],
  [0, 1, 0],
  [-1, 0, 0],
];
const plane = (point: [number, number, number], normal: [number, number, number]): AsmSurface => ({
  kind: 'plane',
  point,
  normal,
});
const ours = (surface: AsmSurface, token = '0'): F3dFace => ({
  tags: [{ token, designs: [EXTRUDE] }],
  feature: EXTRUDE,
  surface,
});
const side = (i: number) =>
  ours(plane(CORNERS[i] as [number, number, number], NORMALS[i] as [number, number, number]));
const bottom = ours(plane([0, 0, 0], [0, 0, -1]));
const top = ours(plane([0, 0, 1], [0, 0, 1]));
/** The vertical edge at corner `i`: between side i − 1 and side i. */
const corner = (i: number, faces?: [F3dFace, F3dFace]): F3dEdge => ({
  faces: faces ?? [side((i + 3) % 4), side(i)],
  bounds: [bottom, top],
});
/** The fillet's face at corner `i` (radius 2 mm), with the token the file gave it. */
const round = (i: number, token: string): F3dFace => {
  const [x, y] = CORNERS[i] as [number, number, number];
  return {
    tags: [{ token, designs: [FILLET] }],
    feature: FILLET,
    surface: {
      kind: 'cone',
      center: [x === 0 ? 0.2 : x - 0.2, y === 0 ? 0.2 : y - 0.2, 0],
      axis: [0, 0, 1],
      radius: 0.2,
      cylinder: true,
      slope: 0,
    },
  };
};

function box(edges: F3dEdge[]): F3dDesign {
  const tag = (i: number) => BigInt(100 + i);
  const sketch: F3dSketchFeature = {
    ...base,
    type: 'sketch',
    id: SKETCH,
    kind: 'Sketch',
    name: 'Sketch1',
    sketch: {
      id: SKETCH + 1,
      frame: IDENTITY,
      points: CORNERS.map((at, i) => ({ id: 200 + i, at, incidence: 0 })),
      lines: CORNERS.map((start, i) => ({
        id: 300 + i,
        tag: tag(i),
        start,
        end: CORNERS[(i + 1) % 4] as [number, number, number],
        startPoint: 200 + i,
        endPoint: 200 + ((i + 1) % 4),
        construction: false,
      })),
      circulars: [],
      splines: [],
      texts: [],
    },
  };
  const extrude: F3dExtrude = {
    ...base,
    type: 'extrude',
    id: EXTRUDE,
    kind: 'Extrude',
    name: 'Extrude1',
    parameters: [parameter({ name: 'd1', kind: 'AlongDistance', value: 1 })],
    operation: 'new-body',
    direction: 'one-side',
    reversed: false,
    solid: true,
    start: 'profile-plane',
    profiles: [
      {
        id: SKETCH + 3,
        sketch: SKETCH + 1,
        regions: [
          {
            outer: [[tag(0), tag(1), tag(2), tag(3)]],
            inner: [],
            outerPieces: [
              [0, 1, 2, 3].map((i) => ({ tag: tag(i), secondary: 0n, piece: 1, of: 1 })),
            ],
            innerPieces: [],
          },
        ],
      },
    ],
    faces: [],
    participants: [],
  };
  const fillet: F3dFeature = {
    ...base,
    type: 'fillet',
    id: FILLET,
    kind: 'Fillet',
    name: 'Fillet1',
    sets: [{ edges, size: parameter({ name: 'd2', value: 0.2 }) }],
  };
  return {
    parameters: [],
    userParameters: [],
    features: [sketch, extrude, fillet],
    bodies: [],
    components: [],
    bodyMoves: [],
    problems: [],
    unreadParameters: 0,
  } as unknown as F3dDesign;
}

let deletions = 0;
const deletion = (faces: F3dFace[]): F3dFeature => ({
  ...base,
  type: 'delete-faces',
  id: 40 + deletions,
  kind: 'DeleteFace',
  name: `DeleteFace${++deletions}`,
  faces,
});

/** What the import named the faces of each deletion, by its name; or its skip reason. */
function deleted(f3d: F3dDesign): Record<string, string[] | string> {
  const { design, report } = f3dToDesign(f3d, 'Box');
  const out: Record<string, string[] | string> = {};
  for (const f of design.toJSON().features)
    if (f.type === 'removeFaces')
      out[f.name] = (f.inputs.faces as { refs: { id: string }[] }).refs.map((r) => r.id);
  for (const s of report.skipped) if (s.kind === 'DeleteFace') out[s.name] = s.reason;
  return out;
}

/** The import's names of the fillet's edges, by corner. */
function filletEdges(f3d: F3dDesign): string[] {
  const { design } = f3dToDesign(f3d, 'Box');
  const fillet = design.toJSON().features.find((f) => f.type === 'fillet');
  return ((fillet?.inputs.edges as { refs: { id: string }[] } | undefined)?.refs ?? []).map(
    (r) => r.id,
  );
}

describe("naming a round's faces", () => {
  it('names a round face after the edge it lies along, not the one its token counts to', () => {
    deletions = 0;
    const f3d = box([corner(0), corner(1), corner(2), corner(3)]);
    const edges = filletEdges(f3d);
    expect(edges).toHaveLength(4);
    // The file's tokens count other faces too: corner 1's round says "3", corner 3's "2".
    f3d.features.push(deletion([round(1, '3')]), deletion([round(3, '2')]));
    expect(deleted(f3d)).toEqual({
      DeleteFace1: [`fillet:${'f3'}:from:(${edges[1]})`],
      DeleteFace2: [`fillet:${'f3'}:from:(${edges[3]})`],
    });
  });

  it("leaves a round face of an edge it could not name unnamed, not its neighbour's", () => {
    deletions = 0;
    // Corner 1's edge runs between faces of a feature the import left out.
    const stray = (s: AsmSurface): F3dFace => ({ tags: [], feature: 99, surface: s });
    const f3d = box([
      corner(0),
      corner(1, [stray(side(0).surface as AsmSurface), stray(side(1).surface as AsmSurface)]),
    ]);
    expect(filletEdges(f3d)).toHaveLength(1);
    // Its token even counts to corner 0's edge, the only one named.
    f3d.features.push(deletion([round(1, '1')]), deletion([round(0, '2')]));
    const out = deleted(f3d);
    expect(out.DeleteFace1).toBe('none of its 1 faces could be named');
    expect(out.DeleteFace2).toEqual([expect.stringMatching(/^fillet:f3:from:\(e\[/)]);
  });
});

describe('naming a face an offset moved', () => {
  it('names a side by the state on its sketch line when the solved one moved off it', () => {
    deletions = 0;
    const f3d = box([corner(0)]);
    const moved: F3dFace = {
      ...side(3),
      surface: plane([-0.1, 0, 0], [-1, 0, 0]),
      states: [plane([0, 0, 0], [-1, 0, 0])],
    };
    f3d.features.push(deletion([moved]), deletion([{ ...moved, states: [] }]));
    const out = deleted(f3d);
    expect(out.DeleteFace1).toEqual([expect.stringMatching(/^extrude:f2:side:/)]);
    expect(out.DeleteFace2).toBe('none of its 1 faces could be named');
  });

  it('does not offset again a face only its other states name', () => {
    const f3d = box([corner(0)]);
    const moved: F3dFace = {
      ...side(3),
      surface: plane([-0.1, 0, 0], [-1, 0, 0]),
      states: [plane([0, 0, 0], [-1, 0, 0])],
    };
    f3d.features.push({
      ...base,
      type: 'offset-faces',
      id: 60,
      kind: 'OffsetFaces',
      name: 'OffsetFaces1',
      faces: [moved],
      distance: parameter({ name: 'd9', kind: 'Distance', value: -0.01 }),
    });
    const { report } = f3dToDesign(f3d, 'Box');
    expect(report.skipped).toContainEqual(
      expect.objectContaining({
        name: 'OffsetFaces1',
        reason: 'none of its 1 faces could be named',
      }),
    );
  });
});
