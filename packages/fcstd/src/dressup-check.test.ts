/**
 * The history check against FreeCAD's own fillets and chamfers (ADR-0144
 * S6): the fixtures' stored shapes measured by the import kernel agree with
 * FreeCAD's numbers, and a chamfer and its flipped twin, which have the same
 * volume, area and box, differ in the check by their centres of mass.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { drift, HISTORY_CENTRE_TOLERANCE, historyDisagreement } from './check';
import { DRESSUP_CASES, type DressUpFixtureFeature } from './dressup-fixtures';
import type { ShapeMeasure } from './import-kernel';
import { nodeImportKernel } from './node-kernel-test-support';

let kernel: ReturnType<typeof nodeImportKernel>;
beforeAll(() => {
  kernel = nodeImportKernel();
});

const last = (name: string) => DRESSUP_CASES[name]?.at(-1) as DressUpFixtureFeature;
const measure = (f: DressUpFixtureFeature) => kernel.measureStoredShape(f.stored, []);

describe('the stored fillets and chamfers, measured', () => {
  it("agree with FreeCAD's own volume and area", async () => {
    for (const features of Object.values(DRESSUP_CASES))
      for (const f of features) {
        const m = await measure(f);
        expect(m.solids).toBe(f.measure.solids);
        expect(Math.abs(m.volume - f.measure.volume) / f.measure.volume).toBeLessThan(1e-9);
        expect(Math.abs(m.area - f.measure.area) / f.measure.area).toBeLessThan(1e-9);
      }
  });

  it.each([
    ['chamfer_two', 'chamfer_two_flip'],
    ['chamfer_angle', 'chamfer_angle_flip'],
  ])('tell %s from %s by the centre of mass alone', async (a, b) => {
    const one = await measure(last(a));
    const other = await measure(last(b));
    const d = drift(other, one);
    // Volume, area and box are the same to rounding: the S5 check alone passes the twin.
    const withoutCentre: ShapeMeasure = { ...other, centre: one.centre };
    expect(historyDisagreement(withoutCentre, one)).toBeUndefined();
    // The centre is far outside its tolerance.
    expect(d.centre).toBeGreaterThan(100 * HISTORY_CENTRE_TOLERANCE * d.diagonal);
    expect(historyDisagreement(other, one)).toMatch(/centre of mass/);
    console.log(a, b, 'centre apart', d.centre, 'of diagonal', d.centre / d.diagonal);
  });

  it('measures a shape the same twice: the centre is rounding-stable', async () => {
    const f = last('fillet_tangent_chain');
    const one = await measure(f);
    const two = await measure(f);
    expect(historyDisagreement(two, one)).toBeUndefined();
    expect(drift(two, one).centre).toBe(0);
  });
});
