import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATERIAL,
  lengthText,
  MATERIALS,
  presetDensity,
  printEstimate,
  volumeText,
  weightText,
} from './material';

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

  it('weighs volume times density', () => {
    // 24 000 mm³ (the 40 × 30 × 20 block) is 24 cm³.
    const pla = printEstimate(24_000, 1.24, 1.75);
    expect(pla?.volume).toBeCloseTo(24, 12);
    expect(pla?.weight).toBeCloseTo(29.76, 9);
    const petg = printEstimate(24_000, 1.27, 1.75);
    expect(petg?.weight).toBeCloseTo(30.48, 9);
  });

  it('gives the filament length from the cross-section, whatever the density', () => {
    const thin = printEstimate(24_000, 1.24, 1.75);
    // π (0.875)² = 2.4053 mm²: 24 000 / 2.4053 = 9977.9 mm.
    expect(thin?.filament).toBeCloseTo(24_000 / (Math.PI * 0.875 ** 2), 9);
    expect(thin?.filament).toBeCloseTo(9977.9, 0);
    expect(printEstimate(24_000, 1.04, 1.75)?.filament).toBeCloseTo(thin?.filament ?? 0, 9);
    // The thick filament is (2.85/1.75)² = 2.65 times shorter.
    const thick = printEstimate(24_000, 1.24, 2.85);
    expect((thin?.filament ?? 0) / (thick?.filament ?? 1)).toBeCloseTo((2.85 / 1.75) ** 2, 9);
  });

  it('refuses a density or diameter that is not a positive number', () => {
    expect(printEstimate(1000, 0, 1.75)).toBeUndefined();
    expect(printEstimate(1000, -1, 1.75)).toBeUndefined();
    expect(printEstimate(1000, Number.NaN, 1.75)).toBeUndefined();
    expect(printEstimate(1000, 1.2, 0)).toBeUndefined();
    expect(printEstimate(0, 1.2, 1.75)).toMatchObject({ weight: 0, filament: 0 });
  });

  it('writes weights, lengths and volumes for people', () => {
    expect(weightText(29.76)).toBe('29.8 g');
    expect(weightText(250.4)).toBe('250 g');
    expect(weightText(1234)).toBe('1.23 kg');
    expect(lengthText(820)).toBe('820 mm');
    expect(lengthText(9977.9)).toBe('9.98 m');
    expect(volumeText(24)).toBe('24.00 cm³');
    expect(volumeText(240)).toBe('240 cm³');
  });
});
