/**
 * Every S12a fixture document, new grammar (P6-25, ADR-0144): each chain's outcome, the timeline
 * in order, the bodies left with their names and visibility, and each tip measured against
 * FreeCAD's own numbers for it.
 */
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import { asOldFile, chainCase, chainFile, type OldVersion } from './chain-parts';
import { importFcstd } from './import';
import { nodeImportKernel } from './node-kernel-test-support';

let planegcs: PlanegcsModule;
let kernel: ReturnType<typeof nodeImportKernel>;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
  kernel = nodeImportKernel();
});

const run = (bytes: Uint8Array) =>
  importFcstd(bytes, 'Chains', { kernel, solver: new SketchSolver(planegcs) });

const WHOLE = [
  'pad_only',
  'pad_pocket',
  'chain_five',
  'pad_kinds',
  'revolved',
  'dressups',
  'patterns',
  'branch',
  'in_part',
  'long_chain',
  'bound',
];

describe('loose chains, new grammar', () => {
  it.each(WHOLE)('%s comes in with its whole history', { timeout: 120_000 }, async (name) => {
    const { report, design } = await run(chainFile(name));
    const chains = report.bodies.filter((b) => b.loose);
    expect(chains.map((c) => [c.object, c.outcome, c.stop?.reason, c.stop?.detail])).toEqual(
      chainCase(name).roots.map((r) => [r, 'history', undefined, undefined]),
    );
    for (const c of chains) {
      expect(c.steps).toEqual([]);
      expect(c.mapped.length).toBe(c.features);
    }
    expect(design.doc.features.filter((f) => f.type === 'import')).toEqual([]);
    expect(report.finalShapes).toBe(chainCase(name).roots.length);
  });
});

const OLD: readonly (readonly [string, OldVersion])[] = [
  ['pad_pocket', '0.14'],
  ['chain_five', '0.14'],
  ['pad_kinds', '0.14'],
  ['revolved', '0.14'],
  ['dressups', '0.14'],
  ['patterns', '0.14'],
  ['branch', '0.14'],
  ['long_chain', '0.14'],
  ['bound', '0.16'],
];

describe('loose chains, old grammar', () => {
  it.each(OLD)('%s as %s comes in as the new form does', { timeout: 120_000 }, async (name, v) => {
    const fresh = await run(chainFile(name));
    const old = await run(asOldFile(name, v));
    const kinds = (r: typeof fresh) =>
      r.design.doc.features.map((f) => `${f.type} ${f.name}`);
    expect(
      old.report.bodies.map((c) => [c.object, c.outcome, c.stop?.reason, c.stop?.detail]),
    ).toEqual(fresh.report.bodies.map((c) => [c.object, 'history', undefined, undefined]));
    expect(kinds(old)).toEqual(kinds(fresh));
  });
});
