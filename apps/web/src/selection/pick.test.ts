import {
  type BodyId,
  emptySketchData,
  type FeatureId,
  originPlaneRef,
  planeFrame,
  type SketchData,
  type SketchFrame,
} from '@extrudo/core';
import { translation } from '@extrudo/kernel/matrix';
import { detectProfiles, profileAt } from '@extrudo/sketch/profiles';
import { describe, expect, it } from 'vitest';
import { textProfiles, textSketch } from '../sketch/textTesting';
import { pickableBodies } from '../viewport/posedBodies';
import { DEFAULT_FILTER, type SelectionFilter } from './filter';
import {
  type PickScene,
  pickBox,
  pickStack,
  pickTop,
  projectPoint,
  segmentMeetsRect,
  triangleFaces,
} from './pick';
import { boxMesh, cameraFrom, topViewPx } from './testing';

const B = 'b' as BodyId;
const cube = boxMesh([0, 0, 0], [10, 10, 10]);
const scene: PickScene = { bodies: [{ id: B, mesh: cube }], sketches: [], occluding: true };
const only = (...kinds: (keyof SelectionFilter)[]): SelectionFilter =>
  Object.fromEntries(
    Object.keys(DEFAULT_FILTER).map((k) => [k, kinds.includes(k as never)]),
  ) as never;
const without = (...kinds: (keyof SelectionFilter)[]): SelectionFilter => ({
  ...DEFAULT_FILTER,
  ...Object.fromEntries(kinds.map((k) => [k, false])),
});

// Looking from front-right-top: the top (+Z, face 1), front (−Y, 2) and right (+X, 5) faces show.
const iso = cameraFrom([1, -1, 1], { target: [5, 5, 5], size: 40 });
const at = (p: [number, number, number], camera = iso) => {
  const s = projectPoint(camera, p);
  if (!s) throw new Error('behind the camera');
  return s;
};

describe('pickTop', () => {
  it('takes the face under the pointer', () => {
    expect(pickTop(scene, iso, at([5, 5, 10]), DEFAULT_FILTER)).toEqual({
      kind: 'face',
      id: 'b:1',
    });
    expect(pickTop(scene, iso, at([5, 0, 5]), DEFAULT_FILTER)).toEqual({ kind: 'face', id: 'b:2' });
    expect(pickTop(scene, iso, at([10, 5, 5]), DEFAULT_FILTER)).toEqual({
      kind: 'face',
      id: 'b:5',
    });
  });

  it('prefers a vertex, then an edge, near the pointer', () => {
    // The top-front-right corner is vertex 5; the vertical front-right edge is edge 9.
    expect(pickTop(scene, iso, at([10, 0, 10]), DEFAULT_FILTER)).toEqual({
      kind: 'vertex',
      id: 'b:5',
    });
    const [x, y] = at([10, 0, 5]);
    expect(pickTop(scene, iso, [x + 3, y], DEFAULT_FILTER)).toEqual({ kind: 'edge', id: 'b:9' });
    // Too far from the edge: the face.
    expect(pickTop(scene, iso, [x + 12, y], DEFAULT_FILTER)).toEqual({ kind: 'face', id: 'b:5' });
  });

  it('follows the filter', () => {
    expect(pickTop(scene, iso, at([10, 0, 10]), without('vertices'))?.kind).toBe('edge');
    expect(pickTop(scene, iso, at([10, 0, 5]), without('vertices', 'edges'))?.kind).toBe('face');
    expect(pickTop(scene, iso, at([5, 5, 10]), only('bodies'))).toEqual({ kind: 'body', id: 'b' });
    expect(pickTop(scene, iso, at([5, 5, 10]), only('edges'))).toBeUndefined();
  });

  it('finds nothing over empty space', () => {
    expect(pickTop(scene, iso, [5, 5], DEFAULT_FILTER)).toBeUndefined();
  });

  it('works in perspective', () => {
    const camera = cameraFrom([1, -1, 1], {
      target: [5, 5, 5],
      size: 40,
      projection: 'perspective',
    });
    expect(pickTop(scene, camera, at([5, 5, 10], camera), DEFAULT_FILTER)).toEqual({
      kind: 'face',
      id: 'b:1',
    });
    expect(pickTop(scene, camera, at([10, 0, 10], camera), DEFAULT_FILTER)).toEqual({
      kind: 'vertex',
      id: 'b:5',
    });
    const [x, y] = at([10, 0, 5], camera);
    expect(pickTop(scene, camera, [x + 3, y], DEFAULT_FILTER)).toEqual({ kind: 'edge', id: 'b:9' });
  });
});

