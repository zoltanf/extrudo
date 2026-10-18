/**
 * What the OpenSCAD export's tests share (P6-09, ADR-0088 §11): OpenSCAD's
 * real WASM compiler in Node, and the volume and box of what it renders,
 * compared with the kernel's bodies within the mesh's tolerance.
 */
import type { BodyId } from '@extrudo/core';
import { FeatureRegistry } from '@extrudo/core';
import { read3mf } from '@extrudo/io';
import type { ScadCompiler, ScadDefine } from '@extrudo/openscad';
import { expect } from 'vitest';
import { kernelFeatures } from '../features';
import type { Kernel } from '../kernel';
import { RESOLUTIONS } from '../model-export';
import type { RecomputeEngine } from '../recompute/engine';
import type { KernelFeatureDefinition } from '../recompute/types';

// The Node compiler needs Node's types, which the kernel's program doesn't
// have (see `import-scad.test.ts`).
const NODE_ENTRY = '@extrudo/openscad/node';

/** OpenSCAD's WASM compiler for Node; dispose of it after the tests. */
export async function nodeCompiler(): Promise<ScadCompiler> {
  const { createNodeCompiler } = (await import(/* @vite-ignore */ NODE_ENTRY)) as {
    createNodeCompiler(): ScadCompiler;
  };
  return createNodeCompiler();
}

/** The kernel's features with the `csg` hooks of `types` taken off: they fall back to polyhedra. */
export function featuresWithoutHooks(
  types: readonly string[],
): FeatureRegistry<KernelFeatureDefinition> {
  const registry = new FeatureRegistry<KernelFeatureDefinition>();
  for (const definition of kernelFeatures().list()) {
    if (!types.includes(definition.type)) {
      registry.register(definition);
      continue;
    }
    const { csg: _csg, ...rest } = definition;
    registry.register(rest as KernelFeatureDefinition);
  }
  return registry;
}

export interface Solid {
  volume: number;
  min: number[];
  max: number[];
}

/** What OpenSCAD makes of a file (with `defines` overriding its variables): its whole result's volume and box. */
export async function render(
  compiler: ScadCompiler,
  source: string,
  defines: readonly ScadDefine[] = [],
): Promise<Solid> {
  const result = await compiler.compile({
    fileName: 'export.scad',
    source: new TextEncoder().encode(source),
    ...(defines.length > 0 && { defines }),
  });
  if (!result.ok) throw new Error(`OpenSCAD: ${result.error}`);
  let volume = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const { mesh } of read3mf(result.model).objects) {
    const p = mesh.positions;
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k] as number, p[i + k] as number);
        max[k] = Math.max(max[k] as number, p[i + k] as number);
      }
    }
    const at = (n: number) => [p[n * 3] ?? 0, p[n * 3 + 1] ?? 0, p[n * 3 + 2] ?? 0];
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [ax, ay, az] = at(mesh.indices[t] as number) as [number, number, number];
      const [bx, by, bz] = at(mesh.indices[t + 1] as number) as [number, number, number];
      const [cx, cy, cz] = at(mesh.indices[t + 2] as number) as [number, number, number];
      volume +=
        (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    }
  }
  return { volume, min, max };
}

/**
 * The kernel's measure of the bodies, together: the exact volume, and the box
 * of a fine mesh (OCCT's own box is loose around trimmed curved faces).
 */
export function measured(kernel: Kernel, engine: RecomputeEngine, ids: readonly BodyId[]): Solid {
  let volume = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const id of ids) {
    const shape = engine.latestBody(id);
    if (shape === undefined) throw new Error(`no body ${id}`);
    volume += kernel.measure(shape).volume;
    const p = kernel.exportMesh(shape, RESOLUTIONS.fine).positions;
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k] as number, p[i + k] as number);
        max[k] = Math.max(max[k] as number, p[i + k] as number);
      }
    }
  }
  return { volume, min, max };
}

/** Within the mesh's tolerance: the volume to 0.5 %, the box to a few deflections. */
export function expectSame(actual: Solid, expected: Solid): void {
  expect(Math.abs(actual.volume - expected.volume) / expected.volume).toBeLessThan(0.005);
  for (let k = 0; k < 3; k++) {
    expect(actual.min[k]).toBeCloseTo(expected.min[k] as number, 1);
    expect(actual.max[k]).toBeCloseTo(expected.max[k] as number, 1);
  }
}

/** How often `what` occurs in `text`. */
export const count = (text: string, what: string) => text.split(what).length - 1;
