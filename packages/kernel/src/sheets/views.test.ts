// Sheet views through the recompute engine (P6-24 S2, ADR-0143's S2
// amendment): shapes whose views are known (a box, a holed box, a cylinder)
// from the standard directions in first and third angle, with the
// topological names the curves carry; the cache; a mesh body; and the quick
// polygonal view's effect on the display mesh.
import {
  type AttachmentId,
  type BodyId,
  type ExtrudoDocument,
  type Feature,
  importInputs,
  type PrimitiveInputOptions,
  type PrimitiveType,
  primitiveInputs,
  type SheetViewFrame,
  sheetBaseFrame,
  sheetProjectedFrame,
  sheetStandardFrom,
} from '@extrudo/core';
import { type TriangleMesh, writeStl } from '@extrudo/io';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { kernelFeatures } from '../features';
import { Kernel } from '../kernel';
import { loadManifold } from '../manifold';
import { loadOcct } from '../occt/load';
import { DEFAULT_TESSELLATION, RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature } from '../recompute/testing';
import type { ImportedFile } from '../recompute/types';
import type { ViewCurve, ViewGeometry, ViewPiece } from './geometry';
import type { SheetViewResult } from './views';

let kernel: Kernel;
let engine: RecomputeEngine | undefined;
const files = new Map<AttachmentId, ImportedFile>();

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  kernel.enableMeshes(await loadManifold());
});
afterEach(() => {
  engine?.clear();
  engine = undefined;
  files.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});
afterAll(() => kernel?.dispose());

function primitive(id: string, type: PrimitiveType, options: PrimitiveInputOptions): Feature {
  return { ...testFeature(id, type), inputs: primitiveInputs(type, options) };
}

async function recompute(doc: ExtrudoDocument) {
  engine ??= new RecomputeEngine(kernel, kernelFeatures(), {
    strictLeaks: true,
    files: (id) => files.get(id),
  });
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error(result.status);
  for (const [id, status] of Object.entries(result.features)) {
    if (status.status === 'error') throw new Error(`${id}: ${status.message}`);
  }
  return result;
}

function geometryOf(result: SheetViewResult): ViewGeometry {
  if ('error' in result) throw new Error(result.error);
  return result.geometry;
}

function view(frame: SheetViewFrame, more: { bodies?: BodyId[]; quick?: boolean } = {}) {
  const result = (engine as RecomputeEngine).sheetView({
    id: 'v',
    direction: frame.direction,
    up: frame.up,
    ...more,
  });
  return { result, geometry: geometryOf(result) };
}

const r2 = (v: number) => Math.round(v * 100) / 100 + 0;
const pt = ([x, y]: readonly [number, number]) => `(${r2(x)},${r2(y)})`;
function piece(p: ViewPiece): string {
  switch (p.type) {
    case 'line': {
      // Ends in a fixed order, so a reversed edge reads the same.
      const [a, b] = [pt(p.a), pt(p.b)].sort();
      return `L${a}${b}`;
    }
    case 'arc':
      return `A${pt(p.center)}r${r2(p.radius)}:${r2(((p.end - p.start) * 180) / Math.PI)}°`;
    case 'ellipse':
      return `E${pt(p.center)}${r2(p.rx)}x${r2(p.ry)}:${r2(((p.end - p.start) * 180) / Math.PI)}°`;
    case 'polyline':
      return `P${p.points.length}`;
  }
}
/** The curves of one kind as sorted strings, one per piece. */
const of = (g: ViewGeometry, kind: ViewCurve['kind']) =>
  g.curves
    .filter((c) => c.kind === kind)
    .flatMap((c) => c.pieces.map(piece))
    .sort();

const front = sheetBaseFrame(sheetStandardFrom('front').direction, sheetStandardFrom('front').up);
const frames = (angle: 'first' | 'third') => ({
  front,
  top: sheetProjectedFrame(front, angle, angle === 'third' ? 'above' : 'below'),
  right: sheetProjectedFrame(front, angle, angle === 'third' ? 'right' : 'left'),
  iso: sheetProjectedFrame(front, angle, 'iso-above-right'),
});