describe('pickStack', () => {
  it('lists what is under the pointer, hidden items marked', () => {
    // The ray through (7, 4, 10) on the top face leaves the part through the back face.
    const stack = pickStack(scene, iso, at([7, 4, 10]), DEFAULT_FILTER);
    expect(stack.map((h) => `${h.item.kind}:${h.item.id}${h.occluded ? ' (hidden)' : ''}`)).toEqual(
      ['face:b:1', 'face:b:3 (hidden)', 'body:b'],
    );
  });

  it('marks a vertex behind the part as hidden, and none in wireframe', () => {
    // In this view the far bottom-back-left corner (vertex 2) sits behind vertex 5.
    const stack = pickStack(scene, iso, at([10, 0, 10]), only('vertices'));
    expect(stack.map((h) => [h.item.id, h.occluded])).toEqual([
      ['b:5', false],
      ['b:2', true],
    ]);
    const wire = pickStack({ ...scene, occluding: false }, iso, at([10, 0, 10]), only('vertices'));
    expect(wire.every((h) => !h.occluded)).toBe(true);
  });

  it('hides edges behind faces', () => {
    // The bottom-back edge (y = 10, z = 0: edge 1) is behind the part.
    const hits = pickStack(scene, iso, at([5, 10, 0]), only('edges'));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ item: { kind: 'edge', id: 'b:1' }, occluded: true });
    expect(pickTop(scene, iso, at([5, 10, 0]), only('edges'))).toBeUndefined();
  });
});

describe('sketches in model mode', () => {
  const frame = planeFrame(originPlaneRef('origin:xy')) as SketchFrame;
  const S = 's' as FeatureId;
  // A 40 × 40 mm square around the cube in the XY plane (under the cube's bottom face),
  // and a construction diagonal across it.
  const entities: Record<string, unknown> = {};
  [
    [-15, -15],
    [25, -15],
    [25, 25],
    [-15, 25],
  ].forEach(([x, y], i) => {
    entities[`p${i}`] = { type: 'point', x, y };
  });
  for (let i = 0; i < 4; i++) {
    entities[`l${i}`] = {
      type: 'line',
      start: `p${i}`,
      end: `p${(i + 1) % 4}`,
      construction: false,
    };
  }
  entities.p4 = { type: 'point', x: -15, y: -15 };
  entities.p5 = { type: 'point', x: 25, y: 25 };
  entities.l4 = { type: 'line', start: 'p4', end: 'p5', construction: true };
  const data: SketchData = { ...emptySketchData(), entities: entities as SketchData['entities'] };
  const sketchScene: PickScene = {
    ...scene,
    sketches: [{ id: S, frame, data, profiles: detectProfiles(data) }],
  };
  const top = cameraFrom([0, 0, 1], { target: [5, 5, 5], size: 100 });

  it('picks sketch curves and profiles', () => {
    expect(pickTop(sketchScene, top, topViewPx(top, 5, -15), DEFAULT_FILTER)).toEqual({
      kind: 'sketchEntity',
      id: 's/l0',
    });
    const profile = pickTop(sketchScene, top, topViewPx(top, 20, 14), DEFAULT_FILTER);
    expect(profile?.kind).toBe('profile');
    expect(profile?.id.startsWith('s/')).toBe(true);
    // Over the cube, the top face hides the profile under it.
    expect(pickTop(sketchScene, top, topViewPx(top, 5, 5), DEFAULT_FILTER)?.kind).toBe('face');
    const stack = pickStack(sketchScene, top, topViewPx(top, 5, 5), DEFAULT_FILTER);
    expect(stack.map((h) => h.item.kind)).toContain('profile');
  });

  it('leaves construction curves to the construction filter', () => {
    const diagonal = topViewPx(top, 20, 20);
    expect(pickTop(sketchScene, top, diagonal, DEFAULT_FILTER)).toEqual({
      kind: 'sketchEntity',
      id: 's/l4',
    });
    expect(pickTop(sketchScene, top, diagonal, without('construction'))?.kind).toBe('profile');
  });
});

