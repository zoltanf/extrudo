/**
 * Fillets and chamfers by replay and match (P6-25 S6, ADR-0144): the
 * fixtures FreeCAD made (`dressup-fixtures.ts`) through `importFcstd` with a
 * kernel in Node and the real solver. Each part's stored shapes are
 * FreeCAD's own, so "equal" is our rebuild against FreeCAD's result and the
 * `EdgeN` / `FaceN` numbering is FreeCAD's.
 */
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it } from 'vitest';
import { DRESSUP_CASES, type DressUpFixtureFeature, dressUpSpec } from './dressup-fixtures';
import { type BodySpec, historyFile, rectangle } from './history-fixtures';
import { type FcstdImportOptions, importFcstd } from './import';
import { nodeImportKernel } from './node-kernel-test-support';
import { arc, circle, line } from './sketch-fixtures';

let planegcs: PlanegcsModule;
let kernel: ReturnType<typeof nodeImportKernel>;
beforeAll(async () => {
  planegcs = await loadPlanegcs();
  kernel = nodeImportKernel();
});

/** The sketch each part's pad is made of (the fixtures' header says which). */
const SKETCHES: Record<string, string[]> = {
  box: rectangle(0, 0, 10, 20),
  round: [circle(0, 0, 8)],
  slot: [
    line(0, -5, 20, -5),
    arc(20, 0, 5, -Math.PI / 2, Math.PI / 2),
    line(20, 5, 0, 5),
    arc(0, 0, 5, Math.PI / 2, (3 * Math.PI) / 2),
  ],
};
const sketchOf = (name: string) =>
  name.startsWith('round')
    ? SKETCHES.round
    : name.includes('tangent')
      ? SKETCHES.slot
      : SKETCHES.box;

/** A part's body: its sketch, its pad and its dress-ups, as stored. */
export function partBody(
  name: string,
  change: Record<string, Partial<DressUpFixtureFeature>> = {},
): BodySpec {
  const features = DRESSUP_CASES[name] as readonly DressUpFixtureFeature[];
  const [pad, ...rest] = features as [DressUpFixtureFeature, ...DressUpFixtureFeature[]];
  return {
    name: 'Body',
    label: 'Part',
    sketches: [{ name: 'Sketch', geometry: sketchOf(name) as string[] }],
    features: [
      { name: 'Pad', type: 'Pad', length: pad.Length as number, stored: pad.stored },
      ...rest.map((f) => dressUpSpec(f, change[f.object])),
    ],
  };
}

export async function runParts(bodies: BodySpec[], options: Partial<FcstdImportOptions> = {}) {
  const result = await importFcstd(historyFile(bodies), 'Parts', {
    kernel,
    solver: new SketchSolver(planegcs),
    ...options,
  });
  return { ...result, features: result.design.doc.features.map((f) => `${f.type} ${f.name}`) };
}

describe('the fixtures come in with their whole history', () => {
  it.each(Object.keys(DRESSUP_CASES))('%s', async (name) => {
    const { report, features, files } = await runParts([partBody(name)]);
    const [body] = report.bodies;
    expect(body?.stop).toBeUndefined();
    expect(body?.outcome).toBe('history');
    const kinds = (DRESSUP_CASES[name] ?? []).map((f) =>
      f.type.replace('PartDesign::', '').toLowerCase(),
    );
    expect(body?.mapped.map((m) => m.kind)).toEqual(kinds);
    expect(features.some((f) => f.startsWith('import'))).toBe(false);
    expect(files.size).toBe(0);
    for (const m of body?.mapped.slice(1) ?? []) {
      expect(m.references?.none).toBe(0);
      expect(m.references?.several).toBe(0);
      expect(m.references?.found).toBeGreaterThan(0);
    }
    console.log(
      name,
      JSON.stringify(
        body?.mapped.map((m) => ({ kind: m.kind, drift: m.drift, references: m.references })),
      ),
    );
  });
});

describe('a chamfer and its flipped twin', () => {
  it.each([
    ['chamfer_two', 'chamfer_two_flip'],
    ['chamfer_angle', 'chamfer_angle_flip'],
  ])('the wrong flip of %s is refused by the check', async (right, wrong) => {
    // The right flag with the other's stored shape: the rebuild is the twin, and only its centre differs.
    const twin = (DRESSUP_CASES[wrong] ?? []).at(-1)?.stored as string;
    const { report } = await runParts([partBody(right, { Chamfer: { stored: twin } })]);
    const [body] = report.bodies;
    expect(body?.stop?.reason).toBe('differs');
    expect(body?.stop?.detail).toMatch(/centre of mass/);
    expect(body?.mapped.map((m) => m.kind)).toEqual(['pad']);
  });
});
