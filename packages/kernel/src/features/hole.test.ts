// The hole feature (P3-04, ADR-0049, FR-FT-07) through the recompute engine
// with real OCCT: simple, counterbore and countersink holes, blind and
// through, drill points, placement at a clicked point and at sketch points,
// direction, the names they give (ADR-0005), and the errors and warnings.
// `golden/hole-options.json` is the golden table of cases (a Vitest file
// snapshot); rewrite it with `pnpm vitest run -u packages/kernel/src/features/hole`
// and review the diff.
import {
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
  filletInputs,
  type GeomRef,
  HOLE_TYPE,
  type HoleInputOptions,
  type HoleSettings,
  holeInputs,
  mirrorInputs,
  originAxisRef,
  originPlaneRef,
  rectangularPatternInputs,
  type SketchData,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Kernel, type ShapeHandle } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { FeatureOutput, KernelFeatureDefinition, RecomputeResult } from '../recompute/types';
import type { HoleOutputData } from './hole';
import { holeSection } from './hole';

let kernel: Kernel;
let engine: RecomputeEngine;
const seen = new Map<string, FeatureOutput>();

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

beforeEach(() => {
  engine?.clear();
  expect(kernel.stats().liveShapes).toBe(0);
  const registry = new FeatureRegistry<KernelFeatureDefinition>();
  for (const definition of testFeatures().registry.list()) {
    registry.register({
      ...definition,
      evaluate(ctx) {
        const output = definition.evaluate(ctx);
        seen.set(ctx.feature.id, output);
        return output;
      },
    });
  }
  engine = new RecomputeEngine(kernel, registry, { strictLeaks: true });
});

