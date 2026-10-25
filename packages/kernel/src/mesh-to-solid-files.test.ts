// Mesh to Solid on real STL files (P4-13, ADR-0097's hardening slice A amendment):
// the owner's fixtures in fixtures/imports/mesh-to-solid/, and, when STL_DIR
// names a folder, every .stl under it (at TOL, default 0.01 mm), where only a
// trap fails: a refusal is an answer, a WASM RuntimeError is a bug.
import { read3mf, readStl } from '@extrudo/io';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import drillBlockStl from '../../../fixtures/imports/mesh-to-solid/drill-block.stl?url&inline';
import holeFillerStl from '../../../fixtures/imports/mesh-to-solid/hole-filler-35mm.stl?url&inline';
import pegPeregoStl from '../../../fixtures/imports/mesh-to-solid/peg-perego-button.stl?url&inline';
import puzzleBaseStl from '../../../fixtures/imports/mesh-to-solid/puzzle-base-circle.stl?url&inline';
import flightCoverStl from '../../../fixtures/imports/mesh-to-solid/remove-before-flight-cover.stl?url&inline';
import trackStl from '../../../fixtures/imports/mesh-to-solid/track-straight-100mm.stl?url&inline';
import repairFootStl from '../../../fixtures/imports/mesh-to-solid/trashcan-repair-foot.stl?url&inline';
import spacerStl from '../../../fixtures/imports/mesh-to-solid/trashcan-spacer.stl?url&inline';
import { Kernel, KernelError, type ShapeHandle } from './kernel';
import { loadManifold } from './manifold';
import { loadOcct } from './occt/load';

const env =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** The kernel's tsconfig has no Node types: a module name in a variable keeps tsc out of it. */
interface NodeFs {
  readdirSync(
    path: string,
    options: { withFileTypes: true },
  ): { name: string; isDirectory(): boolean }[];
  readFileSync(path: string): Uint8Array;
  mkdirSync(path: string, options: { recursive: true }): void;
  writeFileSync(path: string, data: Uint8Array): void;
}
const nodeFs = 'node:fs';
const fs =
  env.STL_DIR || env.MESH_FILE ? ((await import(/* @vite-ignore */ nodeFs)) as NodeFs) : undefined;

let kernel: Kernel;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  kernel.enableMeshes(await loadManifold());
});

afterEach(() => {
  expect(kernel.stats().liveShapes).toBe(0);
});

/** The bytes of a `data:` URL (Vite's `?url&inline` import of a fixture). */
function bytesOf(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Every .stl under `root`, sorted, relative to it. */
function stlFiles(files: NodeFs, root: string, under = ''): string[] {
  const list: string[] = [];
  for (const entry of files.readdirSync(`${root}/${under}`, { withFileTypes: true })) {
    const path = `${under}${entry.name}`;
    if (entry.isDirectory()) list.push(...stlFiles(files, root, `${path}/`));
    else if (/\.stl$/i.test(entry.name)) list.push(path);
  }
  return list.sort();
}

/** The signed volume of a triangle mesh. */
function meshVolume(positions: ArrayLike<number>, indices: ArrayLike<number>): number {
  const at = (i: number) => positions[i] as number;
  let v = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = 3 * (indices[t] as number);
    const b = 3 * (indices[t + 1] as number);
    const c = 3 * (indices[t + 2] as number);
    v +=
      at(a) * (at(b + 1) * at(c + 2) - at(b + 2) * at(c + 1)) -
      at(a + 1) * (at(b) * at(c + 2) - at(b + 2) * at(c)) +
      at(a + 2) * (at(b) * at(c + 1) - at(b + 1) * at(c));
  }
  return v / 6;
}

/** A refusal is a KernelError; anything else (a WASM RuntimeError) is rethrown. */
function refusal(error: unknown): string {
  if (error instanceof KernelError) return error.message;
  throw error;
}

/**
 * What prismatic makes of a fixture (at 0.01 mm unless `tolerance` says):
 * faces by kind and the unfit regions left out of the exact rebuild (slice
 * C), or the hybrid rebuild's unfit regions and facets (slice D1), or the
 * refusal.
 */