describe('a box, 10 × 20 × 30 on the XY plane (centred, z up)', () => {
  const doc = testDocument([
    primitive('Box1', 'box', { numbers: { length: '10 mm', width: '20 mm', height: '30 mm' } }),
  ]);

  for (const angle of ['first', 'third'] as const) {
    it(`draws its four standard views, ${angle} angle`, async () => {
      await recompute(doc);
      const f = frames(angle);
      const rect = (x: number, y: number) => [
        `L(${-x},0)(${-x},${y})`,
        `L(${-x},0)(${x},0)`,
        `L(${-x},${y})(${x},${y})`,
        `L(${x},0)(${x},${y})`,
      ];
      const fr = view(f.front).geometry;
      expect(of(fr, 'visible')).toEqual(rect(5, 30));
      // The back edges lie under the front ones: no hidden line is left.
      expect(of(fr, 'hidden')).toEqual([]);
      expect(fr.bounds).toEqual({ min: [-5, 0], max: [5, 30] });
      expect(fr.status).toBe('ok');
      expect(fr.exact).toBe(true);
      // Every curve carries its model edge's name.
      for (const c of fr.curves) expect(c.edge).toMatch(/^e\[/);
      const top = view(f.top).geometry;
      expect(top.bounds).toEqual({ min: [-5, -10], max: [5, 10] });
      expect(of(top, 'visible')).toHaveLength(4);
      const right = view(f.right).geometry;
      expect(right.bounds).toEqual({ min: [-10, 0], max: [10, 30] });
      expect(of(right, 'visible')).toEqual(rect(10, 30));
      const iso = view(f.iso).geometry;
      // Nine edges in sight; the three meeting at the far corner hidden.
      expect(of(iso, 'visible')).toHaveLength(9);
      expect(of(iso, 'hidden')).toHaveLength(3);
      const names = iso.curves.map((c) => c.edge);
      expect(new Set(names).size).toBe(12);
    });
  }

  it('lines the projected views up with the front view on the sheet', async () => {
    await recompute(doc);
    for (const angle of ['first', 'third'] as const) {
      const f = frames(angle);
      const fr = view(f.front).geometry.bounds;
      const right = view(f.right).geometry.bounds;
      const top = view(f.top).geometry.bounds;
      // A side view shares the front view's heights, a top view its widths.
      expect([right?.min[1], right?.max[1]]).toEqual([fr?.min[1], fr?.max[1]]);
      expect([top?.min[0], top?.max[0]]).toEqual([fr?.min[0], fr?.max[0]]);
    }
  });
});

describe('a box with a hole', () => {
  const doc = testDocument([
    primitive('Box1', 'box', { numbers: { length: '40 mm', width: '30 mm', height: '10 mm' } }),
    primitive('Hole1', 'cylinder', {
      numbers: { diameter: '10 mm', height: '10 mm' },
      operation: 'cut',
    }),
  ]);

  it('shows the hole hidden from the front and side, and as a circle from above', async () => {
    await recompute(doc);
    for (const angle of ['first', 'third'] as const) {
      const f = frames(angle);
      const fr = view(f.front).geometry;
      expect(of(fr, 'visible')).toHaveLength(4);
      // The hole's two outlines, dashed, named by the hole's face.
      expect(of(fr, 'hidden')).toEqual(['L(-5,0)(-5,10)', 'L(5,0)(5,10)']);
      const holeFaces = fr.curves.filter((c) => c.kind === 'hidden').map((c) => c.face);
      expect(holeFaces[0]).toBeDefined();
      expect(holeFaces[1]).toBe(holeFaces[0]);
      expect(view(f.right).geometry.curves.filter((c) => c.kind === 'hidden')).toHaveLength(2);
      const top = view(f.top).geometry;
      expect(of(top, 'visible')).toContain('A(0,0)r5:360°');
      expect(of(top, 'visible')).toHaveLength(5);
      // The bottom circle lies under the top one.
      expect(of(top, 'hidden')).toEqual([]);
      const iso = view(f.iso).geometry;
      // The top rim is a whole ellipse in sight (HLR's three pieces joined);
      // the bottom rim and the wall's outlines are hidden behind the top.
      expect(of(iso, 'visible').filter((p) => p.startsWith('E'))).toEqual(['E(0,8.16)5x2.89:360°']);
      expect(of(iso, 'hidden').filter((p) => p.startsWith('E'))).toEqual(['E(0,0)5x2.89:360°']);
      const wall = iso.curves.filter((c) => c.kind === 'hidden' && c.face && !c.edge);
      expect(wall.flatMap((c) => c.pieces.map(piece)).sort()).toEqual([
        'L(-5,0)(-5,8.16)',
        'L(5,0)(5,8.16)',
      ]);
      // And the box's three edges at its far corner.
      expect(
        iso.curves.filter((c) => c.kind === 'hidden' && c.edge && !c.edge.includes('Hole1')),
      ).toHaveLength(3);
    }
  });
});

describe('a cylinder, Ø10 × 20', () => {
  const doc = testDocument([
    primitive('Cyl1', 'cylinder', { numbers: { diameter: '10 mm', height: '20 mm' } }),
  ]);

  it('has two outlines from the side and one circle from above', async () => {
    await recompute(doc);
    for (const angle of ['first', 'third'] as const) {
      const f = frames(angle);
      for (const side of [view(f.front).geometry, view(f.right).geometry]) {
        // Outlines are named by their face; the caps are lines seen edge-on.
        expect(of(side, 'outline')).toEqual(['L(-5,0)(-5,20)', 'L(5,0)(5,20)']);
        const outlines = side.curves.filter((c) => c.kind === 'outline');
        for (const o of outlines) expect(o.face).toBe('cylinder:Cyl1:side:wall');
        // One of them lies on the side face's seam and keeps that edge's name.
        expect(outlines.filter((o) => o.edge !== undefined).length).toBeLessThanOrEqual(1);
        expect(of(side, 'visible')).toEqual(['L(-5,0)(5,0)', 'L(-5,20)(5,20)']);
        expect(of(side, 'hidden')).toEqual([]);
      }
      const top = view(f.top).geometry;
      expect(of(top, 'visible')).toEqual(['A(0,0)r5:360°']);
      expect(top.curves[0]?.edge).toMatch(/^e\[/);
      expect(of(top, 'hidden')).toEqual([]);
      const iso = view(f.iso).geometry;
      expect(of(iso, 'outline')).toHaveLength(2);
      // The bottom ellipse: its near half in sight, the far half hidden.
      expect(of(iso, 'visible').filter((p) => p.startsWith('E'))).toEqual([
        'E(0,0)5x2.89:180°',
        'E(0,16.33)5x2.89:360°',
      ]);
      expect(of(iso, 'hidden')).toEqual(['E(0,0)5x2.89:180°']);
    }
  });

  it('gives the quick placeholder, unnamed and not exact, then the exact lines from the cache', async () => {
    await recompute(doc);
    const quick = view(front, { quick: true }).geometry;
    expect(quick.exact).toBe(false);
    expect(quick.curves.length).toBeGreaterThan(0);
    for (const c of quick.curves) {
      expect(c.edge).toBeUndefined();
      expect(c.face).toBeUndefined();
    }
    const exact = view(front).geometry;
    expect(exact.exact).toBe(true);
    // Once the exact view is known, a quick request gets it.
    const again = view(front, { quick: true });
    expect(again.geometry).toBe(exact);
    expect('ms' in again.result && again.result.ms).toBe(0);
  });
});

describe('the cache', () => {
  const doc = (length: string, other: string) =>
    testDocument([
      primitive('Box1', 'box', { numbers: { length, width: '20 mm', height: '30 mm' } }),
      primitive('Box2', 'box', {
        numbers: { length: '5 mm', width: '5 mm', height: other, x: '50 mm' },
      }),
    ]);
  const bodyIds = (result: Awaited<ReturnType<typeof recompute>>) =>
    result.bodies.map((b) => b.id as BodyId);

  it('hits when no body of the view changed and misses when one did', async () => {
    const first = await recompute(doc('10 mm', '5 mm'));
    const [box1] = bodyIds(first);
    const a = view(front, { bodies: [box1 as BodyId] });
    expect(a.result).toMatchObject({ ms: expect.any(Number) });
    // A parameter of the other body: this view's body keeps its version.
    await recompute(doc('10 mm', '8 mm'));
    const b = view(front, { bodies: [box1 as BodyId] });
    expect(b.geometry).toBe(a.geometry);
    expect('ms' in b.result && b.result.ms).toBe(0);
    // Both bodies (absent `bodies`): the other one changed, so it misses.
    const all = view(front);
    expect(all.geometry.curves.map((c) => c.body)).toContain(box1);
    await recompute(doc('10 mm', '9 mm'));
    expect(view(front).geometry).not.toBe(all.geometry);
    // A change to the view's body misses and draws the new size.
    await recompute(doc('12 mm', '9 mm'));
    const c = view(front, { bodies: [box1 as BodyId] });
    expect(c.geometry).not.toBe(a.geometry);
    expect(c.geometry.bounds).toEqual({ min: [-6, 0], max: [6, 30] });
    // Scale and position aren't asked for; another direction is another entry.
    expect(view(frames('third').top, { bodies: [box1 as BodyId] }).geometry).not.toBe(c.geometry);
  });

  it('draws only shown bodies when `bodies` is absent', async () => {
    const shown = doc('10 mm', '5 mm');
    const result = await recompute(shown);
    const [box1, box2] = bodyIds(result);
    const hidden: ExtrudoDocument = {
      ...shown,
      bodies: { [box2 as BodyId]: { name: 'Box2', visible: false } },
    };
    await recompute(hidden);
    const g = view(front).geometry;
    expect(new Set(g.curves.map((c) => c.body))).toEqual(new Set([box1]));
  });

  it('skips a body the model no longer has: partial, not an error', async () => {
    await recompute(doc('10 mm', '5 mm'));
    const g = view(front, { bodies: ['gone' as BodyId] }).geometry;
    expect(g).toMatchObject({
      status: 'partial',
      curves: [],
      skipped: [{ body: 'gone', reason: 'missing' }],
    });
    expect(g.bounds).toBeUndefined();
  });

  it('gives a broken frame back as an error result', async () => {
    await recompute(doc('10 mm', '5 mm'));
    const result = (engine as RecomputeEngine).sheetView({
      id: 'v',
      direction: [0, 0, 1],
      up: [0, 0, 2],
    });
    expect(result).toEqual({ id: 'v', error: expect.stringMatching(/parallel/) });
  });
});

/** A closed 20 mm cube, counter-clockwise from outside. */
function cube(): TriangleMesh {
  const positions = new Float64Array([
    0, 0, 0, 20, 0, 0, 20, 20, 0, 0, 20, 0, 0, 0, 20, 20, 0, 20, 20, 20, 20, 0, 20, 20,
  ]);
  // biome-ignore format: two triangles per side
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    2, 3, 7, 2, 7, 6,
    1, 2, 6, 1, 6, 5,
    3, 0, 4, 3, 4, 7,
  ]);
  return { positions, indices };
}

