/**
 * The thread feature (P4-02, ADR-0056, FR-FT-15): a **modeled** screw
 * thread cut into cylindrical faces, real geometry that prints. A shaft's
 * round face gets an external thread, a hole's wall an internal one (the
 * kernel tells them apart). The kernel adds its evaluator and the web app
 * its dialog, each in its own registry keyed by `THREAD_TYPE` (ADR-0003).
 *
 * **Size.** `diameter` is the nominal (major) diameter and `pitch` the
 * distance between neighbouring crests, both of the ISO 68-1 basic profile
 * (60°, which the Unified inch threads share). Without them the kernel
 * picks the ISO metric coarse thread that fits the face (`autoThread`).
 * The presets (`THREAD_PRESETS`) aren't stored: choosing one fills the two
 * numbers, as a hole's presets do.
 *
 * **Where.** `extent` is `full` (the face's whole length) or `length`
 * (`length` mm); either starts `offset` mm from the face's end, the lower
 * end along the face's axis or, with `flip`, the other one.
 *
 * **Printing.** `tolerance` (default 0.1 mm) moves the whole profile
 * radially into this part's material: an external thread's diameters
 * shrink by twice it, an internal one's grow by twice it, so a screw and a
 * nut that both have 0.1 mm have 0.4 mm between their diameters and 0.2 mm
 * between their flanks. `chamfer` (default on) gives the thread a 45°
 * lead-in where it runs out of an open end (a shaft's end, a hole's mouth),
 * so its first turn starts whole and prints. `hand` is `right` (default) or
 * `left`.
 */