type Outcome =
  | {
      planes: number;
      cylinders: number;
      cones: number;
      spheres: number;
      tori: number;
      leftOut?: number;
      tolerance?: number;
      /** The hybrid rebuild (slice D1): its unfit regions (as `leftOut`) and facet faces. */
      hybrid?: { unfit: number; facets: number };
    }
  | { refusal: string; tolerance?: number };

// Slice C's fixtures. Slice D4: the exact stage runs only on a segmentation
// with no unfit region, so drill-block (3 unfit lettering walls) and
// track-straight at 0.05 mm (1 unfit socket-rim chamfer) go to the hybrid
// instead of leaving their unfit regions out of an exact rebuild. Where the
// exact rebuild fails (track-straight at 0.01 and 0.1 mm,
// remove-before-flight-cover at 0.01 mm), the hybrid rebuild converts, the
// unfit regions (and any region whose face wouldn't build) as facets.
const DRILL_BLOCK: Outcome = {
  planes: 108,
  cylinders: 65,
  cones: 0,
  spheres: 3,
  tori: 4,
  hybrid: { unfit: 3, facets: 208 },
};
const TRACK_001: Outcome = {
  planes: 65,
  cylinders: 2,
  cones: 2,
  spheres: 0,
  tori: 0,
  hybrid: { unfit: 2, facets: 237 },
};
const TRACK_005: Outcome = {
  planes: 66,
  cylinders: 6,
  cones: 2,
  spheres: 0,
  tori: 0,
  hybrid: { unfit: 1, facets: 145 },
  tolerance: 0.05,
};
const TRACK_01: Outcome = {
  planes: 69,
  cylinders: 8,
  cones: 2,
  spheres: 0,
  tori: 0,
  hybrid: { unfit: 0, facets: 0 },
  tolerance: 0.1,
};
const FLIGHT_COVER: Outcome = {
  planes: 252,
  cylinders: 62,
  cones: 4,
  spheres: 0,
  tori: 0,
  hybrid: { unfit: 5, facets: 120 },
};

const fixtures: [string, string, Outcome][] = [
  [
    'hole-filler-35mm.stl',
    holeFillerStl,
    { planes: 3, cylinders: 2, cones: 0, spheres: 0, tori: 1 },
  ],
  [
    'trashcan-repair-foot.stl',
    repairFootStl,
    { planes: 12, cylinders: 4, cones: 0, spheres: 0, tori: 0 },
  ],
  [
    'puzzle-base-circle.stl',
    puzzleBaseStl,
    { planes: 35, cylinders: 1, cones: 0, spheres: 0, tori: 1 },
  ],
  [
    'trashcan-spacer.stl',
    spacerStl,
    {
      // Slice C: a fillet network whose short fillets are 0.016-0.026 mm off
      // round (twisted facets); those leftovers drop the split (ADR-0097), so
      // the network is one unfit region: slice D1 keeps it as facets.
      planes: 2,
      cylinders: 0,
      cones: 0,
      spheres: 4,
      tori: 4,
      hybrid: { unfit: 1, facets: 409 },
    },
  ],
  [
    // Slice D1: a freeform shell (39 % of the surface) as facets, the rest exact.
    'peg-perego-button.stl',
    pegPeregoStl,
    {
      planes: 108,
      cylinders: 94,
      cones: 8,
      spheres: 10,
      tori: 2,
      hybrid: { unfit: 3, facets: 670 },
    },
  ],
  // Slice C: unfit regions under 2 % of the surface are left out of the rebuild.
  ['drill-block.stl', drillBlockStl, DRILL_BLOCK],
  ['track-straight-100mm.stl', trackStl, TRACK_001],
  ['track-straight-100mm.stl', trackStl, TRACK_005],
  ['track-straight-100mm.stl', trackStl, TRACK_01],
  ['remove-before-flight-cover.stl', flightCoverStl, FLIGHT_COVER],
];

