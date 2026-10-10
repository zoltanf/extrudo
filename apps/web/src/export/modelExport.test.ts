import type { BodyId, BodyMeta, ComponentId } from '@extrudo/core';
import { checkManifold, read3mf, readStl, type TriangleMesh } from '@extrudo/io';
import { componentAssemblies } from '@extrudo/kernel';
import { describe, expect, it } from 'vitest';
import type { SlicerFile, SlicerId } from '../platform/slicer';
import {
  formatBytes,
  handToSlicer,
  initialBodies,
  type ModelExporter,
  meshBodies,
  meshFile,
  modelFileName,
  openBodies,
  RESOLUTIONS,
  stepFile,
  stlBytes,
} from './modelExport';

const id = (s: string) => s as BodyId;
const body = (name: string, meta: Partial<BodyMeta> = {}) => ({
  id: id(`E1:${name}`),
  meta: { name, visible: true, ...meta },
});

/** A closed tetrahedron at `x`. */
function tetra(x: number): TriangleMesh {
  return {
    positions: new Float64Array([x, 0, 0, x + 10, 0, 0, x, 10, 0, x, 0, 10]),
    indices: new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]),
  };
}

function fakeKernel(meshes: Record<string, TriangleMesh>) {
  const calls: unknown[][] = [];
  const kernel: ModelExporter = {
    async exportMeshes(bodies, tessellation, onProgress) {
      calls.push(['meshes', [...bodies], tessellation]);
      // As the kernel does (P3-13): ask before each body, and say when all are done.
      for (const [i] of bodies.entries()) {
        if ((await onProgress?.(i, bodies.length)) === false) throw new Error('cancelled');
      }
      await onProgress?.(bodies.length, bodies.length);
      return bodies.map((b) => {
        const mesh = meshes[b];
        if (!mesh) throw new Error(`no body ${b}`);
        return {
          id: b,
          mesh: { positions: Float64Array.from(mesh.positions), indices: mesh.indices },
        };
      });
    },
    async exportStep(bodies) {
      calls.push(['step', bodies]);
      return `ISO-10303-21;\n${bodies.map((b) => `PRODUCT('${b.name}')`).join('\n')}\nEND-ISO-10303-21;\n`;
    },
  };
  return { kernel, calls };
}

describe('initialBodies', () => {
  const a = body('Bracket');
  const b = body('Lid', { visible: false });
  const c = body('Pin');
  const all = [a, b, c];

  it('takes the bodies a menu asked for', () => {
    expect(initialBodies(all, [], [b.id, id('gone')])).toEqual([b.id]);
  });

  it('takes selected bodies, and the bodies of selected faces and edges', () => {
    expect(
      initialBodies(all, [
        { kind: 'body', id: c.id },
        { kind: 'face', id: `${a.id}:3` },
        { kind: 'edge', id: `${a.id}:1` },
        { kind: 'feature', id: 'S1' },
      ]),
    ).toEqual([a.id, c.id]);
  });

  it('else every shown body, or every body when none is shown', () => {
    expect(initialBodies(all, [{ kind: 'feature', id: 'S1' }])).toEqual([a.id, c.id]);
    expect(initialBodies([b], [])).toEqual([b.id]);
    expect(initialBodies([], [])).toEqual([]);
  });
});

