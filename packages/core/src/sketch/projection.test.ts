import { describe, expect, it } from 'vitest';
import { applyCommand, CommandError } from '../commands';
import { createDocument } from '../document';
import type { DocumentId, FeatureId, ProjectionId, SketchEntityId } from '../ids';
import { DocumentSchema, type ExtrudoDocument } from '../schema';
import { addToSketch, createSketch, modifySketch, removeFromSketch } from './commands';
import { readSketch } from './feature';
import {
  FLAT_FACE_TILT,
  faceSketchFrame,
  fingerprintFrame,
  ORIGIN_PLANES,
  type SketchFrame,
  sketchToWorld,
  type Vec3,
} from './planes';
import {
  addProjection,
  includedCurves,
  includeLabel,
  includeProjection,
  projectedEntities,
  projectionOf,
  projectionSync,
  type SketchReport,
  syncProjections,
} from './projection';
import { SketchDataSchema, sketchIssues } from './schema';

const F = 'sk' as FeatureId;
const P = 'pr1' as ProjectionId;
const edgeRef = { kind: 'edge' as const, id: 'e[extrude:E:cap:end|extrude:E:side:l1]' };
const faceRef = { kind: 'face' as const, id: 'extrude:E:cap:end' };

function doc(): ExtrudoDocument {
  const base = createDocument({
    id: 'd' as DocumentId,
    name: 'P',
    now: '2026-09-28T10:00:00.000Z',
  });
  return applyCommand(base, createSketch({ id: F, plane: faceRef })).doc;
}

const data = (d: ExtrudoDocument) => {
  const sketch = readSketch(d.features[0] as never);
  if (!sketch) throw new Error('no sketch');
  return sketch.data;
};

let counter = 0;
const newId = () => `n${++counter}`;

const report = (curves: SketchReport['projections']): SketchReport => ({
  frame: ORIGIN_PLANES[0]?.frame as SketchFrame,
  projections: curves,
});

/** Applies a sync for the report, if there is one. */
function sync(d: ExtrudoDocument, r: SketchReport): ExtrudoDocument {
  const change = projectionSync(data(d), r, newId);
  return change ? applyCommand(d, syncProjections({ feature: F, ...change })).doc : d;
}

describe('face sketch frames', () => {
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];

  it('match the origin planes on their normals, wherever the face lies', () => {
    for (const { frame } of ORIGIN_PLANES) {
      const f = faceSketchFrame([7, 8, 9], frame.normal);
      expect(f.x).toEqual(frame.x);
      expect(f.y).toEqual(frame.y);
      expect(f.normal).toEqual(frame.normal);
    }
  });

  it('give the Bottom, Back and Left views their screen axes', () => {
    expect(faceSketchFrame([0, 0, -2], [0, 0, -1])).toMatchObject({ x: [1, 0, 0], y: [0, -1, 0] });
    expect(faceSketchFrame([0, 5, 0], [0, 1, 0])).toMatchObject({ x: [-1, 0, 0], y: [0, 0, 1] });
    expect(faceSketchFrame([-5, 0, 0], [-1, 0, 0])).toMatchObject({ x: [0, -1, 0], y: [0, 0, 1] });
  });

  it('put the origin at the world origin projected onto the plane', () => {
    // A box's top face at z = 15: the sketch's (x, y) are the world's.
    const top = faceSketchFrame([30, 20, 15], [0, 0, 1]);
    expect(top.origin).toEqual([0, 0, 15]);
    expect(sketchToWorld(top, [30, 20])).toEqual([30, 20, 15]);
    // Any point of the plane gives the same frame.
    const n: Vec3 = [0.6, 0, 0.8];
    const a = faceSketchFrame([10, 3, 0], n);
    const b = faceSketchFrame([10 - 8 * 4, 50, 6 * 4], n);
    for (const k of [0, 1, 2]) expect(a.origin[k]).toBeCloseTo(b.origin[k] as number, 9);
  });

  it('are right-handed and orthonormal, and hold still under small tilts', () => {
    const tilts = [0, 5, 20, 39, 41, 45, 60, 85, 90, 120, 179];
    for (const deg of tilts) {
      for (const turn of [0, 30, 90, 200]) {
        const t = (deg * Math.PI) / 180;
        const r = (turn * Math.PI) / 180;
        const n: Vec3 = [Math.sin(t) * Math.cos(r), Math.sin(t) * Math.sin(r), Math.cos(t)];
        const f = faceSketchFrame([1, 2, 3], n);
        expect(dot(f.x, f.x)).toBeCloseTo(1, 12);
        expect(dot(f.y, f.y)).toBeCloseTo(1, 12);
        expect(dot(f.x, f.y)).toBeCloseTo(0, 12);
        const z = cross(f.x, f.y);
        for (const k of [0, 1, 2]) expect(z[k]).toBeCloseTo(n[k] as number, 12);
        // A tenth of a degree more tilt turns the axes by about as much, not a quarter turn.
        const t2 = t + 0.1 * (Math.PI / 180);
        const n2: Vec3 = [Math.sin(t2) * Math.cos(r), Math.sin(t2) * Math.sin(r), Math.cos(t2)];
        const g = faceSketchFrame([1, 2, 3], n2);
        expect(dot(f.x, g.x)).toBeGreaterThan(0.999);
      }
    }
    expect(FLAT_FACE_TILT).toBeCloseTo((40 * Math.PI) / 180);
  });

  it('come from a planar fingerprint until the kernel has the face', () => {
    const ref = {
      kind: 'face' as const,
      id: 'extrude:E:cap:end',
      fingerprint: {
        type: 'plane',
        at: [5, 5, 10] as [number, number, number],
        dir: [0, 0, 1] as [number, number, number],
      },
    };
    expect(fingerprintFrame(ref)?.origin).toEqual([0, 0, 10]);
    expect(
      fingerprintFrame({ ...ref, fingerprint: { ...ref.fingerprint, type: 'cylinder' } }),
    ).toBeUndefined();
    expect(fingerprintFrame({ kind: 'plane', id: 'origin:xy' })).toBeUndefined();
  });
});