describe('a text in model mode (P4-03)', () => {
  const frame = planeFrame(originPlaneRef('origin:xy')) as SketchFrame;
  const T = 't' as FeatureId;
  const data = textSketch({ text: 'Ag', height: 10 });
  const ink = textProfiles(data).filter((p) => p.text);
  const textScene: PickScene = {
    bodies: [],
    sketches: [{ id: T, frame, data, profiles: textProfiles(data) }],
    occluding: false,
  };
  const top = cameraFrom([0, 0, 1], { target: [5, 5, 0], size: 60 });
  // The camera looks down the Z axis, so its pixels are 60 / 600 = 0.1 mm.

  it('has ink regions, each of one text', () => {
    expect(ink.length).toBeGreaterThan(1);
    expect(ink.every((p) => p.text === 'word')).toBe(true);
  });

  /** A point well inside the ink: the neighbours a tenth of a mm about must be in it too. */
  const insideInk = (): [number, number] => {
    const at = (p: [number, number]) => profileAt(textProfiles(data), p);
    for (let y = 0.2; y <= 10; y += 0.2) {
      for (let x = 0.2; x <= 15; x += 0.2) {
        const hit = at([x, y]);
        if (hit?.text !== 'word') continue;
        const near = [
          [x + 0.1, y],
          [x - 0.1, y],
          [x, y + 0.1],
          [x, y - 0.1],
        ].map((p) => at(p as [number, number])?.id);
        if (near.every((id) => id === hit.id)) return [x, y];
      }
    }
    throw new Error('no ink found');
  };

  it('takes the whole text where a letter is, and offers the letter too', () => {
    const [x, y] = insideInk();
    const letter = profileAt(textProfiles(data), [x, y]);
    const stack = pickStack(textScene, top, topViewPx(top, x, y), only('profiles'));
    expect(stack[0]?.item).toEqual({ kind: 'sketchEntity', id: 't/word' });
    expect(stack[1]?.item).toEqual({ kind: 'profile', id: `t/${letter?.id}` });
    expect(pickTop(textScene, top, topViewPx(top, x, y), only('profiles'))).toEqual({
      kind: 'sketchEntity',
      id: 't/word',
    });
  });

  it('boxes a text once, whole', () => {
    const px = topViewPx(top, -2, -2);
    const box = pickBox(textScene, top, px, topViewPx(top, 25, 15), only('profiles'));
    const texts = box.filter((item) => item.kind === 'sketchEntity');
    expect(texts).toEqual([{ kind: 'sketchEntity', id: 't/word' }]);
  });

  it('picks the text as a sketch curve where a dialog asks for sketches', () => {
    // A point on a glyph outline (a vertex of an ink region) is near the curve.
    const vertex = ink[0]?.outer.polygon[0] as [number, number] | undefined;
    const [x, y] = vertex ?? [0, 0];
    expect(pickTop(textScene, top, topViewPx(top, x, y), only('sketches', 'construction'))).toEqual(
      {
        kind: 'sketchEntity',
        id: 't/word',
      },
    );
  });
});

