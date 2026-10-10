import { describe, expect, it } from 'vitest';
import {
  checkPrintField,
  chosenDensityExpression,
  costText,
  DEFAULT_MATERIAL,
  DEFAULT_PRINT,
  densityExpression,
  isDensityOverridden,
  lengthText,
  MATERIALS,
  type PrintSettings,
  presetDensity,
  printEstimate,
  resolveMaterialChoice,
  volumeText,
  weightText,
  withDensity,
  withoutDensity,
} from './material';

/** The settings P4-12's defaults describe: 2 walls of 0.45 mm, 15 % infill, 25 per kg. */
const SETTINGS: PrintSettings = {
  density: 1.24,
  diameter: 1.75,
  walls: DEFAULT_PRINT.walls,
  lineWidth: DEFAULT_PRINT.lineWidth,
  infill: DEFAULT_PRINT.infill,
  price: DEFAULT_PRINT.price,
};

/** The 40 × 30 × 20 block: 24 cm³, 2 × (40×30 + 40×20 + 30×20) = 5200 mm². */
const BLOCK = { volume: 24_000, area: 5200 };

/** The 20 mm cube: 8 cm³, 6 × 400 = 2400 mm². */
const CUBE = { volume: 8000, area: 2400 };

describe('print estimates', () => {
  it('has the four presets with their densities in g/cm³', () => {
    expect(Object.fromEntries(MATERIALS.map((m) => [m.id, m.density]))).toEqual({
      pla: 1.24,
      petg: 1.27,
      abs: 1.04,
      tpu: 1.21,
    });
    expect(presetDensity('petg')).toBe(1.27);
    expect(DEFAULT_MATERIAL).toMatchObject({ material: 'pla', diameter: 1.75 });
  });

  it('reads a preference written before walls, infill and price at the defaults', () => {
    const old = { material: 'petg', density: '1.3', diameter: 2.85 } as const;
    expect(resolveMaterialChoice(old)).toEqual({
      ...old,
      walls: 2,
      lineWidth: '0.45',
      infill: '15',
      price: '25',
    });
    expect(resolveMaterialChoice()).toEqual(DEFAULT_MATERIAL);
    // One that has them keeps them.
    expect(resolveMaterialChoice({ walls: 3, infill: '40' }).walls).toBe(3);
  });

  it('weighs the printed volume times density', () => {
    // 24 000 mm³ (the 40 × 30 × 20 block) is 24 cm³: at 100 % infill that is what is printed.
    const solid = { ...SETTINGS, infill: 100 };
    const pla = printEstimate([BLOCK], solid);
    expect(pla?.volume).toBeCloseTo(24, 12);
    expect(pla?.printed).toBeCloseTo(24, 12);
    expect(pla?.weight).toBeCloseTo(29.76, 9);
    const petg = printEstimate([BLOCK], { ...solid, density: 1.27 });
    expect(petg?.weight).toBeCloseTo(30.48, 9);
  });

  it('fills a 20 mm cube with 2 walls of 0.45 mm and 15 % infill', () => {
    // The skin is 2400 × 2 × 0.45 = 2160 mm³, the interior 5840, and 15 % of it is 876.
    const cube = printEstimate([CUBE], SETTINGS);
    expect(cube?.skin).toBeCloseTo(2.16, 12);
    expect(cube?.printed).toBeCloseTo(3.036, 12);
    expect(cube?.weight).toBeCloseTo(3.036 * 1.24, 12);
    expect(cube?.cost).toBeCloseTo((3.036 * 1.24 * 25) / 1000, 12);
    // 15 % infill is between the skin alone and the solid part.
    expect(cube?.printed).toBeGreaterThan(cube?.skin ?? 0);
    expect(cube?.printed).toBeLessThan(8);
    // No walls at all: the infill alone, 1.2 cm³.
    expect(printEstimate([CUBE], { ...SETTINGS, walls: 0 })?.printed).toBeCloseTo(1.2, 12);
  });

  it('spends no more than the part has, however thin it is', () => {
    // A 100 × 80 × 0.4 mm plate: 3200 mm³ under 16 144 mm² of surface, so its walls would be
    // thicker than it is.
    const plate = { volume: 3200, area: 16_144 };
    const thin = printEstimate([plate], SETTINGS);
    expect(thin?.skin).toBeCloseTo(3.2, 12);
    expect(thin?.printed).toBeCloseTo(3.2, 12);
    expect(thin?.weight).toBeCloseTo(3.2 * 1.24, 12);
    // The skin is worked out per body, so two thin plates are not one thick one.
    const pair = printEstimate([plate, plate], SETTINGS);
    expect(pair?.printed).toBeCloseTo(6.4, 12);
    expect(pair?.volume).toBeCloseTo(6.4, 12);
    // A thick block gets its interior filled.
    const block = printEstimate([BLOCK], SETTINGS);
    expect(block?.printed).toBeLessThan(24);
    expect(block?.printed).toBeGreaterThan(block?.skin ?? 0);
  });

  it('gives the filament length from the cross-section, whatever the density', () => {
    const thin = printEstimate([BLOCK], { ...SETTINGS, infill: 100 });
    // π (0.875)² = 2.4053 mm²: 24 000 / 2.4053 = 9977.9 mm.
    expect(thin?.filament).toBeCloseTo(24_000 / (Math.PI * 0.875 ** 2), 9);
    expect(thin?.filament).toBeCloseTo(9977.9, 0);
    expect(
      printEstimate([BLOCK], { ...SETTINGS, infill: 100, density: 1.04 })?.filament,
    ).toBeCloseTo(thin?.filament ?? 0, 9);
    // The thick filament is (2.85/1.75)² = 2.65 times shorter.
    const thick = printEstimate([BLOCK], { ...SETTINGS, infill: 100, diameter: 2.85 });
    expect((thin?.filament ?? 0) / (thick?.filament ?? 1)).toBeCloseTo((2.85 / 1.75) ** 2, 9);
    // With infill there is less filament than for a solid part.
    expect(printEstimate([CUBE], SETTINGS)?.filament).toBeLessThan(thin?.filament ?? 0);
  });

  it('refuses a setting that is not a number in range', () => {
    expect(printEstimate([CUBE], { ...SETTINGS, density: 0 })).toBeUndefined();
    expect(printEstimate([CUBE], { ...SETTINGS, density: -1 })).toBeUndefined();
    expect(printEstimate([CUBE], { ...SETTINGS, density: Number.NaN })).toBeUndefined();
    expect(printEstimate([CUBE], { ...SETTINGS, diameter: 0 })).toBeUndefined();
    expect(printEstimate([CUBE], { ...SETTINGS, lineWidth: 0 })).toBeUndefined();
    expect(printEstimate([CUBE], { ...SETTINGS, walls: -1 })).toBeUndefined();
    expect(printEstimate([CUBE], { ...SETTINGS, infill: 101 })).toBeUndefined();
    expect(printEstimate([CUBE], { ...SETTINGS, infill: -1 })).toBeUndefined();
    expect(printEstimate([CUBE], { ...SETTINGS, price: -1 })).toBeUndefined();
    expect(printEstimate([{ volume: -1, area: 10 }], SETTINGS)).toBeUndefined();
    expect(printEstimate([], SETTINGS)).toMatchObject({ volume: 0, printed: 0, filament: 0 });
    expect(printEstimate([{ volume: 0, area: 0 }], SETTINGS)).toMatchObject({ weight: 0, cost: 0 });
  });

  it('checks what each field may be, with a message that says so', () => {
    const one = { ok: true, value: 1, dim: { length: 0, angle: 0 } } as const;
    const zero = { ok: true, value: 0, dim: { length: 0, angle: 0 } } as const;
    const high = { ok: true, value: 120, dim: { length: 0, angle: 0 } } as const;
    // 1 (or 100) is fine anywhere a number is.
    for (const field of ['density', 'walls', 'lineWidth', 'infill', 'price'] as const) {
      expect(checkPrintField(field, '1', one)).toBe(one);
    }
    // A wall count, an infill and a price of 0 are all sensible; a density or a line width isn't.
    expect(checkPrintField('walls', '0', zero)).toBe(zero);
    expect(checkPrintField('price', '0', zero)).toBe(zero);
    expect(checkPrintField('infill', '0', zero)).toBe(zero);
    expect(checkPrintField('density', '0', zero).ok).toBe(false);
    expect(checkPrintField('lineWidth', '0', zero).ok).toBe(false);
    // Out of range the other way.
    expect(checkPrintField('infill', '100', one)).toBe(one);
    expect(checkPrintField('infill', '120', high).ok).toBe(false);
    expect(checkPrintField('walls', '-1', { ...one, value: -1 }).ok).toBe(false);
    expect(checkPrintField('price', '-1', { ...one, value: -1 }).ok).toBe(false);
    // The messages are the panel's, and they name the range.
    const density = checkPrintField('density', '0', zero);
    expect(density.ok).toBe(false);
    if (!density.ok) {
      expect(density.error.message).toBe('A density is more than 0 g/cm³.');
      expect(density.error.span).toMatchObject({ start: 0, end: 1 });
    }
    const infill = checkPrintField('infill', '120', high);
    if (!infill.ok) expect(infill.error.message).toBe('Between 0 % and 100 %.');
    // An expression that didn't evaluate keeps its own error.
    const broken = { ok: false, error: new Error('nope') } as never;
    expect(checkPrintField('walls', 'x', broken)).toBe(broken);
  });

  it('writes weights, lengths, volumes and costs for people', () => {
    expect(weightText(29.76)).toBe('29.8 g');
    expect(weightText(250.4)).toBe('250 g');
    expect(weightText(1234)).toBe('1.23 kg');
    expect(lengthText(820)).toBe('820 mm');
    expect(lengthText(9977.9)).toBe('9.98 m');
    expect(volumeText(24)).toBe('24.00 cm³');
    expect(volumeText(240)).toBe('240 cm³');
    expect(costText(0.0941)).toBe('0.09');
    expect(costText(3.5)).toBe('3.50');
    expect(costText(0)).toBe('0.00');
    expect(costText(0.004)).toBe('0.004');
  });

  describe('density overrides (ADR-0082)', () => {
    it('follows the built-in density until a person changes it', () => {
      const choice = resolveMaterialChoice();
      expect(densityExpression(choice, 'pla')).toBe('1.24');
      expect(isDensityOverridden(choice, 'pla')).toBe(false);
      expect(choice.densities).toBeUndefined();
    });

    it('stores only the overrides, and the built-in value removes one', () => {
      const own = withDensity(resolveMaterialChoice(), 'pla', '1.3');
      expect(own.densities).toEqual({ pla: '1.3' });
      expect(densityExpression(own, 'pla')).toBe('1.3');
      expect(densityExpression(own, 'petg')).toBe('1.27');
      expect(chosenDensityExpression(own)).toBe('1.3');
      // Writing the built-in number back is no override.
      expect(withDensity(own, 'pla', '1.24').densities).toBeUndefined();
      expect(withoutDensity(own, 'pla').densities).toBeUndefined();
      // One override stays when another is reset.
      const two = withDensity(own, 'abs', '1.05');
      expect(withoutDensity(two, 'pla').densities).toEqual({ abs: '1.05' });
    });

    it('reads a stored preference with overrides, and drops malformed ones', () => {
      const read = resolveMaterialChoice({
        material: 'petg',
        densities: { pla: '1.3', petg: 5, nylon: '1.1', tpu: ' ' } as never,
      });
      expect(read.densities).toEqual({ pla: '1.3' });
      expect(chosenDensityExpression(read)).toBe('1.27');
      // The custom material's own density is separate, and starts at PLA's.
      expect(chosenDensityExpression(resolveMaterialChoice({ material: 'custom' }))).toBe('1.24');
    });
  });
});