describe('a mesh body', () => {
  it('is skipped: the view is partial and draws the other bodies', async () => {
    const file = 'mesh-file' as AttachmentId;
    files.set(file, { bytes: writeStl(cube()), mediaType: 'model/stl' });
    const doc: ExtrudoDocument = {
      ...testDocument([
        { ...testFeature('Import1', 'import'), inputs: importInputs({ file }) },
        primitive('Box1', 'box', { numbers: { x: '50 mm' } }),
      ]),
      attachments: {
        [file]: {
          name: 'cube',
          fileName: 'cube.stl',
          mediaType: 'model/stl',
          sha256: 'c'.repeat(64),
          size: 1,
        },
      },
    };
    const result = await recompute(doc);
    const mesh = result.bodies.find((b) => b.id.startsWith('Import1'))?.id as BodyId;
    const { geometry } = view(front);
    expect(geometry.status).toBe('partial');
    expect(geometry.skipped).toEqual([{ body: mesh, reason: 'mesh' }]);
    expect(of(geometry, 'visible')).toHaveLength(4);
    expect(view(front, { quick: true }).geometry.skipped).toEqual([{ body: mesh, reason: 'mesh' }]);
  });
});

describe('the quick view and the display mesh', () => {
  /** A box with a round boss: curved faces, so a mesh's density shows in its triangle count. */
  const doc = testDocument([
    primitive('Box1', 'box', { numbers: { length: '30 mm', width: '30 mm', height: '10 mm' } }),
    primitive('Boss1', 'cylinder', {
      numbers: { diameter: '10 mm', height: '20 mm' },
      operation: 'join',
    }),
  ]);

  it('hlrPolySpans on an unmeshed shape leaves its own mesh, which the display mesh keeps', () => {
    using scope = kernel.scope();
    const fresh = () => {
      const box = scope.track(kernel.box([30, 30, 10]));
      const cyl = scope.track(kernel.cylinder(5, 20));
      return scope.track(kernel.fuse(box, cyl).shape);
    };
    const triangles = (s: ReturnType<typeof fresh>) =>
      kernel.mesh(s, DEFAULT_TESSELLATION).indices.length / 3;
    const plain = triangles(fresh());
    const meshedFirst = fresh();
    kernel.hlrPolySpans(meshedFirst, [0, -1, 0], 0.005);
    // Finer than the display asks for: kept, so the viewport would get more triangles.
    expect(triangles(meshedFirst)).toBeGreaterThan(plain);
    const displayFirst = fresh();
    expect(triangles(displayFirst)).toBe(plain);
    kernel.hlrPolySpans(displayFirst, [0, -1, 0], 0.005);
    // Meshed for display first: the polygonal run uses that mesh and changes nothing.
    expect(triangles(displayFirst)).toBe(plain);
  });

  it('gives a body the engine never meshed its display mesh before the quick view', async () => {
    await recompute(doc);
    const e = engine as RecomputeEngine;
    const [id] = [...(await recompute(doc)).bodies.map((b) => b.id as BodyId)];
    const shape = e.latestBody(id as BodyId);
    const before = kernel.mesh(shape as never, DEFAULT_TESSELLATION).indices.length;
    // A second engine on the same kernel never meshed its bodies (as after a
    // restart, when the app already holds every mesh: `have`).
    const other = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
    const result = await other.recompute({
      doc,
      have: Object.fromEntries((await recompute(doc)).bodies.map((b) => [b.id, b.version])),
    });
    if (result.status !== 'done') throw new Error(result.status);
    expect(result.bodies.every((b) => b.mesh === undefined)).toBe(true);
    const q = other.sheetView({ id: 'q', ...front, quick: true });
    expect('geometry' in q && q.geometry.exact).toBe(false);
    const theirs = other.latestBody(id as BodyId);
    expect(kernel.mesh(theirs as never, DEFAULT_TESSELLATION).indices.length).toBe(before);
    other.clear();
  });
});
