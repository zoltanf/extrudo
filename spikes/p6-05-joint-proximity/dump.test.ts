// Temporary: dumps the hinge shapes and pose matrices for the native harness.
import type { BodyId, JointReport } from '@extrudo/core';
import { it } from 'vitest';
import { kernelFeatures } from '../features';
import { Kernel, type ShapeHandle } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import type { RecomputeResult } from '../recompute/types';
import { checkJoint } from './check';
import { HINGE, hingeDocument } from './testing';

it('dump', { timeout: 300_000 }, async () => {
  const fs = (await import('node:' + 'fs')) as unknown as {
    writeFileSync(p: string, d: string): void;
  };
  const dir = `${(globalThis as { process?: { cwd(): string } }).process?.cwd()}/spikes/p6-05-joint-proximity/data/`;
  const kernel = new Kernel(await loadOcct());
  const engine = new RecomputeEngine(kernel, kernelFeatures(), {});
  const result = (await engine.recompute({ doc: hingeDocument() })) as Extract<RecomputeResult, { status: 'done' }>;
  const report = result.joints?.[HINGE.id] as JointReport;
  const LEAF = 'LeafPlate:0' as BodyId;
  const BASE = 'BasePlate:0' as BodyId;
  const leaf = engine.latestBody(LEAF) as ShapeHandle;
  const base = engine.latestBody(BASE) as ShapeHandle;
  const ribbed = (shape: ShapeHandle, y0: number) => {
    const ribs = [];
    for (let i = 0; i < 22; i++) ribs.push(kernel.box([0.8, 20, 1], [-19.5 + i * 1.8, y0, 4]));
    return kernel.fuse(shape, kernel.compound(ribs)).shape;
  };
  const busyLeaf = ribbed(leaf, 5.5);
  const busyBase = ribbed(base, -25.5);
  const mats: number[][] = [];
  const orig = kernel.transform.bind(kernel);
  kernel.transform = (s, m) => {
    mats.push([...m]);
    return orig(s, m);
  };
  await checkJoint(kernel, new Map([[LEAF, busyLeaf], [BASE, busyBase]]), report,
    { joint: HINGE, moving: [LEAF], others: [BASE], range: { min: -180, max: 180 }, minGap: 0.2 }, async () => true);
  for (const [n, s] of [['leaf', leaf], ['base', base], ['busyLeaf', busyLeaf], ['busyBase', busyBase]] as const) {
    fs.writeFileSync(`${dir}${n}.step`, kernel.writeStep([{ shape: s, name: n }]));
  }
  fs.writeFileSync(`${dir}poses.txt`, mats.map((m) => m.join(' ')).join('\n'));
  console.log('poses', mats.length, kernel.count(busyLeaf, 'face'), kernel.count(busyBase, 'face'));
});