describe('model files', () => {
  const bracket = body('Bracket', { color: '#ff7a66' });
  const pin = body('Pin');
  const bodies = [bracket, pin];
  const meshes = { [bracket.id]: tetra(0), [pin.id]: tetra(20) };

  it('meshes the bodies at the resolution and checks each mesh', async () => {
    const { kernel, calls } = fakeKernel(meshes);
    const meshed = await meshBodies(kernel, bodies, RESOLUTIONS.fine);
    expect(calls).toEqual([['meshes', bodies.map((b) => b.id), RESOLUTIONS.fine]]);
    expect(meshed.triangles).toBe(8);
    expect(meshed.reports.map((r) => r.ok)).toEqual([true, true]);
    expect(openBodies(meshed)).toEqual([]);
  });

  it('passes the progress on, and a false from it stops the meshing (P3-13)', async () => {
    const { kernel } = fakeKernel(meshes);
    const seen: string[] = [];
    await meshBodies(kernel, bodies, RESOLUTIONS.fine, (done, total) => {
      seen.push(`${done}/${total}`);
    });
    expect(seen).toEqual(['0/2', '1/2', '2/2']);
    await expect(meshBodies(kernel, bodies, RESOLUTIONS.fine, (done) => done < 1)).rejects.toThrow(
      'cancelled',
    );
  });

  it('names bodies whose mesh is open', async () => {
    const open = tetra(0);
    const { kernel } = fakeKernel({
      ...meshes,
      [pin.id]: { positions: open.positions, indices: open.indices.slice(3) },
    });
    expect(openBodies(await meshBodies(kernel, bodies, RESOLUTIONS.coarse))).toEqual(['Pin']);
  });

  it('writes one STL of every body, closed', async () => {
    const { kernel } = fakeKernel(meshes);
    const file = meshFile(await meshBodies(kernel, bodies, RESOLUTIONS.medium), 'stl', 'Shelf');
    expect(file.name).toBe('Shelf.stl');
    expect(file.blob.type).toBe('model/stl');
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    expect(bytes.length).toBe(stlBytes(8));
    const stl = readStl(bytes);
    expect(stl.header).toMatch(/^Extrudo .*: Shelf \(mm\)$/);
    expect(checkManifold(stl.mesh)).toMatchObject({ ok: true, triangles: 8, nodes: 8 });
  });

  it('writes a 3MF object per body with its name and colour', async () => {
    const { kernel } = fakeKernel(meshes);
    const file = meshFile(await meshBodies(kernel, bodies, RESOLUTIONS.medium), '3mf', 'Shelf');
    expect(file.name).toBe('Shelf.3mf');
    const model = read3mf(new Uint8Array(await file.blob.arrayBuffer()));
    expect(model.unit).toBe('millimeter');
    expect(model.metadata.Title).toBe('Shelf');
    expect(model.metadata.Application).toMatch(/^Extrudo /);
    expect(model.objects.map((o) => [o.name, o.color])).toEqual([
      ['Bracket', '#FF7A66FF'],
      ['Pin', undefined],
    ]);
    expect(model.build).toHaveLength(2);
  });

  it('writes STEP through the kernel with the bodies’ names', async () => {
    const { kernel, calls } = fakeKernel(meshes);
    const file = await stepFile(kernel, [bracket], 'Shelf');
    expect(calls).toEqual([['step', [{ id: bracket.id, name: 'Bracket', color: '#ff7a66' }]]]);
    expect(file.name).toBe('Shelf - Bracket.step');
    expect(await file.blob.text()).toContain("PRODUCT('Bracket')");
  });

  it('passes each body’s colour to the STEP writer, and none for a body without one (P4-12)', async () => {
    const { kernel, calls } = fakeKernel(meshes);
    const red = body('Red', { color: '#c81e28' });
    await stepFile(kernel, [red, pin], 'Shelf');
    expect(calls).toEqual([
      [
        'step',
        [
          { id: red.id, name: 'Red', color: '#c81e28' },
          { id: pin.id, name: 'Pin' },
        ],
      ],
    ]);
  });

  it('names files after the project, and the body when there is one', () => {
    expect(modelFileName('Wall bracket', bodies, '3mf')).toBe('Wall bracket.3mf');
    expect(modelFileName('Wall bracket', [pin], 'stl')).toBe('Wall bracket - Pin.stl');
    expect(modelFileName('a/b', [], 'step')).toBe('a b.step');
  });

  it('names a single-component file after the component (P6-05, ADR-0081 §7)', () => {
    const lid = { id: 'cmp1' as ComponentId, name: 'Lid' };
    const lid1 = { ...body('Lid1'), component: lid };
    const lid2 = { ...body('Lid2'), component: lid };
    expect(modelFileName('Shelf', [lid1, lid2], '3mf')).toBe('Shelf - Lid.3mf');
    // One body keeps its own name, whatever component it is in.
    expect(modelFileName('Shelf', [lid1], '3mf')).toBe('Shelf - Lid1.3mf');
    // Bodies of different components are the project's own name.
    expect(modelFileName('Shelf', [lid1, pin], '3mf')).toBe('Shelf.3mf');
  });

  it('groups a component’s bodies as one 3MF object when asked (P6-05, ADR-0081 §7)', async () => {
    const lid = { id: 'cmp1' as ComponentId, name: 'Lid' };
    const lid1 = { ...body('Lid1'), component: lid };
    const lid2 = { ...body('Lid2'), component: lid };
    const chosen = [lid1, lid2, pin];
    const { kernel } = fakeKernel({
      [lid1.id]: tetra(0),
      [lid2.id]: tetra(20),
      [pin.id]: tetra(40),
    });
    const meshed = await meshBodies(kernel, chosen, RESOLUTIONS.medium);
    const grouped = read3mf(
      new Uint8Array(await meshFile(meshed, '3mf', 'Shelf', true).blob.arrayBuffer()),
    );
    // One grouped item (the component, two meshes), then the loose pin.
    expect(grouped.objects.map((o) => o.name)).toEqual(['Lid1', 'Lid2', 'Pin']);
    expect(grouped.items.map((item) => item.meshes.length)).toEqual([2, 1]);
    // Without grouping every body is its own object and item.
    const flat = read3mf(
      new Uint8Array(await meshFile(meshed, '3mf', 'Shelf', false).blob.arrayBuffer()),
    );
    expect(flat.items.map((item) => item.meshes.length)).toEqual([1, 1, 1]);
  });

  it('groups bodies by component in first-seen order', () => {
    const lid = { id: 'cmp1' as ComponentId, name: 'Lid' };
    const lid1 = { ...body('Lid1'), component: lid };
    const lid2 = { ...body('Lid2'), component: lid };
    expect(componentAssemblies([lid1, pin, lid2])).toEqual([{ name: 'Lid', parts: [0, 2] }]);
    expect(componentAssemblies([pin])).toBeUndefined();
  });

  it('passes a body’s component name to the STEP writer when grouping (P6-05)', async () => {
    const lid = { id: 'cmp1' as ComponentId, name: 'Lid' };
    const red = { ...body('Red', { color: '#c81e28' }), component: lid };
    const { kernel, calls } = fakeKernel(meshes);
    await stepFile(kernel, [red, pin], 'Shelf', true);
    expect(calls).toEqual([
      [
        'step',
        [
          { id: red.id, name: 'Red', color: '#c81e28', component: 'Lid' },
          { id: pin.id, name: 'Pin' },
        ],
      ],
    ]);
    // Without grouping the component is dropped: every body stays top level.
    calls.length = 0;
    await stepFile(kernel, [red, pin], 'Shelf', false);
    expect(calls).toEqual([
      [
        'step',
        [
          { id: red.id, name: 'Red', color: '#c81e28' },
          { id: pin.id, name: 'Pin' },
        ],
      ],
    ]);
  });

  it('formats sizes', () => {
    expect(formatBytes(845)).toBe('845 B');
    expect(formatBytes(12_345)).toBe('12.3 kB');
    expect(formatBytes(4_100_000)).toBe('4.1 MB');
  });
});

