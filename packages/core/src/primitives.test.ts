import { describe, expect, it } from 'vitest';
import {
  BoxInputsSchema,
  boxFeature,
  CylinderInputsSchema,
  DEFAULT_PLACEMENT,
  isPrimitiveType,
  PRIMITIVE_FEATURES,
  PRIMITIVE_SIZES,
  PRIMITIVE_TYPES,
  primitiveInputs,
  primitiveNumbers,
  primitiveSettings,
  SphereInputsSchema,
  TorusInputsSchema,
} from './primitives';
import type { GeomRef } from './schema';
import { originPlaneRef } from './sketch/planes';

const TOP: GeomRef = { kind: 'face', id: 'extrude:E:cap:end' };

describe('primitive inputs', () => {
  it('four feature types in the Create category, each with its own icon and label', () => {
    expect(PRIMITIVE_TYPES).toEqual(['box', 'cylinder', 'sphere', 'torus']);
    for (const type of PRIMITIVE_TYPES) {
      const feature = PRIMITIVE_FEATURES[type];
      expect(feature).toMatchObject({ type, category: 'create', icon: type });
      expect(isPrimitiveType(type)).toBe(true);
    }
    expect(boxFeature.label).toBe('Box');
    expect(PRIMITIVE_FEATURES.torus.label).toBe('Torus');
    expect(isPrimitiveType('extrude')).toBe(false);
  });

  it('needs nothing: a 20 mm primitive on the XY plane, a new body', () => {
    for (const schema of [
      BoxInputsSchema,
      CylinderInputsSchema,
      SphereInputsSchema,
      TorusInputsSchema,
    ]) {
      expect(schema.safeParse({}).success).toBe(true);
    }
    expect(primitiveInputs('box')).toEqual({});
    expect(primitiveSettings({})).toEqual({
      plane: DEFAULT_PLACEMENT,
      operation: 'new-body',
      bodies: [],
      exprs: new Set(),
    });
    expect(DEFAULT_PLACEMENT).toEqual(originPlaneRef('origin:xy'));
    // An empty plane input falls back to XY as well.
    expect(primitiveSettings({ plane: { kind: 'ref', refs: [] } }).plane).toEqual(
      DEFAULT_PLACEMENT,
    );
    expect(PRIMITIVE_SIZES.box.map((n) => [n.name, n.default])).toEqual([
      ['length', '20 mm'],
      ['width', '20 mm'],
      ['height', '20 mm'],
    ]);
    expect(PRIMITIVE_SIZES.torus.map((n) => [n.name, n.value])).toEqual([
      ['diameter', 40],
      ['tube', 10],
    ]);
  });

  it('lists each type’s numbers: sizes, placement, and a box’s rotation', () => {
    expect(primitiveNumbers('box').map((n) => n.name)).toEqual([
      'length',
      'width',
      'height',
      'x',
      'y',
      'offset',
      'rotation',
    ]);
    expect(primitiveNumbers('sphere').map((n) => n.name)).toEqual(['diameter', 'x', 'y', 'offset']);
    // Heights may be negative (below the plane); the other sizes must be positive.
    const positive = (type: 'box' | 'cylinder') =>
      primitiveNumbers(type)
        .filter((n) => n.positive)
        .map((n) => n.name);
    expect(positive('box')).toEqual(['length', 'width']);
    expect(positive('cylinder')).toEqual(['diameter']);
    expect(primitiveNumbers('box').find((n) => n.name === 'rotation')?.unit).toBe('angle');
  });

  it('builds and reads every option', () => {
    const inputs = primitiveInputs('box', {
      plane: TOP,
      numbers: { length: '30 mm', rotation: '45 deg', x: 'w / 2' },
      operation: 'cut',
      bodies: ['E:0'],
    });
    expect(inputs).toEqual({
      plane: { kind: 'ref', refs: [TOP] },
      length: { kind: 'expr', expr: '30 mm', unit: 'length' },
      rotation: { kind: 'expr', expr: '45 deg', unit: 'angle' },
      x: { kind: 'expr', expr: 'w / 2', unit: 'length' },
      operation: { kind: 'enum', value: 'cut' },
      bodies: { kind: 'ref', refs: [{ kind: 'body', id: 'E:0' }] },
    });
    expect(BoxInputsSchema.safeParse(inputs).success).toBe(true);
    expect(primitiveSettings(inputs)).toEqual({
      plane: TOP,
      operation: 'cut',
      bodies: ['E:0'],
      exprs: new Set(['length', 'rotation', 'x']),
    });
    expect(() => primitiveInputs('sphere', { numbers: { rotation: '5 deg' } })).toThrow(
      'A sphere has no number "rotation".',
    );
  });

  it('refuses inputs of the wrong kind, unit or type', () => {
    const bad = [
      { plane: { kind: 'ref', refs: [{ kind: 'profile', id: 'S/r' }] } },
      { plane: { kind: 'ref', refs: [TOP, originPlaneRef('origin:xz')] } },
      { length: { kind: 'expr', expr: '5 deg', unit: 'angle' } },
      { rotation: { kind: 'expr', expr: '5 mm', unit: 'length' } },
      { operation: { kind: 'enum', value: 'weld' } },
      { tube: { kind: 'expr', expr: '5 mm' } },
    ];
    for (const inputs of bad) {
      expect(BoxInputsSchema.safeParse(inputs).success, JSON.stringify(inputs)).toBe(false);
    }
    // Only a box turns; only a torus has a tube.
    expect(
      CylinderInputsSchema.safeParse({ rotation: { kind: 'expr', expr: '5 deg', unit: 'angle' } })
        .success,
    ).toBe(false);
    expect(TorusInputsSchema.safeParse({ tube: { kind: 'expr', expr: '5 mm' } }).success).toBe(
      true,
    );
  });
});
