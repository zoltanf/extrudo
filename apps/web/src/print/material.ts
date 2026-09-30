/**
 * Print estimates (P3-10, ADR-0048, FR-3DP-02): the weight and the filament length of a
 * solid part from its exact volume and a material. Infill is not modelled: the numbers are for
 * a solid part (100 % infill), an upper bound for a normal print.
 *
 * Weight is volume × density. The filament a printer feeds is a cylinder of the same volume, so
 * its length is the volume over the cross-section of the filament (the density cancels).
 */
export const MATERIALS = [
  { id: 'pla', label: 'PLA', density: 1.24 },
  { id: 'petg', label: 'PETG', density: 1.27 },
  { id: 'abs', label: 'ABS', density: 1.04 },
  { id: 'tpu', label: 'TPU', density: 1.21 },
] as const;

export type MaterialId = (typeof MATERIALS)[number]['id'];

export const FILAMENT_DIAMETERS = [1.75, 2.85] as const;
export type FilamentDiameter = (typeof FILAMENT_DIAMETERS)[number];

/** What the panel remembers between sessions (preference `print.material`). */
export interface MaterialChoice {
  /** A preset, or `custom` with the density below. */
  material: MaterialId | 'custom';
  /** Custom density in g/cm³, as an expression ("1.3"). */
  density: string;
  /** Filament diameter, mm. */
  diameter: FilamentDiameter;
}

export const DEFAULT_MATERIAL: MaterialChoice = {
  material: 'pla',
  density: '1.3',
  diameter: 1.75,
};

/** The density of a preset, g/cm³. */
export function presetDensity(id: MaterialId): number {
  return (MATERIALS.find((m) => m.id === id) ?? MATERIALS[0]).density;
}

export interface PrintEstimate {
  /** cm³. */
  volume: number;
  /** g. */
  weight: number;
  /** mm of filament. */
  filament: number;
}

/**
 * The estimate for a volume in mm³, a density in g/cm³ and a filament diameter in mm.
 * `undefined` for a density that isn't a positive number.
 */
export function printEstimate(
  volumeMm3: number,
  density: number,
  diameter: number,
): PrintEstimate | undefined {
  if (!(density > 0) || !(diameter > 0) || !(volumeMm3 >= 0)) return undefined;
  const volume = volumeMm3 / 1000;
  return {
    volume,
    weight: volume * density,
    filament: volumeMm3 / (Math.PI * (diameter / 2) ** 2),
  };
}

/** "12.4 g" or "1.24 kg". */
export function weightText(grams: number): string {
  return grams >= 1000
    ? `${(grams / 1000).toFixed(2)} kg`
    : `${grams.toFixed(grams >= 100 ? 0 : 1)} g`;
}

/** "3.84 m" or "820 mm". */
export function lengthText(mm: number): string {
  return mm >= 1000 ? `${(mm / 1000).toFixed(2)} m` : `${mm.toFixed(0)} mm`;
}

/** "12.4 cm³". */
export function volumeText(cm3: number): string {
  return `${cm3 >= 100 ? cm3.toFixed(0) : cm3.toFixed(2)} cm³`;
}
