// A shape's measured box doesn't depend on whether it has been meshed (ADR-0035's amendment of
// 2026-11-24): the facade bounds faces from their geometry, never from the triangulation that
// meshing for display or for a sheet view leaves on them. So a "through all" extrude over bodies
// the view has drawn reaches as far as over the same bodies never drawn.
import {
  extrudeInputs,
  type Feature,
  type GeomRef,
  originPlaneRef,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel } from './kernel';
import { type BodyMesh, sameMesh } from './mesh';
import { loadOcct } from './occt/load';
import { DEFAULT_TESSELLATION } from './recompute/engine';
import { testDocument, testFeature, testFeatures } from './recompute/testing';
import { KernelService } from './service';
import { measureStoredShape, storedShapeToStep } from './stored-shape';
import { buildTestPart } from './test-part';

let kernel: Kernel;
beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

describe('measure (ADR-0035, 2026-11-24)', () => {
  it('gives the same box before and after a shape is meshed, curved or flat', () => {
    const shapes = {
      cylinder: () => kernel.cylinder(5, 10, [0, 0, 0]),
      box: () => kernel.box([10, 20, 5]),
      // Fillets and a hole: torus and cylinder faces.
      testPart: () => buildTestPart(kernel),
    };
    const fine = DEFAULT_TESSELLATION;
    // Coarser, as a sheet view's hidden-line pass may leave.
    const coarse = { linearDeflection: 0.5, angularDeflection: 0.5 };
    for (const [name, make] of Object.entries(shapes)) {
      // Each order on a fresh shape: a coarse meshing on top of a fine one keeps the fine
      // triangulation, a fine one on top of a coarse one replaces it.
      for (const order of [
        [fine, coarse],
        [coarse, fine],
      ]) {
        const shape = make();
        const before = kernel.measure(shape).bbox;
        for (const options of order) {
          kernel.mesh(shape, options);
          expect(kernel.measure(shape).bbox, `${name}, ${options.linearDeflection}`).toEqual(
            before,
          );
        }
        kernel.release(shape);
      }
    }
  });

  it('gives the same box for wires and free edges before and after meshing, fine or coarse', () => {
    const helix = (
      origin: [number, number, number],
      radius: number,
      pitch: number,
      turns: number,
    ) => kernel.helix({ origin, axis: [0, 0, 1], start: [1, 0, 0], radius, pitch, turns });
    const shapes = {
      'a helix wire': () => helix([0, 0, 0], 10, 4, 2.3),
      'a free circle edge': () => {
        const cylinder = kernel.cylinder(5, 10, [0, 0, 0]);
        const edge = kernel.subShape(cylinder, 'edge', 0);
        kernel.release(cylinder);
        return edge;
      },
      'a box and a helix': () => {
        const box = kernel.box([5, 5, 5]);
        const wire = helix([20, 0, 0], 7, 3, 1.6);
        const both = kernel.compound([box, wire]);
        kernel.release(box);
        kernel.release(wire);
        return both;
      },
    };
    for (const [name, make] of Object.entries(shapes)) {
      for (const options of [
        DEFAULT_TESSELLATION,
        { linearDeflection: 0.5, angularDeflection: 0.5 },
      ]) {
        const shape = make();
        const before = kernel.measure(shape).bbox;
        kernel.mesh(shape, options);
        expect(kernel.measure(shape).bbox, `${name}, ${options.linearDeflection}`).toEqual(before);
        kernel.release(shape);
      }
    }
  });

  it('`properties` gives the exact box, before and after meshing: what a person is shown', () => {
    const shapes: [string, ReturnType<Kernel['box']>, number[]][] = [
      ['cylinder r 5', kernel.cylinder(5, 10, [0, 0, 0]), [-5, -5, 0, 5, 5, 10]],
      ['box', kernel.box([10, 20, 5]), [0, 0, 0, 10, 20, 5]],
      ['test part (fillets, a hole)', buildTestPart(kernel), [0, 0, 0, 40, 30, 20]],
    ];
    const exact = (shape: ReturnType<Kernel['box']>) => {
      const { min, max } = kernel.properties(shape).bbox;
      return [...min, ...max].map((v) => Math.round(v * 1e6) / 1e6 + 0);
    };
    for (const [name, shape, box] of shapes) {
      expect(exact(shape), name).toEqual(box);
      kernel.mesh(shape, DEFAULT_TESSELLATION);
      expect(exact(shape), name).toEqual(box);
      kernel.release(shape);
    }
  });
});

function plate(x: number) {
  const b = new SketchBuilder();
  b.line(x, 0, x + 40, 0);
  b.line(x + 40, 0, x + 40, 30);
  b.line(x + 40, 30, x, 30);
  b.line(x, 30, x, 0);
  b.circle(x + 20, 15, 6);
  return b.sketch;
}

/** Plates with a hole, and a New Body extrude of a disc over them, `through-all` or 8 mm. */
function design(through: boolean) {
  const features: Feature[] = [];
  for (let i = 0; i < 3; i++) {
    const data = plate(i * 50);
    const [region] = detectProfiles(data).sort((a, b) => b.area - a.area);
    features.push({
      ...testFeature(`sk${i}`, 'sketch'),
      inputs: sketchInputs(originPlaneRef('origin:xy'), data),
    });
    features.push({
      ...testFeature(`ex${i}`, 'extrude'),
      inputs: extrudeInputs([{ kind: 'profile', id: `sk${i}/${region?.id}` } as GeomRef], {
        distance: '5 mm',
      }),
    });
  }
  const disc = new SketchBuilder();
  disc.circle(70, 15, 30);
  const [region] = detectProfiles(disc.sketch);
  features.push({
    ...testFeature('skd', 'sketch'),
    inputs: sketchInputs(originPlaneRef('origin:xy'), disc.sketch),
  });
  features.push({
    ...testFeature('exd', 'extrude'),
    inputs: extrudeInputs([{ kind: 'profile', id: `skd/${region?.id}` } as GeomRef], {
      ...(through ? { extent: 'through-all' } : { distance: '8 mm' }),
      operation: 'new-body',
    }),
  });
  return testDocument(features);
}