describe('Mesh to Solid, prismatic on the fixtures', { timeout: 120_000 }, () => {
  for (const [name, url, outcome] of fixtures) {
    const tolerance = outcome.tolerance ?? 0.01;
    it(`converts ${name} at ${tolerance} mm${'refusal' in outcome ? ' (refused)' : ''}`, () => {
      const stl = readStl(bytesOf(url));
      const volume = meshVolume(stl.mesh.positions, stl.mesh.indices);
      const mesh = kernel.meshFrom(stl.mesh);
      try {
        if ('refusal' in outcome) {
          expect(() => kernel.meshToSolid(mesh, { method: 'prismatic', tolerance })).toThrow(
            new KernelError(outcome.refusal),
          );
          return;
        }
        const { shape, report } = kernel.meshToSolid(mesh, { method: 'prismatic', tolerance });
        try {
          const { planes, cylinders, cones, spheres, tori } = report;
          expect({ planes, cylinders, cones, spheres, tori }).toEqual({
            planes: outcome.planes,
            cylinders: outcome.cylinders,
            cones: outcome.cones,
            spheres: outcome.spheres,
            tori: outcome.tori,
          });
          expect(report.rebuild).toBe(outcome.hybrid ? 'hybrid' : 'exact');
          expect(report.facets).toBe(outcome.hybrid?.facets ?? 0);
          expect(report.unfit.regions).toBe(outcome.hybrid?.unfit ?? outcome.leftOut ?? 0);
          if (outcome.leftOut) expect(report.unfit.fraction).toBeLessThanOrEqual(0.02);
          expect(kernel.isValid(shape)).toBe(true);
          expect(Math.abs(kernel.properties(shape).volume / volume - 1)).toBeLessThan(0.005);
        } finally {
          kernel.release(shape);
        }
      } finally {
        kernel.release(mesh);
      }
    });
  }
});

// Slice D2: the same fixtures with the Auto tolerance (absent = Auto): each
// picks a ladder step (0.01, 0.02, 0.05 or 0.1 mm) and converts no worse than
// at 0.01 mm.
describe('Mesh to Solid, prismatic on the fixtures at Auto', { timeout: 120_000 }, () => {
  // [name, url, the ladder step Auto picks, the outcome; slice D3: the
  // result's edges and circle edges where the hybrid collapsed its chains
  // (before: peg-perego-button 2,189 edges, trashcan-spacer 443,
  // track-straight 847, no circles)]
  const autoFixtures: [
    string,
    string,
    number,
    { faces: number; rebuild: string; edges?: number; circles?: number },
  ][] = [
    ['hole-filler-35mm.stl', holeFillerStl, 0.01, { faces: 6, rebuild: 'exact' }],
    ['trashcan-repair-foot.stl', repairFootStl, 0.01, { faces: 16, rebuild: 'exact' }],
    ['puzzle-base-circle.stl', puzzleBaseStl, 0.01, { faces: 37, rebuild: 'exact' }],
    [
      'trashcan-spacer.stl',
      spacerStl,
      0.05,
      { faces: 78, rebuild: 'hybrid', edges: 359, circles: 12 },
    ],
    [
      'peg-perego-button.stl',
      pegPeregoStl,
      0.02,
      { faces: 212, rebuild: 'hybrid', edges: 1488, circles: 21 },
    ],
    ['drill-block.stl', drillBlockStl, 0.01, { faces: 388, rebuild: 'hybrid' }],
    [
      'track-straight-100mm.stl',
      trackStl,
      0.01,
      { faces: 306, rebuild: 'hybrid', edges: 627, circles: 4 },
    ],
    ['remove-before-flight-cover.stl', flightCoverStl, 0.01, { faces: 438, rebuild: 'hybrid' }],
  ];
  for (const [name, url, tolerance, outcome] of autoFixtures) {
    it(`converts ${name} with Auto at ${tolerance} mm`, () => {
      const stl = readStl(bytesOf(url));
      const volume = meshVolume(stl.mesh.positions, stl.mesh.indices);
      const mesh = kernel.meshFrom(stl.mesh);
      try {
        const { shape, report } = kernel.meshToSolid(mesh, { method: 'prismatic', tolerance: -1 });
        try {
          expect(report).toMatchObject({
            auto: true,
            tolerance,
            rebuild: outcome.rebuild,
            faces: outcome.faces,
          });
          expect(kernel.isValid(shape)).toBe(true);
          expect(Math.abs(kernel.properties(shape).volume / volume - 1)).toBeLessThan(0.02);
          if (outcome.edges !== undefined) {
            expect(edgeCounts(shape)).toBe(`${outcome.edges} edges, ${outcome.circles} circles`);
          }
        } finally {
          kernel.release(shape);
        }
      } finally {
        kernel.release(mesh);
      }
    });
  }
});

