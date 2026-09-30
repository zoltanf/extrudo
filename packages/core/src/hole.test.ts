import { describe, expect, it } from 'vitest';
import {
  HOLE_DEFAULT_PLANE,
  HOLE_DEFAULTS,
  HOLE_EXTENTS,
  HOLE_KINDS,
  HOLE_NUMBERS,
  HOLE_PRESETS,
  HoleInputsSchema,
  holeFeature,
  holeInputs,
  holePreset,
  holeSettings,
} from './hole';
import { PATTERNABLE_FEATURE_TYPES } from './pattern';
import type { GeomRef } from './schema';

const face: GeomRef = { kind: 'face', id: 'extrude:B:cap:end' };

describe('hole inputs', () => {
  it('a minimal hole is empty and reads with the defaults', () => {
    const inputs = holeInputs();
    expect(inputs).toEqual({});
    expect(HoleInputsSchema.safeParse(inputs).success).toBe(true);
    const settings = holeSettings(inputs);
    expect(settings).toMatchObject({
      plane: HOLE_DEFAULT_PLANE,
      points: [],
      type: 'simple',
      extent: 'blind',
      flip: false,
    });
    expect(settings.exprs.size).toBe(0);
    expect(HOLE_DEFAULTS).toMatchObject({ diameter: 5, depth: 10, tipAngle: 118, csAngle: 90 });
  });

  it('builds inputs from plain options and reads them back', () => {
    const point: GeomRef = { kind: 'sketchEntity', id: 'S1/p3' };
    const inputs = holeInputs({
      plane: face,
      points: [point],
      numbers: { diameter: '4.5 mm', tipAngle: '90 deg', csAngle: '82 deg' },
      type: 'countersink',
      extent: 'through',
      flip: true,
    });
    expect(HoleInputsSchema.safeParse(inputs).success).toBe(true);
    expect(holeFeature.inputsSchema.safeParse(inputs).success).toBe(true);
    const settings = holeSettings(inputs);
    expect(settings.plane).toEqual(face);
    expect(settings.points).toEqual([point]);
    expect(settings.type).toBe('countersink');
    expect(settings.extent).toBe('through');
    expect(settings.flip).toBe(true);
    expect([...settings.exprs].sort()).toEqual(['csAngle', 'diameter', 'tipAngle']);
    expect(inputs.tipAngle).toEqual({ kind: 'expr', expr: '90 deg', unit: 'angle' });
    expect(() => holeInputs({ numbers: { nope: '1 mm' } })).toThrow(/no number/);
  });

  it('checks units, kinds and stray keys', () => {
    const bad = (inputs: unknown) => HoleInputsSchema.safeParse(inputs).success;
    expect(bad({ diameter: { kind: 'expr', expr: '5 deg', unit: 'angle' } })).toBe(false);
    expect(bad({ tipAngle: { kind: 'expr', expr: '5 mm', unit: 'length' } })).toBe(false);
    expect(bad({ plane: { kind: 'ref', refs: [{ kind: 'edge', id: 'e' }] } })).toBe(false);
    expect(
      bad({
        plane: {
          kind: 'ref',
          refs: [
            { kind: 'plane', id: 'origin:xy' },
            { kind: 'plane', id: 'origin:xz' },
          ],
        },
      }),
    ).toBe(false);
    expect(bad({ points: { kind: 'ref', refs: [{ kind: 'face', id: 'f' }] } })).toBe(false);
    expect(bad({ type: { kind: 'enum', value: 'slot' } })).toBe(false);
    expect(bad({ stray: 1 })).toBe(false);
    expect([...HOLE_KINDS]).toEqual(['simple', 'counterbore', 'countersink']);
    expect([...HOLE_EXTENTS]).toEqual(['blind', 'through']);
  });

  it('is a create feature with the hole icon that patterns and mirrors can repeat', () => {
    expect(holeFeature).toMatchObject({ type: 'hole', label: 'Hole', icon: 'hole' });
    expect(PATTERNABLE_FEATURE_TYPES).toContain('hole');
  });
});

describe('hole presets', () => {
  it('lists M2 to M8 clearance and heat-set inserts, each with valid values', () => {
    const clearance = HOLE_PRESETS.filter((p) => p.group === 'clearance');
    expect(clearance.map((p) => p.label)).toEqual([
      'M2 clearance',
      'M2.5 clearance',
      'M3 clearance',
      'M4 clearance',
      'M5 clearance',
      'M6 clearance',
      'M8 clearance',
    ]);
    const inserts = HOLE_PRESETS.filter((p) => p.group === 'insert');
    expect(inserts.map((p) => p.label)).toEqual([
      'M2 heat-set insert',
      'M2.5 heat-set insert',
      'M3 heat-set insert',
      'M4 heat-set insert',
      'M5 heat-set insert',
    ]);
    const names = new Set(HOLE_NUMBERS.map((n) => n.name));
    for (const preset of HOLE_PRESETS) {
      for (const [name, expr] of Object.entries(preset.exprs)) {
        expect(names.has(name), `${preset.id}.${name}`).toBe(true);
        expect(expr).toMatch(/^[\d.]+ (mm|deg)$/);
      }
    }
    expect(new Set(HOLE_PRESETS.map((p) => p.id)).size).toBe(HOLE_PRESETS.length);
  });

  it('a clearance hole is wider than its screw and the counterbore wider than the hole', () => {
    const nominal: Record<string, number> = {
      M2: 2,
      'M2.5': 2.5,
      M3: 3,
      M4: 4,
      M5: 5,
      M6: 6,
      M8: 8,
    };
    for (const [size, d] of Object.entries(nominal)) {
      const p = holePreset(`${size.toLowerCase()}-clearance`);
      const hole = Number.parseFloat(p?.exprs.diameter ?? '0');
      const cb = Number.parseFloat(p?.exprs.cbDiameter ?? '0');
      const cs = Number.parseFloat(p?.exprs.csDiameter ?? '0');
      expect(hole).toBeGreaterThan(d);
      expect(hole).toBeLessThan(d * 1.25);
      expect(cb).toBeGreaterThan(hole);
      expect(cs).toBeGreaterThan(hole);
    }
  });

  it('a heat-set insert hole is a flat-bottomed blind hole', () => {
    const preset = holePreset('m3-insert');
    expect(preset?.exprs).toEqual({ diameter: '4 mm', depth: '6.5 mm', tipAngle: '0 deg' });
    expect(preset?.choices).toEqual({ type: 'simple', extent: 'blind' });
    expect(holePreset('nothing')).toBeUndefined();
  });
});