describe('pickBox', () => {
  const top = cameraFrom([0, 0, 1], { target: [5, 5, 5], size: 100 });
  const px = (x: number, y: number) => topViewPx(top, x, y);

  it('takes whole bodies first, then faces', () => {
    expect(pickBox(scene, top, px(-2, -2), px(12, 12), DEFAULT_FILTER)).toEqual([
      { kind: 'body', id: 'b' },
    ]);
    const faces = pickBox(scene, top, px(-2, -2), px(12, 12), without('bodies'));
    expect(faces.map((f) => f.id)).toEqual(['b:0', 'b:1', 'b:2', 'b:3', 'b:4', 'b:5']);
  });

  it('tells a window from a crossing box', () => {
    // Left to right over half the cube: nothing is wholly inside but the left face (seen edge-on).
    expect(pickBox(scene, top, px(-2, -2), px(5, 12), without('bodies'))).toEqual([
      { kind: 'face', id: 'b:4' },
    ]);
    // Right to left: the body it touches.
    expect(pickBox(scene, top, px(5, 12), px(-2, -2), DEFAULT_FILTER)).toEqual([
      { kind: 'body', id: 'b' },
    ]);
    // A crossing box inside the top face touches the top and the bottom face (it sees through).
    const inner = pickBox(scene, top, px(6, 6), px(4, 4), without('bodies'));
    expect(inner.map((f) => f.id)).toEqual(['b:0', 'b:1']);
  });

  it('takes edges and vertices when faces are filtered out', () => {
    const edges = pickBox(scene, top, px(-2, -2), px(12, 1), only('edges', 'vertices'));
    // The front edges (y = 0): bottom, top, and the two vertical ones seen end-on.
    expect(edges.map((e) => e.id).sort()).toEqual(['b:0', 'b:2', 'b:8', 'b:9']);
    const vertices = pickBox(scene, top, px(-2, -2), px(1, 1), only('vertices'));
    expect(vertices.map((v) => v.id)).toEqual(['b:0', 'b:4']);
  });

  it('returns nothing for an empty box', () => {
    expect(pickBox(scene, top, px(30, 30), px(40, 40), DEFAULT_FILTER)).toEqual([]);
  });

  it('takes construction planes, axes and points (P4-12)', () => {
    const frame: SketchFrame = {
      origin: [5, 5, 5],
      x: [1, 0, 0],
      y: [0, 1, 0],
      normal: [0, 0, 1],
    };
    const withConstruction: PickScene = {
      ...scene,
      planes: [{ id: 'P1', frame, anchor: [5, 5, 5], half: 20 }],
      axes: [{ id: 'A1', origin: [5, 5, 5], direction: [1, 0, 0], half: 100 }],
      points: [{ id: 'PT1', at: [5, 5, 5] }],
    };
    // A crossing box (right to left) over the middle.
    const chosen = pickBox(withConstruction, top, px(35, 35), px(-25, -25), only('construction'));
    expect(chosen.map((i) => i.id).sort()).toEqual(['A1', 'P1', 'PT1']);
    // With the construction filter off, no construction item is taken.
    expect(
      pickBox(withConstruction, top, px(35, 35), px(-25, -25), without('construction')).some(
        (i) => i.kind === 'plane' || i.kind === 'axis' || i.kind === 'point',
      ),
    ).toBe(false);
  });

  it('never box-selects the origin axes (P4-12 review L10)', () => {
    const withOrigin: PickScene = {
      ...scene,
      planes: [],
      points: [],
      // A long origin axis across the whole view: it would swallow any crossing box.
      axes: [{ id: 'origin:x', origin: [5, 5, 5], direction: [1, 0, 0], half: 100 }],
    };
    expect(pickBox(withOrigin, top, px(35, 35), px(-25, -25), only('construction'))).toEqual([]);
    // A construction axis in the same place still comes along.
    const construction: PickScene = {
      ...withOrigin,
      axes: [{ id: 'A1', origin: [5, 5, 5], direction: [1, 0, 0], half: 100 }],
    };
    expect(pickBox(construction, top, px(35, 35), px(-25, -25), only('construction'))).toEqual([
      { kind: 'axis', id: 'A1' },
    ]);
  });
});

describe('geometry helpers', () => {
  it('meets a rectangle with a segment', () => {
    const r = { x0: 0, y0: 0, x1: 10, y1: 10 };
    expect(segmentMeetsRect([-5, 5], [15, 5], r)).toBe(true);
    expect(segmentMeetsRect([2, 2], [3, 3], r)).toBe(true);
    expect(segmentMeetsRect([-5, -5], [-1, 20], r)).toBe(false);
    expect(segmentMeetsRect([-5, 12], [12, -5], r)).toBe(true);
    expect(segmentMeetsRect([-5, 20], [20, 11], r)).toBe(false);
  });

  it('maps triangles to faces', () => {
    expect([...triangleFaces(cube)]).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });
});

