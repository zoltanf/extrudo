// A shape's measured box doesn't depend on whether it has been meshed (ADR-0001's amendment of
// 2026-11-25): the facade bounds faces from their geometry, never from the triangulation that
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
import { buildTestPart } from './test-part';

let kernel: Kernel;
beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

describe('measure (ADR-0035, 2026-11-24)', () => {
  it('gives the same box before and after a shape is meshed, curved or flat', () => {
    const shapes = {
      cylinder: kernel.cylinder(5, 10, [0, 0, 0]),
      box: kernel.box([10, 20, 5]),
      // Fillets and a hole: torus and cylinder faces.
      testPart: buildTestPart(kernel),
    };
    for (const [name, shape] of Object.entries(shapes)) {
      const before = kernel.measure(shape).bbox;
      kernel.mesh(shape, DEFAULT_TESSELLATION);
      expect(kernel.measure(shape).bbox, name).toEqual(before);
      // A coarser meshing on top, as a sheet view's hidden-line pass may leave.
      kernel.mesh(shape, { linearDeflection: 0.5, angularDeflection: 0.5 });
      expect(kernel.measure(shape).bbox, name).toEqual(before);
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