describe('projections', () => {
  it('start empty and refuse a second projection of the same source', () => {
    let d = doc();
    d = applyCommand(d, addProjection({ feature: F, id: P, ref: edgeRef })).doc;
    expect(data(d).projections).toEqual({ [P]: { ref: edgeRef, curves: {} } });
    expect(() =>
      applyCommand(d, addProjection({ feature: F, id: 'pr2' as ProjectionId, ref: edgeRef })),
    ).toThrow(CommandError);
    expect(() =>
      applyCommand(
        d,
        addProjection({
          feature: F,
          id: 'pr3' as ProjectionId,
          ref: { kind: 'plane', id: 'origin:xy' },
        }),
      ),
    ).toThrow(/edges, faces, vertices and bodies/);
    expect(DocumentSchema.safeParse(d).success).toBe(true);
  });

  it('get their curves from the kernel report, and follow it', () => {
    let d = applyCommand(doc(), addProjection({ feature: F, id: P, ref: faceRef })).doc;
    d = sync(
      d,
      report({
        [P]: {
          curves: {
            a: { type: 'line', a: [0, 0], b: [10, 0] },
            b: { type: 'circle', center: [5, 5], radius: 2 },
            c: { type: 'arc', center: [0, 0], start: [3, 0], end: [0, 3] },
            d: {
              type: 'spline',
              points: [
                [0, 0],
                [1, 1],
                [2, 0],
              ],
            },
            e: { type: 'ellipse', center: [0, 0], major: [4, 0], minor: [0, 2] },
          },
        },
      }),
    );
    const s = data(d);
    const curves = s.projections?.[P]?.curves ?? {};
    expect(Object.keys(curves).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    const line = s.entities[curves.a as SketchEntityId];
    expect(line?.type).toBe('line');
    // Curves and their points are projected.
    expect(projectedEntities(s).size).toBe(5 + 2 + 1 + 3 + 3 + 3);
    expect(projectionOf(s, curves.a as SketchEntityId)?.id).toBe(P);
    expect(SketchDataSchema.safeParse(s).success).toBe(true);

    // The model changed: the line moves (same IDs), the circle grows, 'b' becomes an arc
    // (replaced), 'e' is gone and a new edge appears.
    const again = sync(
      d,
      report({
        [P]: {
          curves: {
            a: { type: 'line', a: [0, 0], b: [12, 0] },
            c: { type: 'arc', center: [0, 0], start: [3, 0], end: [0, 3] },
            d: {
              type: 'spline',
              points: [
                [0, 0],
                [1, 1],
                [2, 0],
              ],
            },
            b: { type: 'arc', center: [5, 5], start: [7, 5], end: [5, 7] },
            f: { type: 'line', a: [0, 1], b: [0, 2] },
          },
        },
      }),
    );
    const t = data(again);
    const next = t.projections?.[P]?.curves ?? {};
    expect(next.a).toBe(curves.a);
    const line2 = t.entities[next.a as SketchEntityId];
    const end = line2?.type === 'line' ? t.entities[line2.end] : undefined;
    expect(end).toMatchObject({ x: 12, y: 0 });
    expect(next.b).not.toBe(curves.b);
    expect(t.entities[next.b as SketchEntityId]?.type).toBe('arc');
    expect(t.entities[curves.b as SketchEntityId]).toBeUndefined();
    expect(next.e).toBeUndefined();
    expect(t.entities[curves.e as SketchEntityId]).toBeUndefined();
    expect(t.entities[next.f as SketchEntityId]?.type).toBe('line');
    expect(sketchIssues(t)).toEqual([]);

    // Nothing to do when the sketch already shows the report.
    expect(
      projectionSync(
        t,
        report({
          [P]: {
            curves: {
              a: { type: 'line', a: [0, 0], b: [12, 0] },
              c: { type: 'arc', center: [0, 0], start: [3, 0], end: [0, 3] },
              d: {
                type: 'spline',
                points: [
                  [0, 0],
                  [1, 1],
                  [2, 0],
                ],
              },
              b: { type: 'arc', center: [5, 5], start: [7, 5], end: [5, 7] },
              f: { type: 'line', a: [0, 1], b: [0, 2] },
            },
          },
        }),
        newId,
      ),
    ).toBeUndefined();
  });

  it('keep curves where they were when the source is lost', () => {
    let d = applyCommand(doc(), addProjection({ feature: F, id: P, ref: edgeRef })).doc;
    d = sync(d, report({ [P]: { curves: { edge: { type: 'line', a: [0, 0], b: [5, 0] } } } }));
    expect(projectionSync(data(d), report({ [P]: { lost: true } }), newId)).toBeUndefined();
  });

  it('remember curves the user deleted, and go when none is left', () => {
    let d = applyCommand(doc(), addProjection({ feature: F, id: P, ref: faceRef })).doc;
    const two = report({
      [P]: {
        curves: {
          a: { type: 'line', a: [0, 0], b: [10, 0] },
          b: { type: 'line', a: [10, 0], b: [10, 10] },
        },
      },
    });
    d = sync(d, two);
    const curves = data(d).projections?.[P]?.curves ?? {};
    d = applyCommand(
      d,
      removeFromSketch({ feature: F, entities: [curves.a as SketchEntityId] }),
    ).doc;
    expect(data(d).projections?.[P]?.curves.a).toBeNull();
    // The next sync leaves it deleted.
    expect(projectionSync(data(d), two, newId)).toBeUndefined();
    d = applyCommand(
      d,
      removeFromSketch({ feature: F, entities: [curves.b as SketchEntityId] }),
    ).doc;
    expect(data(d).projections).toBeUndefined();
  });

  it('take constraints on removed curves along, and refuse edits of projected geometry', () => {
    let d = applyCommand(doc(), addProjection({ feature: F, id: P, ref: edgeRef })).doc;
    d = sync(d, report({ [P]: { curves: { edge: { type: 'line', a: [0, 0], b: [5, 0] } } } }));
    const line = data(d).projections?.[P]?.curves.edge as SketchEntityId;
    const e = data(d).entities[line];
    if (e?.type !== 'line') throw new Error('no line');
    d = applyCommand(
      d,
      addToSketch({
        feature: F,
        entities: {
          ['q' as SketchEntityId]: { type: 'point', x: 0, y: 0 },
        },
        constraints: { ['k' as never]: { type: 'coincident', a: 'q', b: e.start } as never },
      }),
    ).doc;
    expect(() =>
      applyCommand(
        d,
        modifySketch({
          feature: F,
          label: 'Trim',
          update: { [line]: { ...e, construction: true } },
        }),
      ),
    ).toThrow(/Projected geometry/);
    d = sync(d, report({ [P]: { curves: {} } }));
    expect(data(d).entities[line]).toBeUndefined();
    expect(Object.keys(data(d).constraints)).toEqual([]);
  });

  it('are checked on load', () => {
    const bad = {
      entities: { p: { type: 'point', x: 0, y: 0 } },
      constraints: {},
      dimensions: {},
      projections: {
        x: { ref: { kind: 'plane', id: 'origin:xy' }, curves: { a: 'p', b: 'missing' } },
        p: { ref: edgeRef, curves: {} },
      },
    };
    const messages = sketchIssues(bad as never).map((i) => `${i.path.join('.')} ${i.message}`);
    expect(messages).toEqual([
      'projections.x must project an edge, a face, a vertex or a body, not a plane',
      'projections.x.curves.a must be a curve, not a point',
      'projections.x.curves.b refers to missing entity "missing"',
      'projections.p ID is also used in entities',
    ]);
  });

  it('take vertices and bodies, and intersections of faces and bodies (P4-12)', () => {
    const vertexRef = { kind: 'vertex' as const, id: 'v[extrude:E:cap:end|a|b]' };
    const bodyRef = { kind: 'body' as const, id: 'E' };
    let d = doc();
    d = applyCommand(d, addProjection({ feature: F, id: P, ref: vertexRef })).doc;
    d = applyCommand(d, addProjection({ feature: F, id: 'pr2' as ProjectionId, ref: bodyRef })).doc;
    d = applyCommand(
      d,
      addProjection({ feature: F, id: 'pr3' as ProjectionId, ref: bodyRef, mode: 'intersect' }),
    ).doc;
    expect(data(d).projections?.['pr3' as ProjectionId]).toEqual({
      ref: bodyRef,
      curves: {},
      mode: 'intersect',
    });
    // The same body can't be intersected twice, and edges can't be intersected at all.
    expect(() =>
      applyCommand(
        d,
        addProjection({ feature: F, id: 'pr4' as ProjectionId, ref: bodyRef, mode: 'intersect' }),
      ),
    ).toThrow(/already intersected/);
    expect(() =>
      applyCommand(
        d,
        addProjection({ feature: F, id: 'pr4' as ProjectionId, ref: edgeRef, mode: 'intersect' }),
      ),
    ).toThrow(/faces and bodies/);

    // A vertex becomes a point that moves with the report; a body its outline.
    d = sync(
      d,
      report({
        [P]: { curves: { vertex: { type: 'point', at: [3, 4] } } },
        ['pr2' as ProjectionId]: {
          curves: {
            'sil:f:0': {
              type: 'spline',
              mode: 'control',
              points: [
                [0, 0],
                [1, 2],
                [3, 2],
                [4, 0],
              ],
            },
          },
        },
        ['pr3' as ProjectionId]: {
          curves: { 'cut:0': { type: 'ellipse', center: [0, 0], major: [5, 0], minor: [0, 3] } },
        },
      }),
    );
    const point = data(d).projections?.[P]?.curves.vertex as SketchEntityId;
    expect(data(d).entities[point]).toEqual({ type: 'point', x: 3, y: 4 });
    expect(projectedEntities(data(d)).has(point)).toBe(true);
    const spline = data(d).projections?.['pr2' as ProjectionId]?.curves[
      'sil:f:0'
    ] as SketchEntityId;
    expect(data(d).entities[spline]).toMatchObject({ type: 'spline', mode: 'control' });
    expect(DocumentSchema.safeParse(d).success).toBe(true);

    d = sync(d, report({ [P]: { curves: { vertex: { type: 'point', at: [5, 4] } } } }));
    expect(data(d).projections?.[P]?.curves.vertex).toBe(point);
    expect(data(d).entities[point]).toEqual({ type: 'point', x: 5, y: 4 });
  });

  it('include curves without a link: plain entities, no record (P4-12)', () => {
    let d = applyCommand(
      doc(),
      addProjection({ feature: F, id: P, ref: faceRef, linked: false }),
    ).doc;
    expect(data(d).projections?.[P]).toEqual({ ref: faceRef, curves: {}, linked: false });
    const r = report({
      [P]: {
        curves: {
          a: { type: 'line', a: [0, 0], b: [10, 0] },
          b: { type: 'circle', center: [5, 5], radius: 2 },
        },
      },
    });
    // The linked sync leaves an include alone.
    expect(projectionSync(data(d), r, newId)).toBeUndefined();
    const included = includedCurves(data(d), r, newId)[P];
    expect(included?.count).toBe(2);
    d = applyCommand(
      d,
      includeProjection({ feature: F, id: P, entities: included?.entities ?? {} }),
    ).doc;
    expect(data(d).projections).toBeUndefined();
    const types = Object.values(data(d).entities)
      .map((e) => e.type)
      .sort();
    expect(types).toEqual(['circle', 'line', 'point', 'point', 'point']);
    expect(projectedEntities(data(d)).size).toBe(0);
    expect(includeLabel(2)).toBe('Include 2 curves');
    expect(includeLabel(1)).toBe('Include 1 curve');
    // A lost source is said so, with nothing to add.
    const lost = applyCommand(
      doc(),
      addProjection({ feature: F, id: P, ref: faceRef, linked: false }),
    ).doc;
    expect(includedCurves(data(lost), report({ [P]: { lost: true } }), newId)[P]).toEqual({
      entities: {},
      count: 0,
      lost: true,
    });
  });
});