describe('origin axes (P2-07)', () => {
  const axes = [
    { id: 'origin:x', origin: [0, 0, 0], direction: [1, 0, 0], half: 100 },
    { id: 'origin:z', origin: [0, 0, 0], direction: [0, 0, 1], half: 100 },
  ] as const;
  const empty: PickScene = { bodies: [], sketches: [], occluding: true, axes };

  it('are picked like edges, with the construction filter', () => {
    expect(pickTop(empty, iso, at([-30, 0, 0]), DEFAULT_FILTER)).toEqual({
      kind: 'axis',
      id: 'origin:x',
    });
    expect(pickTop(empty, iso, at([0, 0, -20]), DEFAULT_FILTER)).toEqual({
      kind: 'axis',
      id: 'origin:z',
    });
    expect(pickTop(empty, iso, at([-30, 0, 0]), without('construction'))).toBeUndefined();
    // Past where it is drawn, nothing.
    expect(
      pickTop({ ...empty, axes: [{ ...axes[0], half: 10 }] }, iso, at([-30, 0, 0]), DEFAULT_FILTER),
    ).toBeUndefined();
    // Away from both, nothing.
    expect(pickTop(empty, iso, at([-30, -30, 0]), DEFAULT_FILTER)).toBeUndefined();
  });

  it('come after body edges, faces and profiles; over a face only through "Select other…"', () => {
    const withCube: PickScene = { ...scene, axes };
    // The cube's bottom-front edge lies on the X axis: the edge wins.
    expect(pickTop(withCube, iso, at([5, 0, 0]), DEFAULT_FILTER)).toMatchObject({ kind: 'edge' });
    expect(
      pickStack(withCube, iso, at([5, 0, 0]), DEFAULT_FILTER).map((h) => h.item.kind),
    ).toContain('axis');
    // Over a face, the face wins; the axis is still in "Select other…".
    const over = at([0, 0, 15]);
    const onTop = { ...withCube, axes: [{ ...axes[1], origin: [5, 5, 0] as const }] };
    expect(pickTop(onTop, iso, at([5, 5, 10]), DEFAULT_FILTER)).toEqual({
      kind: 'face',
      id: 'b:1',
    });
    expect(pickStack(onTop, iso, at([5, 5, 10]), DEFAULT_FILTER).map((h) => h.item.kind)).toContain(
      'axis',
    );
    // Clear of the cube, the axis.
    expect(pickTop(withCube, iso, over, DEFAULT_FILTER)).toEqual({ kind: 'axis', id: 'origin:z' });
    // With faces filtered out (an axis field), the axis over a face.
    expect(pickTop(onTop, iso, at([5, 5, 10]), only('construction'))).toEqual({
      kind: 'axis',
      id: 'origin:z',
    });
  });

  it('are never taken by a selection box', () => {
    expect(pickBox(empty, iso, [0, 0], [2000, 2000], DEFAULT_FILTER)).toEqual([]);
  });
});

describe('construction planes and points (P3-05)', () => {
  const frame = planeFrame(originPlaneRef('origin:xy')) as SketchFrame;
  // A plane at z = 20 drawn as a 30 mm square around (0, 0, 20), and a point beside the cube.
  const offset: SketchFrame = { ...frame, origin: [0, 0, 20] };
  const world: PickScene = {
    bodies: [],
    sketches: [],
    occluding: true,
    planes: [{ id: 'OP', frame: offset, anchor: [0, 0, 20], half: 15 }],
    points: [{ id: 'PT', at: [40, 0, 0] }],
  };
  const top = cameraFrom([0, 0, 1], { size: 200 });

  it('a plane is picked inside its square, not outside', () => {
    expect(pickTop(world, top, topViewPx(top, 5, 5), DEFAULT_FILTER)).toEqual({
      kind: 'plane',
      id: 'OP',
    });
    expect(pickTop(world, top, topViewPx(top, 25, 5), DEFAULT_FILTER)).toBeUndefined();
    expect(pickTop(world, top, topViewPx(top, 5, 5), without('construction'))).toBeUndefined();
  });

  it('a point is picked like a vertex, within 8 px', () => {
    const [x, y] = topViewPx(top, 40, 0);
    expect(pickTop(world, top, [x + 4, y], DEFAULT_FILTER)).toEqual({ kind: 'point', id: 'PT' });
    expect(pickTop(world, top, [x + 20, y], DEFAULT_FILTER)).toBeUndefined();
  });

  it('a body face wins over a plane; the plane stays in the stack after the face', () => {
    const both: PickScene = { ...world, bodies: [{ id: B, mesh: cube }] };
    const point = topViewPx(top, 5, 5);
    expect(pickTop(both, top, point, DEFAULT_FILTER)).toEqual({ kind: 'face', id: 'b:1' });
    // The cube's top and bottom faces, then the plane, then the body.
    expect(pickStack(both, top, point, DEFAULT_FILTER).map((h) => h.item.kind)).toEqual([
      'face',
      'face',
      'plane',
      'body',
    ]);
  });
});

describe('posed bodies (P6-05 J2)', () => {
  const pose = translation([0, 0, 5]);
  const bodies = { [B]: cube };
  const items = (posed?: Record<BodyId, typeof pose>) => ({
    bodies: pickableBodies(bodies, {}, posed),
    sketches: [],
    occluding: true,
  });

  it('is not picked while posed, and is again when it is put back', () => {
    const spot = at([5, 5, 10]);
    expect(pickTop(items(), iso, spot, DEFAULT_FILTER)).toEqual({ kind: 'face', id: 'b:1' });
    expect(pickTop(items({ [B]: pose }), iso, spot, DEFAULT_FILTER)).toBeUndefined();
    expect(pickTop(items(undefined), iso, spot, DEFAULT_FILTER)).toEqual({
      kind: 'face',
      id: 'b:1',
    });
  });
});
