/**
 * Print estimates (P3-10, ADR-0048, FR-3DP-02; walls, infill and cost in P4-12's amendment):
 * what a solid part takes to print from the kernel's exact volume and area and the print
 * settings a person prints with.
 *
 * A slicer fills a part's outline with `walls` perimeters of `lineWidth` mm and the rest of
 * the interior with `infill` per cent, so the material is the skin (solid) plus the infill in
 * what is left: `printed = skin + interior × infill`. The skin is `area × walls × lineWidth`,
 * capped at the volume (a plate thinner than its walls has no interior: a real slicer spends
 * more than one line width there, but not more material than the part has). At 100 % infill
 * this is the solid part exactly, which is what P3-10 showed.
 *
 * Weight is the printed volume × density. The filament a printer feeds is a cylinder of the
 * same volume, so its length is that volume over the cross-section of the filament (the
 * density cancels). Support is not modelled: generating it needs a slicer.
 */
import { type EvaluateResult, ExprError } from '@extrudo/core';

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
  /** Custom density in g/cm³, as an expression ("1.24"). */
  density: string;
  /**
   * A person's own density per preset (ADR-0082), as expressions: **only overrides**, so a
   * preset without an entry follows the built-in value in `MATERIALS`.
   */
  densities?: Partial<Record<MaterialId, string>>;
  /** Filament diameter, mm. */
  diameter: FilamentDiameter;
  /** Perimeters (a whole count). */
  walls: number;
  /** The width of one line, mm, as an expression. */
  lineWidth: string;
  /** The interior fill, per cent, as an expression. */
  infill: string;
  /** What the filament costs per kg, as an expression. No currency: the panel shows a number. */
  price: string;
}

/** The settings as numbers, and the defaults the expressions above hold. */
export const DEFAULT_PRINT = { walls: 2, lineWidth: 0.45, infill: 15, price: 25 } as const;

export const DEFAULT_MATERIAL: MaterialChoice = {
  material: 'pla',
  density: '1.24',
  diameter: 1.75,
  walls: DEFAULT_PRINT.walls,
  lineWidth: String(DEFAULT_PRINT.lineWidth),
  infill: String(DEFAULT_PRINT.infill),
  price: String(DEFAULT_PRINT.price),
};

/**
 * A stored preference with the defaults filled in. One written before walls, infill and price
 * existed loads as it did, with those at their defaults.
 */
export function resolveMaterialChoice(stored?: Partial<MaterialChoice>): MaterialChoice {
  const choice = { ...DEFAULT_MATERIAL, ...stored };
  // Only well-formed overrides count: an entry for an unknown material or a non-string is dropped.
  const densities: Partial<Record<MaterialId, string>> = {};
  const given: unknown = stored?.densities;
  if (given && typeof given === 'object' && !Array.isArray(given)) {
    for (const { id } of MATERIALS) {
      const value = (given as Record<string, unknown>)[id];
      if (typeof value === 'string' && value.trim() !== '') densities[id] = value;
    }
  }
  if (Object.keys(densities).length > 0) choice.densities = densities;
  else delete choice.densities;
  return choice;
}

/** The density of a preset, g/cm³. */
export function presetDensity(id: MaterialId): number {
  return (MATERIALS.find((m) => m.id === id) ?? MATERIALS[0]).density;
}

/** The expression a preset's density has now: the person's override, else the built-in value. */
export function densityExpression(choice: MaterialChoice, id: MaterialId): string {
  const own = choice.densities?.[id];
  return typeof own === 'string' && own.trim() !== '' ? own : String(presetDensity(id));
}

/** The expression of the density of the chosen material (the custom one's own, or a preset's). */
export function chosenDensityExpression(choice: MaterialChoice): string {
  return choice.material === 'custom' ? choice.density : densityExpression(choice, choice.material);
}

/** Whether a person changed a preset's density (an override that isn't the built-in number). */
export function isDensityOverridden(choice: MaterialChoice, id: MaterialId): boolean {
  return choice.densities?.[id] !== undefined;
}

/**
 * The choice with a preset's density set to `expression`. Writing the built-in number back
 * removes the override, so an untouched material keeps following the built-in value.
 */
export function withDensity(
  choice: MaterialChoice,
  id: MaterialId,
  expression: string,
): MaterialChoice {
  const { densities = {}, ...rest } = choice;
  const next = { ...densities };
  if (expression.trim() === String(presetDensity(id))) delete next[id];
  else next[id] = expression;
  return Object.keys(next).length > 0 ? { ...rest, densities: next } : rest;
}

/** The choice with a preset's density back at the built-in value. */
export function withoutDensity(choice: MaterialChoice, id: MaterialId): MaterialChoice {
  return withDensity(choice, id, String(presetDensity(id)));
}

