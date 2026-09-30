import { describe, expect, it } from 'vitest';
import {
  angularStep,
  CircularPatternInputsSchema,
  circularPatternInputs,
  circularSettings,
  instanceLabel,
  PathPatternInputsSchema,
  pathPatternInputs,
  pathSettings,
  RectangularPatternInputsSchema,
  rectangularPatternInputs,
  rectangularSettings,
  seriesOf,
  seriesStep,
  slotOf,
} from './pattern';
import { originAxisRef } from './sketch/planes';
import { referencedFeatures } from './timeline';

const Z = originAxisRef('origin:z');
const X = originAxisRef('origin:x');

describe('rectangular pattern inputs', () => {
  it('a bare pattern is valid and takes the defaults', () => {
    const inputs = rectangularPatternInputs({ bodies: ['B:0'], direction1: X });
    expect(RectangularPatternInputsSchema.safeParse(inputs).success).toBe(true);
    expect(rectangularSettings(inputs)).toMatchObject({
      objects: 'bodies',
      bodies: [{ kind: 'body', id: 'B:0' }],
      features: [],
      join: false,
      direction1: X,
      direction2: undefined,
      measure1: 'spacing',
      symmetric1: false,
    });
  });

  it('features make the objects features, and join only counts for bodies', () => {
    const features = rectangularPatternInputs({ features: ['E1', 'E1', 'E2'], join: true });
    const settings = rectangularSettings(features);
    expect(settings.objects).toBe('features');
    expect(settings.features.map((f) => f.id)).toEqual(['E1', 'E2']);
    expect(settings.join).toBe(false);
    expect(RectangularPatternInputsSchema.safeParse(features).success).toBe(true);
    expect(
      rectangularSettings(rectangularPatternInputs({ bodies: ['B:0'], join: true })).join,
    ).toBe(true);
  });

  it('counts are plain numbers and distances lengths', () => {
    const inputs = rectangularPatternInputs({ bodies: ['B:0'], count1: '4', distance1: '2 * w' });
    expect(inputs.count1).toEqual({ kind: 'expr', expr: '4', unit: 'unitless' });
    expect(inputs.distance1?.unit).toBe('length');
    const wrong = {
      ...inputs,
      count1: { kind: 'expr', expr: '4', unit: 'length' },
    };
    expect(RectangularPatternInputsSchema.safeParse(wrong).success).toBe(false);
  });

  it('a direction is one axis, edge or sketch line, not a plane', () => {
    const plane = { kind: 'ref', refs: [{ kind: 'plane', id: 'origin:xy' }] };
    expect(
      RectangularPatternInputsSchema.safeParse({
        ...rectangularPatternInputs({}),
        direction1: plane,
      }).success,
    ).toBe(false);
  });
});

describe('circular and path pattern inputs', () => {
  it('circular takes an axis and defaults to a total angle', () => {
    const inputs = circularPatternInputs({
      bodies: ['B:0'],
      axis: Z,
      count: '6',
      angle: '360 deg',
    });
    expect(CircularPatternInputsSchema.safeParse(inputs).success).toBe(true);
    expect(circularSettings(inputs)).toMatchObject({ axis: Z, measure: 'total', symmetric: false });
  });

  it('a path is sketch curves and edges', () => {
    const path = [
      { kind: 'sketchEntity', id: 'S1/l1' },
      { kind: 'edge', id: 'e[a|b]' },
    ] as const;
    const inputs = pathPatternInputs({ bodies: ['B:0'], path, aligned: true });
    expect(PathPatternInputsSchema.safeParse(inputs).success).toBe(true);
    expect(pathSettings(inputs)).toMatchObject({ aligned: true, flip: false, measure: 'spacing' });
    expect(
      PathPatternInputsSchema.safeParse(
        pathPatternInputs({ path: [{ kind: 'face', id: 'extrude:E:cap:end' }] }),
      ).success,
    ).toBe(false);
  });
});

describe('layout', () => {
  it('a series starts at the original, or has it in the middle', () => {
    expect(seriesOf(4, false)).toEqual([0, 1, 2, 3]);
    expect(seriesOf(5, true)).toEqual([-2, -1, 0, 1, 2]);
    expect(seriesOf(4, true)).toEqual([-1, 0, 1, 2]);
    expect(seriesOf(1, true)).toEqual([0]);
  });

  it('the step is the distance, or the extent over count - 1', () => {
    expect(seriesStep(5, 10, 'spacing')).toBe(10);
    expect(seriesStep(5, 40, 'extent')).toBe(10);
    expect(seriesStep(1, 40, 'extent')).toBe(0);
  });

  it('a whole turn is spread evenly, less than that ends on the angle', () => {
    expect(angularStep(6, 360, 'total')).toBe(60);
    expect(angularStep(6, -360, 'total')).toBe(-60);
    expect(angularStep(4, 90, 'total')).toBe(30);
    expect(angularStep(4, 45, 'step')).toBe(45);
    expect(angularStep(1, 90, 'total')).toBe(0);
  });

  it('slots are unique and do not move when counts grow', () => {
    const seen = new Set<number>();
    for (let i = -6; i <= 6; i++) {
      for (let j = -6; j <= 6; j++) {
        const slot = slotOf(i, j);
        expect(seen.has(slot)).toBe(false);
        seen.add(slot);
      }
    }
    expect(slotOf(3, 1)).toBe(slotOf(3, 1));
    expect(slotOf(0, 0)).toBe(0);
    expect(instanceLabel(2)).toBe('2');
    expect(instanceLabel(-1)).toBe('m1');
    expect(instanceLabel(2, -1)).toBe('2xm1');
  });
});

describe('pattern dependencies', () => {
  it('a pattern of features depends on the features it repeats, and on their bodies', () => {
    const ids = new Set(['E1', 'H1', 'P1']);
    const feature = (inputs: ReturnType<typeof rectangularPatternInputs>) => ({
      id: 'P1' as never,
      inputs,
    });
    const features = feature(rectangularPatternInputs({ features: ['H1', 'E1'], direction1: X }));
    expect(referencedFeatures(features, ids).sort()).toEqual(['E1', 'H1']);
    // Copies of a body depend on the feature that made it.
    const bodies = feature(rectangularPatternInputs({ bodies: ['E1:0'], direction1: X }));
    expect(referencedFeatures(bodies, ids)).toEqual(['E1']);
  });
});