describe('Mesh to Solid, faceted on the fixtures the 5,000 cap allows', {
  timeout: 120_000,
}, () => {
  // Slice D4 raised FACETED_FACE_CAP from 2,000 to 5,000: these two fixtures'
  // coplanar-facet counts are between the old and new cap, so Faceted converts
  // them now (each in under 20 s in node; the measured times are in the ADR).
  const cases: [string, string, number][] = [
    ['drill-block.stl', drillBlockStl, 2532],
    ['peg-perego-button.stl', pegPeregoStl, 3846],
  ];
  for (const [name, url, faces] of cases) {
    it(`converts ${name} in Faceted (${faces} faces) in under 20 s`, () => {
      const mesh = kernel.meshFrom(readStl(bytesOf(url)).mesh);
      try {
        const start = performance.now();
        const { shape, report } = kernel.meshToSolid(mesh, { method: 'faceted', tolerance: 0.01 });
        const ms = performance.now() - start;
        try {
          expect(report).toMatchObject({ faces, planes: faces });
          expect(kernel.count(shape, 'face')).toBe(faces);
          expect(kernel.isValid(shape)).toBe(true);
          expect(ms).toBeLessThan(20_000);
        } finally {
          kernel.release(shape);
        }
      } finally {
        kernel.release(mesh);
      }
    });
  }
});

describe('Mesh to Solid, the segmentation', { timeout: 120_000 }, () => {
  it('puts every triangle of trashcan-spacer.stl on a surface, and converts or refuses it without a trap', () => {
    // At 0.1 and 0.2 mm, splitComponent's border moves once left regions on no
    // surface (and others on two): meshRegions mapped their triangles to -1
    // and the rebuild indexed adjacent[-1] (ADR-0097's hardening slice A amendment).
    const mesh = kernel.meshFrom(readStl(bytesOf(spacerStl)).mesh);
    try {
      for (const tolerance of [0.1, 0.2]) {
        const regions = kernel.meshRegions(mesh, tolerance);
        expect(regions.surfaceOf.filter((s) => s < 0 || s >= regions.kinds.length)).toHaveLength(0);
        try {
          kernel.release(kernel.meshToSolid(mesh, { method: 'prismatic', tolerance }).shape);
        } catch (error) {
          expect(error).toBeInstanceOf(KernelError);
        }
      }
    } finally {
      kernel.release(mesh);
    }
  });
});

/**
 * MESH_OUT: the mesh as the kernel stages it (manifold's order), for the spike
 * harness's `f` case: uint32 nodes, uint32 triangles, float32 xyz, uint32 corners.
 */
function writeStagedMesh(mesh: ShapeHandle, path: string): void {
  const { positions, indices } = kernel.exportMesh(mesh, {
    linearDeflection: 0.1,
    angularDeflection: 0.5,
  });
  const nodes = positions.length / 3;
  const bytes = new ArrayBuffer(8 + 4 * positions.length + 4 * indices.length);
  new Uint32Array(bytes, 0, 2).set([nodes, indices.length / 3]);
  new Float32Array(bytes, 8, positions.length).set(positions);
  new Uint32Array(bytes, 8 + 4 * positions.length, indices.length).set(indices);
  fs?.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  fs?.writeFileSync(path, new Uint8Array(bytes));
}

/** "812 edges, 40 circles": a result's edges and how many are circles (slice D3's collapsed rims). */
function edgeCounts(shape: ShapeHandle): string {
  const edges = kernel.count(shape, 'edge');
  let circles = 0;
  for (let i = 0; i < edges; i++) if (kernel.edgeGeometry(shape, i, 2).type === 'circle') circles++;
  return `${edges} edges, ${circles} circles`;
}

const stlDir = env.STL_DIR;
// TOL=auto (or AUTO=1) runs prismatic with the Auto tolerance (ADR-0097, slice D2).
const auto = env.TOL === 'auto' || env.AUTO === '1';
const tolerance = auto ? -1 : Number(env.TOL ?? '0.01');
const only = env.FILE;