describe('the slicer hand-off (P4-08, ADR-0062)', () => {
  const bracket = body('Bracket');
  /** The file the dialog would hand over: the one Export saves. */
  async function exported() {
    const { kernel } = fakeKernel({ [bracket.id]: tetra(0) });
    const meshed = await meshBodies(kernel, [bracket], RESOLUTIONS.coarse);
    return meshFile(meshed, '3mf', 'Shelf');
  }

  it('hands the slicer the same bytes Export saves, with the format', async () => {
    const seen: { file: SlicerFile; slicer: SlicerId }[] = [];
    const message = await handToSlicer(
      async (f, slicer) => {
        seen.push({ file: f, slicer });
        return true;
      },
      await exported(),
      '3mf',
      'orcaslicer',
    );
    expect(message).toBeUndefined();
    expect(seen[0]?.slicer).toBe('orcaslicer');
    expect(seen[0]?.file.name).toBe('Shelf - Bracket.3mf');
    expect(seen[0]?.file.format).toBe('3mf');
    // The bytes are the file's own, so a slicer gets the very same 3MF.
    const model = read3mf(seen[0]?.file.bytes as Uint8Array);
    expect(model.objects.map((o) => o.name)).toEqual(['Bracket']);
  });

  it('says so when the slicer refused the file or failed', async () => {
    expect(await handToSlicer(async () => false, await exported(), '3mf', 'cura')).toBe(
      "Cura didn't take the file. Is it installed?",
    );
    expect(
      await handToSlicer(
        async () => {
          throw new Error('no such program');
        },
        await exported(),
        'step',
        'prusaslicer',
      ),
    ).toBe("Couldn't open the file in PrusaSlicer: no such program");
  });
});