async function meshes(
  service: KernelService,
  doc: ReturnType<typeof design>,
  have?: Record<string, string>,
) {
  const result = await service.recompute({ doc, ...(have && { have }) });
  if (result.status !== 'done') throw new Error('cancelled');
  return result;
}

describe('a through-all extrude over bodies already drawn', () => {
  it('reaches as far as over the same bodies drawn for the first time', {
    timeout: 60_000,
  }, async () => {
    const service = new KernelService(() => loadOcct(), { features: testFeatures().registry });
    await service.init();
    // The design with an 8 mm disc: every body meshed, as for the view.
    const first = await meshes(service, design(false));
    const have = Object.fromEntries(first.bodies.map((b) => [b.id, b.version]));
    // The disc goes through all: the plates (meshed) give its length.
    const again = await meshes(service, design(true), have);
    const disc = again.bodies.find((b) => b.id === 'exd:0')?.mesh as BodyMesh;
    expect(disc).toBeDefined();
    // A kernel that never drew the plates.
    const fresh = new KernelService(() => loadOcct(), { features: testFeatures().registry });
    await fresh.init();
    const scratch = await meshes(fresh, design(true));
    const expected = scratch.bodies.find((b) => b.id === 'exd:0')?.mesh as BodyMesh;
    expect(sameMesh(disc, expected)).toBe(true);
  });
});

/**
 * A B-rep (OCCT's text format) of one triangle face with a triangulation and no surface, as a
 * file without its geometry gives it: (0, 0, 0), (10, 0, 0), (0, 10, 5), moved by `z` when given.
 */
function surfacelessFace(z?: number): string {
  const located = z !== undefined;
  return `DBRep_DrawableShape

CASCADE Topology V1, (c) Matra-Datavision
Locations ${located ? 1 : 0}
${located ? `1\n1 0 0 0\n0 1 0 0\n0 0 1 ${z}\n` : ''}Curve2ds 0
Curves 0
Polygon3D 0
PolygonOnTriangulations 0
Surfaces 0
Triangulations 1
3 1 0 0
0 0 0 10 0 0 0 10 5
1 2 3

TShapes 1
Fa
0  1e-07 0 0
2  1
0101000
*

+1 ${located ? 1 : 0} `;
}

describe('`properties` of faces without a surface (ADR-0035, 2026-11-25)', () => {
  const box = (shape: ReturnType<Kernel['box']>) => {
    const { min, max } = kernel.properties(shape).bbox;
    return [...min, ...max].map((v) => Math.round(v * 1e9) / 1e9 + 0);
  };

  it('bounds a face with only a triangulation by its points', () => {
    const face = kernel.readBrep(surfacelessFace());
    expect(box(face)).toEqual([0, 0, 0, 10, 10, 5]);
    // Where the file puts it.
    const moved = kernel.readBrep(surfacelessFace(100));
    expect(box(moved)).toEqual([0, 0, 100, 10, 10, 105]);
    kernel.release(face);
    kernel.release(moved);
  });

  it('gives the union for a shape with faces of both kinds', () => {
    const face = kernel.readBrep(surfacelessFace());
    const cube = kernel.box([4, 4, 20]);
    const both = kernel.compound([face, cube]);
    expect(box(both)).toEqual([0, 0, 0, 10, 10, 20]);
    for (const shape of [face, cube, both]) kernel.release(shape);
  });

  it('leaves a shape without faces as it was: a free circle edge', () => {
    const cylinder = kernel.cylinder(5, 10, [0, 0, 0]);
    const edge = kernel.subShape(cylinder, 'edge', 0);
    expect(box(edge)).toEqual([-5, -5, 10, 5, 5, 10]);
    kernel.release(edge);
    kernel.release(cylinder);
  });
});

/** The same face in a shell: what a solid made of such faces holds. */
function surfacelessShell(): string {
  return surfacelessFace()
    .replace('TShapes 1', 'TShapes 2')
    .replace('0101000\n*\n\n+1 0 ', '0101000\n*\nSh\n\n0101100\n+2 0 *\n\n+1 0 ');
}

describe('faces given as triangles, not as surfaces (ADR-0035, 2026-11-25)', () => {
  it('the B-rep reader refuses a shell with such a face, with a message', () => {
    expect(() => kernel.readBrep(surfacelessShell())).toThrow(
      'B-rep import failed: a face of a solid or shell is given as triangles, not as a surface.',
    );
    // The FreeCAD import's stored shapes come through it.
    expect(() => measureStoredShape(kernel, surfacelessShell(), [])).toThrow(/given as triangles/);
    expect(() => storedShapeToStep(kernel, surfacelessShell(), [])).toThrow(/given as triangles/);
    expect(kernel.stats().liveShapes).toBe(0);
  });

  it('describes a lone such face as "other", with its area and centre', async () => {
    // A kernel of its own, so nothing else in this file runs on one this test broke.
    const own = new Kernel(await loadOcct());
    const face = own.readBrep(surfacelessFace());
    const [described] = own.describe(face).faces;
    expect(described?.type).toBe('other');
    expect(described?.area).toBeCloseTo(55.9016994375, 9);
    expect(described?.centroid.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([
      3.333333333, 3.333333333, 1.666666667,
    ]);
    own.release(face);
    expect(own.stats().liveShapes).toBe(0);
  }, 30_000);
});