describe.skipIf(!stlDir)('Mesh to Solid over STL_DIR', { timeout: 3_600_000 }, () => {
  const root = stlDir as string;
  for (const name of fs && stlDir ? stlFiles(fs, root) : []) {
    if (only && name !== only) continue;
    it(name, () => {
      const stl = readStl(new Uint8Array((fs as NodeFs).readFileSync(`${root}/${name}`)));
      const volume = meshVolume(stl.mesh.positions, stl.mesh.indices);
      const cells: string[] = [name, String(stl.mesh.indices.length / 3)];
      let mesh: ShapeHandle | undefined;
      try {
        mesh = kernel.meshFrom(stl.mesh);
      } catch (error) {
        cells.push(`mesh: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (mesh) {
        try {
          if (env.MESH_OUT) {
            writeStagedMesh(mesh, `${env.MESH_OUT}/${name.replace(/\.stl$/i, '.mesh')}`);
          }
          try {
            const r = kernel.meshRegions(mesh, tolerance);
            cells.push(
              `${r.planes}/${r.cylinders}/${r.cones}/${r.spheres}/${r.tori}`,
              `${r.unfit.regions}${r.suggestedTolerance ? `, try ${r.suggestedTolerance}` : ''}`,
              ...(auto ? [`auto ${r.tolerance ?? '?'} mm`] : []),
            );
          } catch (error) {
            cells.push(refusal(error), '');
          }
          for (const method of ['prismatic', 'faceted'] as const) {
            const t0 = performance.now();
            try {
              const { shape, report } = kernel.meshToSolid(mesh, { method, tolerance });
              try {
                const ratio = kernel.properties(shape).volume / volume;
                const leftOut =
                  report.rebuild === 'hybrid'
                    ? `, hybrid: ${report.unfit.regions} unfit, ${report.facets} facets`
                    : report.unfit.regions
                      ? `, ${report.unfit.regions} unfit left out`
                      : '';
                const autoText = report.auto ? `, auto ${report.tolerance} mm` : '';
                const ms = Math.round(performance.now() - t0);
                cells.push(
                  `✓ ${report.faces} faces (${report.planes}/${report.cylinders}/${report.cones}/${report.spheres}/${report.tori})${leftOut}${autoText}, ${edgeCounts(shape)}, valid ${kernel.isValid(shape)}, vol ${ratio.toFixed(4)} (${ms} ms)`,
                );
              } finally {
                kernel.release(shape);
              }
            } catch (error) {
              cells.push(`✗ ${refusal(error)} (${Math.round(performance.now() - t0)} ms)`);
            }
          }
        } finally {
          kernel.release(mesh);
        }
      }
      console.log(`| ${cells.join(' | ')} |`);
    });
  }
});

// The offset bug on converted bodies (ADR-0097 amendment, 2026-10-24): a real
// mesh the owner hit this with, converted prismatic Auto, then features on its
// top face. Local only: MESH_FILE=<path to .3mf or .stl>, skipped otherwise
// (the file is private; CI never sees it).
const meshFile = env.MESH_FILE;

/** The bytes of a mesh file as the kernel stages it: a 3MF's first item mesh, or an STL's. */
function readMeshFile(fs: NodeFs, path: string) {
  const bytes = new Uint8Array(fs.readFileSync(path));
  if (/\.3mf$/i.test(path)) return read3mf(bytes).items[0]?.meshes[0]?.object.mesh;
  return readStl(bytes).mesh;
}

describe.skipIf(!meshFile)(
  'Mesh to Solid, then features, over MESH_FILE',
  {
    timeout: 3_600_000,
  },
  () => {
    it(`${meshFile} converts and takes Offset Face, Fillet, Shell and Press Pull`, () => {
      const mesh0 = readMeshFile(fs as NodeFs, meshFile as string);
      if (!mesh0) throw new Error(`no mesh in ${meshFile}`);
      const mesh = kernel.meshFrom(mesh0);
      let shape: ShapeHandle | undefined;
      try {
        const t0 = performance.now();
        const solid = kernel.meshToSolid(mesh, { method: 'prismatic', tolerance: -1 });
        shape = solid.shape;
        const { report } = solid;
        console.log(
          `MESH_FILE ${meshFile}: triangles ${mesh0.indices.length / 3}, ${report.faces} faces ` +
            `(${report.planes}/${report.cylinders}/${report.cones}/${report.spheres}/${report.tori})` +
            `${report.rebuild ? `, ${report.rebuild}` : ''}${report.facets ? `, ${report.facets} facets` : ''}` +
            `${report.auto ? `, auto ${report.tolerance} mm` : ''}, ${edgeCounts(shape)}, valid ${kernel.isValid(shape)}` +
            `, vol ${report ? kernel.properties(shape).volume.toFixed(2) : '?'} (${Math.round(performance.now() - t0)} ms)`,
        );
        const info = kernel.describe(shape).faces;
        // The top face: the plane face with the highest centroid z.
        let top = -1;
        for (let i = 0; i < info.length; i++) {
          const f = info[i];
          if (f?.type !== 'plane') continue;
          if (top < 0 || (f.centroid[2] as number) > (info[top]?.centroid[2] as number)) top = i;
        }
        expect(top).toBeGreaterThanOrEqual(0);
        const topInfo = info[top];
        console.log(
          `  top face ${top}: centroid ${topInfo?.centroid.map((v) => v.toFixed(2)).join(',')}` +
            `, tangent ${JSON.stringify(kernel.tangentFaces(shape, top))}`,
        );
        for (const d of [2.6, 0.5, -0.5]) {
          const t = performance.now();
          try {
            const result = kernel.offsetFaces(shape, [top], d);
            console.log(
              `  Offset Face ${d} mm: ok, valid ${kernel.isValid(result.shape)}, ` +
                `vol ${kernel.properties(result.shape).volume.toFixed(2)} (${Math.round(performance.now() - t)} ms)`,
            );
            kernel.release(result.shape);
          } catch (error) {
            console.log(
              `  Offset Face ${d} mm: ✗ ${refusal(error)} (${Math.round(performance.now() - t)} ms)`,
            );
          }
        }
        const edges = kernel
          .describe(shape)
          .edges.map((e, i) => ({ i, z: e.midpoint[2] as number }))
          .filter((e) => Math.abs(e.z - (topInfo?.centroid[2] as number)) < 1e-3)
          .map((e) => e.i);
        for (const edge of edges) {
          const t = performance.now();
          try {
            const result = kernel.fillet(shape, [edge], 0.5);
            console.log(
              `  Fillet edge ${edge} 0.5 mm: ok, valid ${kernel.isValid(result.shape)} (${Math.round(performance.now() - t)} ms)`,
            );
            kernel.release(result.shape);
            break;
          } catch (error) {
            console.log(
              `  Fillet edge ${edge} 0.5 mm: ✗ ${refusal(error)} (${Math.round(performance.now() - t)} ms)`,
            );
          }
        }
        {
          const t = performance.now();
          try {
            const result = kernel.shell(shape, [top], 1);
            console.log(
              `  Shell top 1 mm: ok, valid ${kernel.isValid(result.shape)} (${Math.round(performance.now() - t)} ms)`,
            );
            kernel.release(result.shape);
          } catch (error) {
            console.log(
              `  Shell top 1 mm: ✗ ${refusal(error)} (${Math.round(performance.now() - t)} ms)`,
            );
          }
        }
        {
          const face = kernel.subShape(shape, 'face', top);
          const t = performance.now();
          try {
            const result = kernel.prism(face, [0, 0, 2.6]);
            console.log(
              `  Press Pull top 2.6 mm: ok, valid ${kernel.isValid(result.shape)} (${Math.round(performance.now() - t)} ms)`,
            );
            kernel.release(result.shape);
          } catch (error) {
            console.log(
              `  Press Pull top 2.6 mm: ✗ ${refusal(error)} (${Math.round(performance.now() - t)} ms)`,
            );
          } finally {
            kernel.release(face);
          }
        }
      } finally {
        if (shape) kernel.release(shape);
        kernel.release(mesh);
      }
    });
  },
);