afterAll(() => {
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

type Done = Extract<RecomputeResult, { status: 'done' }>;

// ------------------------------------------------------------------ helpers

function hole(id: string, options: HoleInputOptions = {}): Feature {
  return { ...testFeature(id, HOLE_TYPE), inputs: holeInputs(options) };
}

function rect(b: SketchBuilder, x: number, y: number, w: number, h: number) {
  b.line(x, y, x + w, y);
  b.line(x + w, y, x + w, y + h);
  b.line(x + w, y + h, x, y + h);
  b.line(x, y + h, x, y);
}

function sketch(id: string, data: SketchData, plane = originPlaneRef('origin:xy')): Feature {
  return { ...testFeature(id, 'sketch'), inputs: sketchInputs(plane, data) };
}

/**
 * A 60 × 40 block, x 0…60, y 0…40, z 0…`height` (body `B:0`): its top face is
 * `extrude:B:cap:end`, its bottom `extrude:B:cap:start`.
 */
function block(height = '10 mm'): Feature[] {
  const b = new SketchBuilder();
  rect(b, 0, 0, 60, 40);
  const [profile] = detectProfiles(b.sketch);
  if (!profile) throw new Error('no profile');
  const ref: GeomRef = { kind: 'profile', id: `SB/${profile.id}` };
  return [
    sketch('SB', b.sketch),
    { ...testFeature('B', 'extrude'), inputs: extrudeInputs([ref], { distance: height }) },
  ];
}

const TOP: GeomRef = { kind: 'face', id: 'extrude:B:cap:end' };
const BOTTOM: GeomRef = { kind: 'face', id: 'extrude:B:cap:start' };

async function run(doc: ExtrudoDocument): Promise<Done> {
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error('cancelled');
  return result;
}

const status = (result: Done, id: string): FeatureStatus =>
  result.features[id as FeatureId] ?? { status: 'ok' };

function ok(result: Done): Done {
  for (const [id, s] of Object.entries(result.features)) {
    if (s.status !== 'ok') throw new Error(`${id}: ${s.status} ${s.message ?? ''}`);
  }
  return result;
}

let bodyShapes = new Map<string, ShapeHandle>();

/** A recompute that also captures the body shapes (through a spy on the kernel's mesh call). */
async function runWithShapes(doc: ExtrudoDocument): Promise<Done> {
  bodyShapes = new Map();
  const shapes: ShapeHandle[] = [];
  const mesh = kernel.mesh.bind(kernel);
  kernel.mesh = (shape, options) => {
    shapes.push(shape);
    return mesh(shape, options);
  };
  try {
    const result = await run(doc);
    result.bodies.forEach((b, i) => {
      const shape = shapes[i];
      if (shape !== undefined) bodyShapes.set(b.id, shape);
    });
    return result;
  } finally {
    kernel.mesh = mesh;
  }
}

function measure(result: Done, body: string) {
  const found = result.bodies.find((b) => b.id === body);
  const shape = bodyShapes.get(body) as ShapeHandle | undefined;
  if (!found || shape === undefined) throw new Error(`no body ${body}`);
  const m = kernel.measure(shape);
  const solids = kernel.solids(shape);
  kernel.release(...solids);
  return {
    volume: m.volume,
    bbox: m.bbox,
    faces: kernel.count(shape, 'face'),
    solids: solids.length,
    valid: kernel.isValid(shape),
    names: found.mesh?.faceIds ?? [],
    edges: found.mesh?.edgeIds ?? [],
  };
}

const round = (x: number, digits = 3) => {
  const r = Number(x.toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
};

const close = (a: number, b: number, tolerance = 2e-3) =>
  expect(Math.abs(a - b), `${a} ≈ ${b}`).toBeLessThanOrEqual(tolerance * Math.max(1, Math.abs(b)));

const PI = Math.PI;
const BLOCK = 60 * 40 * 10;

/** Names the hole made, without the block's own. */
const holeNames = (names: readonly string[]) => names.filter((n) => n.startsWith('hole:')).sort();

// ------------------------------------------------------------------ tests

describe('hole', { timeout: 120_000 }, () => {
  it('a blind simple hole at a clicked point: a cylinder and a drill point', async () => {
    const doc = testDocument([
      ...block(),
      hole('H', {
        plane: TOP,
        numbers: { diameter: '6 mm', depth: '4 mm', x: '30 mm', y: '20 mm' },
      }),
    ]);
    const result = ok(await runWithShapes(doc));
    const m = measure(result, 'B:0');
    // The cylinder plus a 118° cone.
    const cone = ((PI * 9) / 3) * (3 / Math.tan((59 * PI) / 180));
    close(m.volume, BLOCK - PI * 9 * 4 - cone);
    expect(m.valid).toBe(true);
    expect(m.solids).toBe(1);
    // 6 faces + the wall + the tip.
    expect(m.faces).toBe(8);
    expect(holeNames(m.names)).toEqual(['hole:H:side:tip', 'hole:H:side:wall']);
    expect(m.edges).toContain('e[extrude:B:cap:end|hole:H:side:wall]');
    expect(m.edges).toContain('e[hole:H:side:tip|hole:H:side:wall]');
    const data = seen.get('H')?.data as HoleOutputData;
    expect(data.direction.map((v) => round(v))).toEqual([0, 0, -1]);
    expect(data.holes.length).toBe(1);
    expect(data.holes[0]?.at.map((v) => round(v))).toEqual([30, 20, 10]);
  });

  it('a flat-bottomed blind hole (0° drill point) has a floor', async () => {
    const doc = testDocument([
      ...block(),
      hole('H', {
        plane: TOP,
        numbers: { diameter: '6 mm', depth: '4 mm', tipAngle: '0 deg', x: '30 mm', y: '20 mm' },
      }),
    ]);
    const result = ok(await runWithShapes(doc));
    const m = measure(result, 'B:0');
    close(m.volume, BLOCK - PI * 9 * 4);
    expect(holeNames(m.names)).toEqual(['hole:H:side:floor', 'hole:H:side:wall']);
  });

  it('a through hole goes right through, opening the far face', async () => {
    const doc = testDocument([
      ...block(),
      hole('H', {
        plane: TOP,
        extent: 'through',
        numbers: { diameter: '6 mm', x: '30 mm', y: '20 mm' },
      }),
    ]);
    const result = ok(await runWithShapes(doc));
    const m = measure(result, 'B:0');
    close(m.volume, BLOCK - PI * 9 * 10);
    expect(m.valid).toBe(true);
    expect(m.faces).toBe(7);
    expect(holeNames(m.names)).toEqual(['hole:H:side:wall']);
    expect(m.edges).toContain('e[extrude:B:cap:end|hole:H:side:wall]');
    expect(m.edges).toContain('e[extrude:B:cap:start|hole:H:side:wall]');
  });

  it('a counterbore: a step and a floor', async () => {
    const doc = testDocument([
      ...block(),
      hole('H', {
        plane: TOP,
        type: 'counterbore',
        extent: 'through',
        numbers: {
          diameter: '4 mm',
          cbDiameter: '8 mm',
          cbDepth: '3 mm',
          x: '30 mm',
          y: '20 mm',
        },
      }),
    ]);
    const result = ok(await runWithShapes(doc));
    const m = measure(result, 'B:0');
    close(m.volume, BLOCK - PI * 16 * 3 - PI * 4 * 7);
    expect(m.valid).toBe(true);
    expect(holeNames(m.names)).toEqual([
      'hole:H:side:cbfloor',
      'hole:H:side:cbwall',
      'hole:H:side:wall',
    ]);
  });

  it('a countersink: a cone from the surface down to the hole', async () => {
    const doc = testDocument([
      ...block(),
      hole('H', {
        plane: TOP,
        type: 'countersink',
        extent: 'through',
        numbers: {
          diameter: '4 mm',
          csDiameter: '8 mm',
          csAngle: '90 deg',
          x: '30 mm',
          y: '20 mm',
        },
      }),
    ]);
    const result = ok(await runWithShapes(doc));
    const m = measure(result, 'B:0');
    // The cone runs (8 − 4) / 2 = 2 mm deep at 90°.
    const cone = (PI * 2 * (16 + 4 + 8)) / 3;
    close(m.volume, BLOCK - cone - PI * 4 * 8);
    expect(holeNames(m.names)).toEqual(['hole:H:side:cone', 'hole:H:side:wall']);
  });

  it('flip drills from a plane the other way; the default goes against its normal', async () => {
    // From XY at the block's foot: down (the default) misses, up (flipped) cuts.
    const numbers = { diameter: '6 mm', depth: '4 mm', x: '30 mm', y: '20 mm' };
    const down = await runWithShapes(testDocument([...block(), hole('H', { numbers })]));
    expect(status(down, 'H').status).toBe('error');
    expect(status(down, 'H').message).toMatch(/doesn't remove anything/);
    const up = ok(
      await runWithShapes(testDocument([...block(), hole('H', { numbers, flip: true })])),
    );
    const m = measure(up, 'B:0');
    expect(m.valid).toBe(true);
    expect(holeNames(m.names)).toContain('hole:H:side:wall');
    close(m.volume, BLOCK - PI * 9 * 4 - ((PI * 9) / 3) * (3 / Math.tan((59 * PI) / 180)));
  });

  it('holes at sketch points: one hole each, named by the point', async () => {
    const b = new SketchBuilder();
    const p1 = b.point(15, 10);
    const p2 = b.point(45, 30);
    const doc = testDocument([
      ...block(),
      sketch('SK', b.sketch, TOP),
      hole('H', {
        plane: TOP,
        extent: 'through',
        numbers: { diameter: '4 mm' },
        points: [
          { kind: 'sketchEntity', id: `SK/${p1}` },
          { kind: 'sketchEntity', id: `SK/${p2}` },
        ],
      }),
    ]);
    const result = ok(await runWithShapes(doc));
    const m = measure(result, 'B:0');
    close(m.volume, BLOCK - 2 * PI * 4 * 10);
    expect(m.valid).toBe(true);
    expect(holeNames(m.names)).toEqual([`hole:H:side:${p1}.wall`, `hole:H:side:${p2}.wall`].sort());
    const data = seen.get('H')?.data as HoleOutputData;
    expect(data.holes.map((h) => h.at.map((v) => round(v)))).toEqual([
      [15, 10, 10],
      [45, 30, 10],
    ]);
  });

  it('a sketch point on another plane is dropped onto the face', async () => {
    const b = new SketchBuilder();
    const p = b.point(20, 20);
    const doc = testDocument([
      ...block(),
      // A sketch on XY (z = 0): its point drops up the normal onto the top face.
      sketch('SK', b.sketch),
      hole('H', {
        plane: TOP,
        extent: 'through',
        numbers: { diameter: '4 mm' },
        points: [{ kind: 'sketchEntity', id: `SK/${p}` }],
      }),
    ]);
    const result = ok(await runWithShapes(doc));
    close(measure(result, 'B:0').volume, BLOCK - PI * 4 * 10);
  });

  it('some points off the body: a warning; all of them: an error', async () => {
    const b = new SketchBuilder();
    const inside = b.point(15, 10);
    const outside = b.point(100, 10);
    const points = (ids: string[]): GeomRef[] =>
      ids.map((id) => ({ kind: 'sketchEntity', id: `SK/${id}` }));
    const base = [...block(), sketch('SK', b.sketch, TOP)];
    const some = await run(
      testDocument([
        ...base,
        hole('H', { plane: TOP, numbers: { diameter: '4 mm' }, points: points([inside, outside]) }),
      ]),
    );
    expect(status(some, 'H').status).toBe('warning');
    expect(status(some, 'H').message).toMatch(/1 of 2 holes don't reach a body/);
    const none = await run(
      testDocument([
        ...base,
        hole('H', { plane: TOP, numbers: { diameter: '4 mm' }, points: points([outside]) }),
      ]),
    );
    expect(status(none, 'H').status).toBe('error');
    expect(status(none, 'H').message).toMatch(/doesn't touch any body/);
  });

  it('a deleted sketch point is a lost reference', async () => {
    const b = new SketchBuilder();
    b.point(15, 10);
    const result = await run(
      testDocument([
        ...block(),
        sketch('SK', b.sketch, TOP),
        hole('H', {
          plane: TOP,
          numbers: { diameter: '4 mm' },
          points: [{ kind: 'sketchEntity', id: 'SK/nothing' }],
        }),
      ]),
    );
    expect(status(result, 'H').status).toBe('error');
    expect(status(result, 'H').message).toMatch(/sketch points/);
    expect(status(result, 'H').refs?.[0]?.state).toBe('lost');
  });

  it('later features find the hole’s faces: a fillet of its rim survives a size change', async () => {
    const rim: GeomRef = { kind: 'edge', id: 'e[extrude:B:cap:end|hole:H:side:wall]' };
    const fillet: Feature = {
      ...testFeature('F', 'fillet'),
      inputs: filletInputs([{ edges: [rim], radius: '1 mm' }]),
    };
    const doc = (diameter: string) =>
      testDocument([
        ...block(),
        hole('H', {
          plane: TOP,
          extent: 'through',
          numbers: { diameter, x: '30 mm', y: '20 mm' },
        }),
        fillet,
      ]);
    const first = ok(await runWithShapes(doc('6 mm')));
    const plain = 60 * 40 * 10 - PI * 9 * 10;
    // The rim is rounded: a little less than the plain drilled block.
    expect(measure(first, 'B:0').volume).toBeLessThan(plain);
    expect(measure(first, 'B:0').names.some((n) => n.startsWith('fillet:F:'))).toBe(true);
    const second = ok(await runWithShapes(doc('9 mm')));
    const m = measure(second, 'B:0');
    expect(m.valid).toBe(true);
    expect(m.names).toContain('hole:H:side:wall');
    expect(m.volume).toBeLessThan(60 * 40 * 10 - PI * 20.25 * 10);
    expect(m.volume).toBeGreaterThan(60 * 40 * 10 - PI * 20.25 * 10 - 40);
  });

  it('checks the sizes with messages', async () => {
    const cases: [HoleInputOptions, RegExp][] = [
      [{ numbers: { diameter: '0 mm' } }, /The diameter must be greater than 0/],
      [{ numbers: { depth: '0 mm' } }, /The depth must be greater than 0/],
      [{ numbers: { tipAngle: '180 deg' } }, /drill point angle must be from 0°/],
      [
        { type: 'counterbore', numbers: { diameter: '6 mm', cbDiameter: '5 mm' } },
        /counterbore diameter \(5 mm\) must be larger/,
      ],
      [
        { type: 'counterbore', numbers: { cbDepth: '12 mm', depth: '10 mm' } },
        /The counterbore \(12 mm\) is as deep as the hole/,
      ],
      [
        { type: 'countersink', numbers: { diameter: '6 mm', csDiameter: '6 mm' } },
        /countersink diameter \(6 mm\) must be larger/,
      ],
      [
        { type: 'countersink', numbers: { csAngle: '180 deg' } },
        /countersink angle must be more than 0/,
      ],
      [
        { type: 'countersink', numbers: { csDiameter: '30 mm', depth: '5 mm' } },
        /countersink is [\d.]+ mm deep, as deep as the hole/,
      ],
    ];
    for (const [options, message] of cases) {
      const result = await run(testDocument([...block(), hole('H', { plane: TOP, ...options })]));
      expect(status(result, 'H').status, JSON.stringify(options)).toBe('error');
      expect(status(result, 'H').message, JSON.stringify(options)).toMatch(message);
    }
  });

  it('only a flat face or a plane will do', async () => {
    const cylinder = {
      ...testFeature('C', 'cylinder'),
      inputs: { diameter: { kind: 'expr', expr: '20 mm', unit: 'length' } },
    } as Feature;
    const side: GeomRef = { kind: 'face', id: 'cylinder:C:side:wall' };
    const result = await run(testDocument([cylinder, hole('H', { plane: side })]));
    expect(status(result, 'H').status).toBe('error');
    expect(status(result, 'H').message).toMatch(/isn't flat/);
  });

  it('two points in one place make one hole', async () => {
    const b = new SketchBuilder();
    const p1 = b.point(15, 10);
    const p2 = b.point(15, 10);
    const result = await run(
      testDocument([
        ...block(),
        sketch('SK', b.sketch, TOP),
        hole('H', {
          plane: TOP,
          numbers: { diameter: '4 mm' },
          points: [p1, p2].map((id) => ({ kind: 'sketchEntity', id: `SK/${id}` }) as GeomRef),
        }),
      ]),
    );
    expect(status(result, 'H').status).toBe('warning');
    expect(status(result, 'H').message).toMatch(/same place/);
  });

  it('cuts a stack of bodies with a through hole and leaves untouched ones alone', async () => {
    // Two blocks one above the other: a through hole from the top cuts both.
    const top = hole('H', {
      plane: { kind: 'plane', id: 'origin:xy' },
      extent: 'through',
      flip: true,
      numbers: { diameter: '6 mm', x: '30 mm', y: '20 mm' },
    });
    const result = ok(await runWithShapes(testDocument([...block(), top])));
    close(measure(result, 'B:0').volume, BLOCK - PI * 9 * 10);
  });

  it('a pattern repeats a hole, faces and all, and a mirror does too', async () => {
    const H = hole('H', {
      plane: TOP,
      type: 'counterbore',
      extent: 'through',
      numbers: { diameter: '4 mm', cbDiameter: '8 mm', cbDepth: '3 mm', x: '10 mm', y: '10 mm' },
    });
    const one = ok(await runWithShapes(testDocument([...block(), H])));
    const single = measure(one, 'B:0').volume;
    const pattern: Feature = {
      ...testFeature('P', 'rectangularPattern'),
      inputs: rectangularPatternInputs({
        features: ['H'],
        direction1: originAxisRef('origin:x'),
        count1: '3',
        distance1: '15 mm',
      }),
    };
    const result = ok(await runWithShapes(testDocument([...block(), H, pattern])));
    const m = measure(result, 'B:0');
    close(m.volume, BLOCK - 3 * (BLOCK - single));
    expect(m.valid).toBe(true);
    // Three counterbored through holes: 6 block faces + 3 × (wall, step wall, step floor).
    expect(m.faces).toBe(6 + 9);
    expect(m.names.filter((n) => n.includes(':from:(hole:H:')).length).toBe(6);
    const mirrored: Feature = {
      ...testFeature('M', 'mirror'),
      inputs: mirrorInputs([], { kind: 'plane', id: 'origin:yz' }, { features: ['H'] }),
    };
    // Mirrored across YZ the hole at x = 10 has no partner inside the block (x 0…60 → −10):
    // a block centred on the plane would; here the cut misses and says so.
    const missed = await run(testDocument([...block(), H, mirrored]));
    expect(status(missed, 'M').status).toBe('error');
  });

  it('the section: vertices from the axis round to the axis, one source per segment', () => {
    const settings: HoleSettings = {
      plane: originPlaneRef('origin:xy'),
      points: [],
      type: 'counterbore',
      extent: 'blind',
      flip: false,
      exprs: new Set<string>(),
    };
    const section = holeSection(
      settings,
      {
        x: 0,
        y: 0,
        diameter: 4,
        depth: 6,
        tipAngle: 90,
        cbDiameter: 8,
        cbDepth: 2,
        csDiameter: 10,
        csAngle: 90,
      },
      0,
    );
    expect(section.vertices).toEqual([
      [0, 0],
      [4, 0],
      [4, 2],
      [2, 2],
      [2, 6],
      [0, 8],
    ]);
    expect(section.sources).toEqual(['top', 'cbwall', 'cbfloor', 'wall', 'tip', 'axis']);
  });

  it('golden table of cases', async () => {
    const cases: Record<string, { options: HoleInputOptions; features?: Feature[] }> = {
      'simple blind 5x6': {
        options: { plane: TOP, numbers: { depth: '6 mm', x: '30 mm', y: '20 mm' } },
      },
      'simple blind default depth (tip pokes through)': {
        options: { plane: TOP, numbers: { x: '30 mm', y: '20 mm' } },
      },
      'simple blind flat': {
        options: {
          plane: TOP,
          numbers: { depth: '6 mm', tipAngle: '0 deg', x: '30 mm', y: '20 mm' },
        },
      },
      'simple blind 90 point': {
        options: {
          plane: TOP,
          numbers: { depth: '6 mm', tipAngle: '90 deg', x: '30 mm', y: '20 mm' },
        },
      },
      'simple through 8': {
        options: {
          plane: TOP,
          extent: 'through',
          numbers: { diameter: '8 mm', x: '30 mm', y: '20 mm' },
        },
      },
      'simple through from below': {
        options: {
          plane: BOTTOM,
          extent: 'through',
          // The bottom face's frame looks up from below: its Y runs along world −Y.
          numbers: { diameter: '8 mm', x: '30 mm', y: '-20 mm' },
        },
      },
      'counterbore blind': {
        options: {
          plane: TOP,
          type: 'counterbore',
          numbers: {
            diameter: '4 mm',
            cbDiameter: '8 mm',
            cbDepth: '3 mm',
            depth: '8 mm',
            x: '30 mm',
            y: '20 mm',
          },
        },
      },
      'counterbore through': {
        options: {
          plane: TOP,
          type: 'counterbore',
          extent: 'through',
          numbers: {
            diameter: '4 mm',
            cbDiameter: '8 mm',
            cbDepth: '3 mm',
            x: '30 mm',
            y: '20 mm',
          },
        },
      },
      'countersink blind': {
        options: {
          plane: TOP,
          type: 'countersink',
          numbers: { diameter: '4 mm', csDiameter: '8 mm', depth: '8 mm', x: '30 mm', y: '20 mm' },
        },
      },
      'countersink through 82': {
        options: {
          plane: TOP,
          type: 'countersink',
          extent: 'through',
          numbers: {
            diameter: '4 mm',
            csDiameter: '9 mm',
            csAngle: '82 deg',
            x: '30 mm',
            y: '20 mm',
          },
        },
      },
      'deeper than the block, blind': {
        options: { plane: TOP, numbers: { depth: '25 mm', x: '30 mm', y: '20 mm' } },
      },
      'on the edge': {
        options: {
          plane: TOP,
          extent: 'through',
          numbers: { diameter: '6 mm', x: '0 mm', y: '20 mm' },
        },
      },
      'flat bottom exactly through': {
        options: {
          plane: TOP,
          numbers: { depth: '10 mm', tipAngle: '0 deg', x: '30 mm', y: '20 mm' },
        },
      },
      'big diameter': {
        options: {
          plane: TOP,
          extent: 'through',
          numbers: { diameter: '38 mm', x: '30 mm', y: '20 mm' },
        },
      },
    };
    const table: Record<string, unknown> = {};
    for (const [key, one] of Object.entries(cases)) {
      const result = await runWithShapes(testDocument([...block(), hole('H', one.options)]));
      const st = status(result, 'H');
      if (st.status === 'error') {
        table[key] = { error: st.message };
        continue;
      }
      const m = measure(result, 'B:0');
      table[key] = {
        volume: round(m.volume, 2),
        faces: m.faces,
        solids: m.solids,
        valid: m.valid,
        ...(st.status === 'warning' && { warning: st.message }),
        holeFaces: holeNames(m.names),
      };
    }
    await expect(`${JSON.stringify(table, null, 1)}\n`).toMatchFileSnapshot(
      './golden/hole-options.json',
    );
  });
});