import { z } from 'zod';
import { enumInput, exprOf, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import {
  BoolInputSchema,
  type ExprInput,
  type GeomRef,
  type GeomRefKind,
  type RefInput,
} from './schema';

export const THREAD_TYPE = 'thread';

/** Cylindrical faces to thread. */
export const THREAD_FACE_KINDS: readonly GeomRefKind[] = ['face'];
/** Most faces one thread feature threads. */
export const MAX_THREAD_FACES = 16;

export const THREAD_EXTENTS = ['full', 'length'] as const;
export type ThreadExtent = (typeof THREAD_EXTENTS)[number];

export const THREAD_HANDS = ['right', 'left'] as const;
export type ThreadHand = (typeof THREAD_HANDS)[number];

/** One number input of a thread. */
export interface ThreadNumber {
  name: string;
  label: string;
  /** The expression the dialog starts with. */
  default: string;
  /** Its value in mm: what the kernel uses without the input. */
  value: number;
}

const length = (name: string, label: string, value: number): ThreadNumber => ({
  name,
  label,
  default: `${value} mm`,
  value,
});

/** Every number input, in the order the dialog lists them. */
export const THREAD_NUMBERS: readonly ThreadNumber[] = [
  length('diameter', 'Diameter', 6),
  length('pitch', 'Pitch', 1),
  length('length', 'Length', 10),
  length('offset', 'Offset', 0),
  length('tolerance', 'Tolerance', 0.1),
];

export const THREAD_DEFAULTS: Readonly<Record<string, number>> = Object.fromEntries(
  THREAD_NUMBERS.map((n) => [n.name, n.value]),
);

/** The name of the document parameter a new thread's tolerance refers to when it exists. */
export const TOLERANCE_PARAMETER = 'tolerance';

const optionalLength = () => exprOf('length').optional();

export const ThreadInputsSchema = z.strictObject({
  /** The cylindrical faces, one thread each. */
  faces: refsOf(THREAD_FACE_KINDS, MAX_THREAD_FACES),
  /** Nominal (major) diameter; with `pitch` missing too, the ISO coarse thread that fits. */
  diameter: optionalLength(),
  /** Crest to crest along the axis. */
  pitch: optionalLength(),
  /** Default `full`. */
  extent: enumInput(THREAD_EXTENTS).optional(),
  /** With `extent: length`; default 10 mm. */
  length: optionalLength(),
  /** From the face's end to where the thread starts; default 0. */
  offset: optionalLength(),
  /** Start from the face's other end. */
  flip: BoolInputSchema.optional(),
  /** Default `right`. */
  hand: enumInput(THREAD_HANDS).optional(),
  /** Radial clearance on this part (mm); default 0.1 mm. */
  tolerance: optionalLength(),
  /** A 45° lead-in at open ends; default true. */
  chamfer: BoolInputSchema.optional(),
});
export type ThreadInputs = z.infer<typeof ThreadInputsSchema>;

export const threadFeature: FeatureDefinition<ThreadInputs> = {
  type: THREAD_TYPE,
  label: 'Thread',
  category: 'modify',
  icon: 'thread',
  inputsSchema: ThreadInputsSchema,
};

/** A thread's inputs with the defaults filled in, but for its numbers. */
export interface ThreadSettings {
  faces: GeomRef[];
  extent: ThreadExtent;
  hand: ThreadHand;
  flip: boolean;
  chamfer: boolean;
  /** The `expr` inputs present, by name; a number without one takes `THREAD_DEFAULTS`. */
  exprs: ReadonlySet<string>;
  /** No size given: the kernel picks the ISO coarse thread that fits each face. */
  auto: boolean;
}

/** Reads a thread's (valid) inputs with their defaults. */
export function threadSettings(inputs: ThreadInputs): ThreadSettings {
  const exprs = new Set<string>();
  for (const [name, input] of Object.entries(inputs)) {
    if ((input as { kind?: string } | undefined)?.kind === 'expr') exprs.add(name);
  }
  return {
    faces: inputs.faces.refs,
    extent: inputs.extent?.value ?? 'full',
    hand: inputs.hand?.value ?? 'right',
    flip: inputs.flip?.value ?? false,
    chamfer: inputs.chamfer?.value ?? true,
    exprs,
    auto: !exprs.has('diameter') && !exprs.has('pitch'),
  };
}

export interface ThreadInputOptions {
  faces: GeomRef[];
  /** Number expressions by input name: `{ diameter: '8 mm', pitch: '1.25 mm' }`. */
  numbers?: Readonly<Record<string, string>>;
  extent?: ThreadExtent;
  hand?: ThreadHand;
  flip?: boolean;
  chamfer?: boolean;
}

/** A thread's inputs from plain options (tests, scripts; the dialog builds the same shape). */
export function threadInputs(options: ThreadInputOptions): ThreadInputs {
  const inputs: Record<string, unknown> = {
    faces: { kind: 'ref', refs: options.faces } satisfies RefInput,
  };
  for (const [name, expr] of Object.entries(options.numbers ?? {})) {
    if (!THREAD_NUMBERS.some((n) => n.name === name)) {
      throw new Error(`A thread has no number "${name}".`);
    }
    inputs[name] = { kind: 'expr', expr, unit: 'length' } satisfies ExprInput;
  }
  if (options.extent) inputs.extent = { kind: 'enum', value: options.extent };
  if (options.hand) inputs.hand = { kind: 'enum', value: options.hand };
  if (options.flip !== undefined) inputs.flip = { kind: 'bool', value: options.flip };
  if (options.chamfer !== undefined) inputs.chamfer = { kind: 'bool', value: options.chamfer };
  return inputs as ThreadInputs;
}

// ------------------------------------------------------------------ profile

/**
 * The radii of a thread as printed (ISO 68-1 basic profile, H = √3/2 · P):
 * the basic major radius D/2 and minor radius D/2 − 5H/8, both moved by the
 * tolerance into the part's material. On an external thread the crest is
 * the major radius (a flat P/8 wide) and the root the minor (P/4); on an
 * internal one the crest is the minor (P/4) and the root the major (P/8).
 */
export interface ThreadRadii {
  /** Fundamental triangle height √3/2 · P. */
  H: number;
  /** The part's crest (the tooth's tip) radius. */
  crest: number;
  /** The part's root (the groove's bottom) radius. */
  root: number;
  /** Half the crest flat, along the axis. */
  crestHalf: number;
  /** Half the root flat, along the axis. */
  rootHalf: number;
}

export function threadRadii(
  diameter: number,
  pitch: number,
  tolerance: number,
  internal: boolean,
): ThreadRadii {
  const H = (Math.sqrt(3) / 2) * pitch;
  const major = diameter / 2;
  const minor = major - (5 * H) / 8;
  return internal
    ? {
        H,
        crest: minor + tolerance,
        root: major + tolerance,
        crestHalf: pitch / 8,
        rootHalf: pitch / 16,
      }
    : {
        H,
        crest: major - tolerance,
        root: minor - tolerance,
        crestHalf: pitch / 16,
        rootHalf: pitch / 8,
      };
}

// ------------------------------------------------------------------ presets

/**
 * A thread preset: what choosing it fills into the dialog's Diameter and
 * Pitch. Not stored in the document (ADR-0056).
 */
export interface ThreadPreset {
  id: string;
  label: string;
  group: 'metric' | 'metric-fine' | 'unc' | 'unf';
  /** mm. */
  diameter: number;
  /** mm. */
  pitch: number;
  /** Expressions for the number fields: `diameter`, `pitch`. */
  exprs: Readonly<Record<string, string>>;
}

/** ISO 261 coarse pitch series, `[size, pitch]` in mm. */
const METRIC_COARSE: readonly (readonly [number, number])[] = [
  [2, 0.4],
  [2.5, 0.45],
  [3, 0.5],
  [4, 0.7],
  [5, 0.8],
  [6, 1],
  [8, 1.25],
  [10, 1.5],
  [12, 1.75],
  [14, 2],
  [16, 2],
  [20, 2.5],
  [24, 3],
  [30, 3.5],
];

/** The common ISO 261 fine pitches, `[size, pitch]` in mm. */
const METRIC_FINE: readonly (readonly [number, number])[] = [
  [8, 1],
  [10, 1.25],
  [10, 1],
  [12, 1.5],
  [12, 1.25],
  [14, 1.5],
  [16, 1.5],
  [20, 1.5],
  [24, 2],
  [30, 2],
];

/** Unified inch threads (ASME B1.1), `[label, diameter in inches, threads per inch]`. */
const UNC: readonly (readonly [string, number, number])[] = [
  ['#4-40', 0.112, 40],
  ['#6-32', 0.138, 32],
  ['#8-32', 0.164, 32],
  ['#10-24', 0.19, 24],
  ['1/4-20', 0.25, 20],
  ['5/16-18', 0.3125, 18],
  ['3/8-16', 0.375, 16],
  ['1/2-13', 0.5, 13],
  ['5/8-11', 0.625, 11],
  ['3/4-10', 0.75, 10],
  ['1-8', 1, 8],
];
const UNF: readonly (readonly [string, number, number])[] = [
  ['#4-48', 0.112, 48],
  ['#6-40', 0.138, 40],
  ['#8-36', 0.164, 36],
  ['#10-32', 0.19, 32],
  ['1/4-28', 0.25, 28],
  ['5/16-24', 0.3125, 24],
  ['3/8-24', 0.375, 24],
  ['1/2-20', 0.5, 20],
  ['5/8-18', 0.625, 18],
  ['3/4-16', 0.75, 16],
  ['1-12', 1, 12],
];

const metric = (group: 'metric' | 'metric-fine') => {
  return ([size, pitch]: readonly [number, number]): ThreadPreset => {
    const label = group === 'metric' ? `M${size}` : `M${size} × ${pitch}`;
    return {
      id: group === 'metric' ? `m${size}` : `m${size}x${pitch}`,
      label,
      group,
      diameter: size,
      pitch,
      exprs: { diameter: `${size} mm`, pitch: `${pitch} mm` },
    };
  };
};

const inch = (group: 'unc' | 'unf') => {
  return ([name, diameter, tpi]: readonly [string, number, number]): ThreadPreset => ({
    id: `${group}-${name.replace('#', 'no').replace('/', 'q')}`,
    label: `${name} ${group.toUpperCase()}`,
    group,
    diameter: diameter * 25.4,
    pitch: 25.4 / tpi,
    exprs: { diameter: `${diameter} in`, pitch: `1 in / ${tpi}` },
  });
};

export const THREAD_PRESETS: readonly ThreadPreset[] = [
  ...METRIC_COARSE.map(metric('metric')),
  ...METRIC_FINE.map(metric('metric-fine')),
  ...UNC.map(inch('unc')),
  ...UNF.map(inch('unf')),
];

/** The preset with this ID. */
export function threadPreset(id: string): ThreadPreset | undefined {
  return THREAD_PRESETS.find((p) => p.id === id);
}

/** The preset a diameter and pitch (mm) are, to 0.001 mm; undefined for a custom size. */
export function threadPresetOf(diameter: number, pitch: number): ThreadPreset | undefined {
  return THREAD_PRESETS.find(
    (p) => Math.abs(p.diameter - diameter) < 1e-3 && Math.abs(p.pitch - pitch) < 1e-3,
  );
}

/**
 * The ISO metric coarse thread for a face of `radius` mm (`autoThread`):
 * on a shaft the largest whose major diameter isn't more than 0.1 mm over
 * the shaft's, in a hole the largest whose minor diameter is at most the
 * hole's + 0.1 mm and whose major is larger than it (a tap-drill hole finds
 * its thread). Undefined when none fits.
 */
export function autoThread(radius: number, internal: boolean): ThreadPreset | undefined {
  const d = 2 * radius;
  const coarse = THREAD_PRESETS.filter((p) => p.group === 'metric');
  let best: ThreadPreset | undefined;
  for (const p of coarse) {
    const minor = p.diameter - 2 * ((5 / 8) * (Math.sqrt(3) / 2) * p.pitch);
    const fits = internal ? minor <= d + 0.1 && p.diameter > d : p.diameter <= d + 0.1;
    if (fits && (!best || p.diameter > best.diameter)) best = p;
  }
  // A shaft far thicker than the largest preset isn't a fit.
  if (best && !internal && best.diameter < d * 0.75) return undefined;
  return best;
}