// ------------------------------------------------------------------ the numbers

/** The fields of the preference that are expressions. */
export type PrintField = 'density' | 'walls' | 'lineWidth' | 'infill' | 'price';

interface FieldRange {
  /** Below this the value is refused (`exclusive`: this itself is refused). */
  min?: number;
  max?: number;
  exclusive?: boolean;
}

const PRINT_FIELD_RANGE: Record<PrintField, FieldRange> = {
  density: { min: 0, exclusive: true },
  walls: { min: 0 },
  lineWidth: { min: 0, exclusive: true },
  infill: { min: 0, max: 100 },
  price: { min: 0 },
};

/** The message a refused value gets, in the panel under the field. */
const PRINT_FIELD_MESSAGES: Record<PrintField, string> = {
  density: 'A density is more than 0 g/cm³.',
  walls: 'A wall count is 0 or more.',
  lineWidth: 'A line width is more than 0 mm.',
  infill: 'Between 0 % and 100 %.',
  price: 'A price is 0 or more.',
};

/**
 * Checks an evaluated print field: a density and a line width have to be above 0, a wall count
 * and a price 0 or more, an infill 0 to 100. An expression that didn't evaluate keeps its own
 * error (so `expression` is only here to underline the whole field).
 */
export function checkPrintField(
  field: PrintField,
  expression: string,
  result: EvaluateResult,
): EvaluateResult {
  if (!result.ok) return result;
  const { min, max, exclusive } = PRINT_FIELD_RANGE[field];
  const value = result.value;
  const tooSmall = min !== undefined && (exclusive ? !(value > min) : value < min);
  const tooBig = max !== undefined && value > max;
  if (!tooSmall && !tooBig) return result;
  return {
    ok: false,
    error: new ExprError(PRINT_FIELD_MESSAGES[field], { start: 0, end: expression.length }),
  };
}

// ------------------------------------------------------------------ the estimate

/** One solid's exact measurements: mm³ and mm² (from the kernel, ADR-0035). */
export interface SolidMeasure {
  volume: number;
  area: number;
}

/** Everything `printEstimate` needs besides the geometry. */
export interface PrintSettings {
  /** g/cm³. */
  density: number;
  /** Filament diameter, mm. */
  diameter: number;
  /** Perimeters. */
  walls: number;
  /** The width of one line, mm. */
  lineWidth: number;
  /** The interior fill, per cent. */
  infill: number;
  /** What the filament costs per kg. */
  price: number;
}

export interface PrintEstimate {
  /** cm³: the solid part. */
  volume: number;
  /** cm³: the walls, solid. */
  skin: number;
  /** cm³: what the print takes (the skin plus the infill in the interior). */
  printed: number;
  /** g, of the printed part. */
  weight: number;
  /** mm of filament, for the printed part. */
  filament: number;
  /** The printed weight's price per kg, in the price's own currency. */
  cost: number;
}

/**
 * The estimate for `solids` (each volume and area in mm, the skin worked out per body: a model
 * of thin plates has less interior than its volumes summed) and a print's settings.
 * `undefined` for a setting that isn't a number in range, or a measurement that isn't.
 */
export function printEstimate(
  solids: readonly SolidMeasure[],
  settings: PrintSettings,
): PrintEstimate | undefined {
  const { density, diameter, walls, lineWidth, infill, price } = settings;
  if (!(density > 0) || !(diameter > 0) || !(walls >= 0) || !(lineWidth > 0)) return undefined;
  if (!(infill >= 0) || !(infill <= 100) || !(price >= 0)) return undefined;
  let volumeMm3 = 0;
  let skinMm3 = 0;
  for (const solid of solids) {
    if (!(solid.volume >= 0) || !(solid.area >= 0)) return undefined;
    volumeMm3 += solid.volume;
    // A part thinner than its walls is all skin: there is no interior left to fill.
    skinMm3 += Math.min(solid.volume, solid.area * walls * lineWidth);
  }
  const interiorMm3 = volumeMm3 - skinMm3;
  // At full infill the print is the solid part, not a sum that lands next to it.
  const printedMm3 = infill >= 100 ? volumeMm3 : skinMm3 + interiorMm3 * (infill / 100);
  const printed = printedMm3 / 1000;
  const weight = printed * density;
  return {
    volume: volumeMm3 / 1000,
    skin: skinMm3 / 1000,
    printed,
    weight,
    filament: printedMm3 / (Math.PI * (diameter / 2) ** 2),
    cost: (weight / 1000) * price,
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

/** "0.09": the cost of a part, with no currency symbol (the price is what the user set). */
export function costText(cost: number): string {
  return cost > 0 && cost < 0.01 ? cost.toFixed(3) : cost.toFixed(2);
}
