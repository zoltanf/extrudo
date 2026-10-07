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
 * `left`. `starts` (default 1, stored only when more) cuts that many helices
 * with a lead of `starts × pitch` (P4-12, ADR-0056's second amendment).
 *
 * **Tapers.** No input decides one: a thread on a conical face follows the
 * cone (P4-12, ADR-0056's third amendment), so the NPT presets
 * (`THREAD_PRESETS`' `npt` group, each with its `taper`) are cut on a cone of
 * 1:16 on the diameter, and fitted to one without a size.
 */

import { SWEEP_FACE_ROLES } from './face-roles';
import { enumInput, exprOf, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import {
  BoolInputSchema,
  type ExprInput,
  type GeomRef,
  type GeomRefKind,
  type RefInput,
} from './schema';
import { z } from './zod';

export const THREAD_TYPE = 'thread';

/** Cylindrical or conical faces to thread. */
export const THREAD_FACE_KINDS: readonly GeomRefKind[] = ['face'];
/** Most faces one thread feature threads. */
export const MAX_THREAD_FACES = 16;

export const THREAD_EXTENTS = ['full', 'length'] as const;
export type ThreadExtent = (typeof THREAD_EXTENTS)[number];

export const THREAD_HANDS = ['right', 'left'] as const;
export type ThreadHand = (typeof THREAD_HANDS)[number];

/**
 * The thread's tooth profile (P4-12, ADR-0056's amendment). `iso` is what
 * there was (ISO 68-1, 60°, UNC and UNF included); the others are:
 * `trapezoidal` (ISO 2901 / DIN 103 Tr), `buttress` (DIN 513) and `bottle`
 * (the PCO-1881 soft-drink finish). The profile is one table here
 * (`threadProfile`); the kernel knows no angles of its own.
 */
export const THREAD_PROFILE_NAMES = ['iso', 'trapezoidal', 'buttress', 'bottle'] as const;
export type ThreadProfileName = (typeof THREAD_PROFILE_NAMES)[number];

export interface ThreadProfileOption {
  value: ThreadProfileName;
  label: string;
  description: string;
}

/** The profiles the dialog offers, with a one-line description each. */
export const THREAD_PROFILES: readonly ThreadProfileOption[] = [
  {
    value: 'iso',
    label: 'ISO metric (60°)',
    description: 'The ISO 68-1 basic profile: 60°, the form UNC and UNF share.',
  },
  {
    value: 'trapezoidal',
    label: 'Trapezoidal (Tr)',
    description: 'ISO 2901 / DIN 103: 30°, depth 0.5 P, equal crest and root flats.',
  },
  {
    value: 'buttress',
    label: 'Buttress (S)',
    description: 'DIN 513: a 3° load flank and a 30° trailing flank, depth 0.75 P.',
  },
  {
    value: 'bottle',
    label: 'Bottle (PCO-1881)',
    description: 'A soft-drink bottle thread: a rounded trapezoid, 20° flanks.',
  },
];

/**
 * On a buttress thread, which axial end the steep 3° load flank faces:
 * `end` (default) the `to` end, `start` the `from` end. `flip` still says
 * which end the thread starts from.
 */
export const THREAD_LOAD_FLANKS = ['start', 'end'] as const;
export type ThreadLoadFlank = (typeof THREAD_LOAD_FLANKS)[number];

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
  /** The cylindrical or conical faces, one thread each (a cone's thread is tapered). */
  faces: refsOf(THREAD_FACE_KINDS, MAX_THREAD_FACES).describe(
    "The cylindrical or conical faces to thread, one thread each; a cone's thread follows its taper. Required.",
  ),
  /** Nominal (major) diameter; with `pitch` missing too, the ISO coarse thread that fits. */
  diameter: optionalLength().describe(
    "The thread's nominal (major) diameter; a length. With pitch missing too, the ISO coarse thread that fits.",
  ),
  /** Crest to crest along the axis. */
  pitch: optionalLength().describe('Crest to crest along the axis; a length.'),
  /** Default `full`. */
  extent: enumInput(THREAD_EXTENTS)
    .optional()
    .describe('Thread the face to its end or to a length. Default full.'),
  /** With `extent: length`; default 10 mm. */
  length: optionalLength().describe(
    'How far to thread, with extent: length; a length. Default 10 mm.',
  ),
  /** From the face's end to where the thread starts; default 0. */
  offset: optionalLength().describe(
    "From the face's end to where the thread starts; a length. Default 0.",
  ),
  /** Start from the face's other end. */
  flip: BoolInputSchema.optional().describe("Start from the face's other end. Default false."),
  /** Default `right`. */
  hand: enumInput(THREAD_HANDS).optional().describe('Right- or left-handed. Default right.'),
  /** A whole number from 1 to 8; default 1. */
  starts: exprOf('unitless')
    .optional()
    .describe(
      'How many helices start round the face: 1 (the default), or 2–8 for a multi-start thread whose lead is starts × pitch.',
    ),
  /** Default `iso`. */
  profile: enumInput(THREAD_PROFILE_NAMES)
    .optional()
    .describe(
      'The tooth profile: iso (the default, 60°), trapezoidal (Tr), buttress (DIN 513) or bottle (PCO-1881).',
    ),
  /** With `profile: buttress`; default `end`. */
  loadFlank: enumInput(THREAD_LOAD_FLANKS)
    .optional()
    .describe('Buttress only: the end the steep 3° load flank faces, start or end. Default end.'),
  /** Radial clearance on this part (mm); default 0.1 mm. */
  tolerance: optionalLength().describe('Radial clearance on this part; a length. Default 0.1 mm.'),
  /** A 45° lead-in at open ends; default true. */
  chamfer: BoolInputSchema.optional().describe('A 45° lead-in at open ends. Default true.'),
});
export type ThreadInputs = z.infer<typeof ThreadInputsSchema>;

export const threadFeature: FeatureDefinition<ThreadInputs> = {
  type: THREAD_TYPE,
  label: 'Thread',
  category: 'modify',
  icon: 'thread',
  inputsSchema: ThreadInputsSchema,
  // ADR-0068 §4, from the kernel's ring and tooth (P4-02, ADR-0056): the
  // thread's own faces, one per piece of the profile it cuts.
  faceRoles: [
    ...SWEEP_FACE_ROLES,
    {
      pattern: 'side:<piece>',
      description:
        "One piece of the thread: `root`, `crest`, `flank0`, `flank1`, `end0`, `end1` or `lead0`, `lead1`, prefixed with the face's place in the input (`f0`, `f1`, ...) and numbered per turn. A multi-start thread (`starts` above 1) puts `s<j>.` after that prefix for each start's tooth faces: `f0.s1.crest`.",
    },
  ],
};

/** A thread's inputs with the defaults filled in, but for its numbers. */
export interface ThreadSettings {
  faces: GeomRef[];
  extent: ThreadExtent;
  hand: ThreadHand;
  flip: boolean;
  chamfer: boolean;
  profile: ThreadProfileName;
  loadFlank: ThreadLoadFlank;
  /** The `expr` inputs present, by name; a number without one takes `THREAD_DEFAULTS`. */
  exprs: ReadonlySet<string>;
  /** No size given: the kernel picks the ISO coarse thread that fits each face. */
  auto: boolean;
  /**
   * The starts as typed, when the expression is a plain number (else 1: the
   * kernel evaluates the expression itself, parameters included).
   */
  starts: number;
}

function plainStarts(expr: string | undefined): number {
  const n = expr === undefined ? 1 : Number(expr);
  return Number.isFinite(n) ? n : 1;
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
    profile: inputs.profile?.value ?? 'iso',
    loadFlank: inputs.loadFlank?.value ?? 'end',
    exprs,
    auto: !exprs.has('diameter') && !exprs.has('pitch'),
    starts: plainStarts(inputs.starts?.expr),
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
  profile?: ThreadProfileName;
  loadFlank?: ThreadLoadFlank;
  /** The starts as an expression (`'2'`, `'n'`); absent or `'1'` is a single start. */
  starts?: string;
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
  if (options.profile) inputs.profile = { kind: 'enum', value: options.profile };
  if (options.loadFlank) inputs.loadFlank = { kind: 'enum', value: options.loadFlank };
  if (options.starts !== undefined) {
    inputs.starts = { kind: 'expr', expr: options.starts, unit: 'unitless' } satisfies ExprInput;
  }
  return inputs as ThreadInputs;
}

// ------------------------------------------------------------------ profile

/** A point of the tooth's cross-section, `[axial, radial]` (mm). */
export type ProfilePoint = readonly [number, number];

/**
 * One side of the tooth's closed outline, in `[axial, radial]` coordinates
 * relative to the tooth's centre (axial 0) and its crest (radial 0, positive
 * towards the root). `line` runs straight to `to`; `arc` runs from the
 * previous point to `to` about `centre`, counter-clockwise when `ccw`.
 * `source` is the face name the kernel gives the surface it makes.
 */
export type ProfileSegment =
  | { kind: 'line'; to: ProfilePoint; source: string }
  | { kind: 'arc'; to: ProfilePoint; centre: ProfilePoint; ccw: boolean; source: string };

/** A thread profile's tooth: its outline and the crest-to-root depth. */
export interface ThreadProfileShape {
  segments: ProfileSegment[];
  /** Crest to root, mm. */
  depth: number;
  /** Half the crest flat, mm. */
  crestHalf: number;
  /** Half the root flat, mm. */
  rootHalf: number;
}

interface ProfileOptions {
  /** The nut's profile (only the ISO flat widths differ). */
  internal?: boolean;
  /** Buttress only: which side the steep 3° load flank faces. */
  loadFlank?: ThreadLoadFlank;
}

/** The ISO 68-1 basic profile (5H/8 deep, 60°). */
function isoProfile(pitch: number, internal: boolean): ThreadProfileShape {
  const depth = (5 * Math.sqrt(3) * pitch) / 16; // 5H/8
  const crestHalf = internal ? pitch / 8 : pitch / 16;
  const rootHalf = internal ? pitch / 16 : pitch / 8;
  return straightTooth(pitch, {
    depth,
    crestHalf,
    rootHalf,
    flank0: Math.PI / 6,
    flank1: Math.PI / 6,
  });
}

/** A symmetric-or-not straight-flank tooth: two flanks, a crest flat and a foot. */
function straightTooth(
  pitch: number,
  spec: {
    depth: number;
    crestHalf: number;
    rootHalf: number;
    flank0: number;
    flank1: number;
  },
): ThreadProfileShape {
  const kink = spec.depth + 0.05 * pitch;
  const foot = spec.depth + 0.25 * pitch;
  const half0 = spec.crestHalf + kink * Math.tan(spec.flank0);
  const half1 = spec.crestHalf + kink * Math.tan(spec.flank1);
  return {
    depth: spec.depth,
    crestHalf: spec.crestHalf,
    rootHalf: spec.rootHalf,
    segments: [
      { kind: 'line', to: [-half0, kink], source: 'side0' },
      { kind: 'line', to: [-spec.crestHalf, 0], source: 'flank0' },
      { kind: 'line', to: [spec.crestHalf, 0], source: 'crest' },
      { kind: 'line', to: [half1, kink], source: 'flank1' },
      { kind: 'line', to: [half1, foot], source: 'side1' },
      { kind: 'line', to: [-half0, foot], source: 'foot' },
    ],
  };
}

const sub = (a: ProfilePoint, b: ProfilePoint): [number, number] => [a[0] - b[0], a[1] - b[1]];
const add = (a: ProfilePoint, b: readonly [number, number]): [number, number] => [
  a[0] + b[0],
  a[1] + b[1],
];
const mul = (a: readonly [number, number], s: number): [number, number] => [a[0] * s, a[1] * s];
const unit = (a: readonly [number, number]): [number, number] => {
  const l = Math.hypot(a[0], a[1]);
  return [a[0] / l, a[1] / l];
};
const cross2 = (a: readonly [number, number], b: readonly [number, number]) =>
  a[0] * b[1] - a[1] * b[0];

/**
 * The bottle profile's rounded tooth (P4-12): a 20° trapezoid whose crest
 * and root corners are rounded by arcs. Built as a six-vertex loop with a
 * radius per corner and a source per corner arc.
 */
function bottleProfile(pitch: number): ThreadProfileShape {
  const depth = 0.45 * pitch;
  const crestHalf = 0.15 * pitch; // a 0.3 P crest flat
  const rootHalf = 0.15 * pitch;
  const flank = (20 * Math.PI) / 180;
  const kink = depth + 0.05 * pitch;
  const foot = depth + 0.25 * pitch;
  const half = crestHalf + kink * Math.tan(flank);
  const vertices: ProfilePoint[] = [
    [-half, foot], // A left foot
    [-half, kink], // B left kink
    [-crestHalf, 0], // C left crest
    [crestHalf, 0], // D right crest
    [half, kink], // E right kink
    [half, foot], // F right foot
  ];
  const edgeSources = ['side0', 'flank0', 'crest', 'flank1', 'side1', 'foot'];
  // Round the crest corners (C, D) and the root kinks (B, E); the foot stays sharp.
  const radii = [0, 0.06 * pitch, 0.06 * pitch, 0.06 * pitch, 0.06 * pitch, 0];
  const cornerSources = [null, 'side0', 'crest', 'crest', 'side1', null];
  return {
    depth,
    crestHalf,
    rootHalf,
    segments: roundLoop(vertices, radii, edgeSources, cornerSources),
  };
}

/**
 * The tooth outline of `profile`, in `[axial, radial]` relative to the
 * tooth's centre and crest. Pure; the kernel stages these lines and arcs and
 * knows none of the angles itself.
 */
export function threadProfile(
  profile: ThreadProfileName,
  pitch: number,
  options: ProfileOptions = {},
): ThreadProfileShape {
  switch (profile) {
    case 'trapezoidal': {
      // ISO 2901 / DIN 103: H1 = 0.5 P, a 30° included angle, so each flank
      // is 15° to the radial and both flats are 0.366 P (a 0.183 P half).
      const depth = 0.5 * pitch;
      const flat = (1 - Math.tan((15 * Math.PI) / 180)) / 4; // half of the 0.366 P flat
      return straightTooth(pitch, {
        depth,
        crestHalf: flat * pitch,
        rootHalf: flat * pitch,
        flank0: (15 * Math.PI) / 180,
        flank1: (15 * Math.PI) / 180,
      });
    }
    case 'buttress': {
      // DIN 513: H1 = 0.75 P, a 3° load flank and a 30° trailing flank, a
      // 0.26384 P crest flat (0.13192 P half) and a root radius (not modelled:
      // the ring gives the root). `loadFlank` picks the steep side.
      const depth = 0.75 * pitch;
      const crestHalf = 0.13192 * pitch;
      const steep = (3 * Math.PI) / 180;
      const trailing = Math.PI / 6;
      const steepOnEnd = (options.loadFlank ?? 'end') === 'end';
      return straightTooth(pitch, {
        depth,
        crestHalf,
        rootHalf: crestHalf,
        flank0: steepOnEnd ? trailing : steep,
        flank1: steepOnEnd ? steep : trailing,
      });
    }
    case 'bottle':
      return bottleProfile(pitch);
    default:
      return isoProfile(pitch, options.internal ?? false);
  }
}

/**
 * Builds a closed loop's segments from its vertices, rounding the corner at
 * `radii[i]` (0 leaves it sharp) with an arc. `arcSources[i]` names that arc
 * (default the edge before the corner).
 */
function roundLoop(
  vertices: readonly ProfilePoint[],
  radii: readonly number[],
  edgeSources: readonly string[],
  arcSources: readonly (string | null)[],
): ProfileSegment[] {
  const n = vertices.length;
  const P = (i: number) => vertices[((i % n) + n) % n] as ProfilePoint;
  const tangentIn: (ProfilePoint | null)[] = [];
  const tangentOut: (ProfilePoint | null)[] = [];
  const centres: (ProfilePoint | null)[] = [];
  const ccw: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const r = radii[i] ?? 0;
    if (!(r > 0)) {
      tangentIn[i] = null;
      tangentOut[i] = null;
      centres[i] = null;
      continue;
    }
    const p = P(i);
    const d1 = unit(sub(P(i - 1), p)); // towards the previous vertex
    const d2 = unit(sub(P(i + 1), p)); // towards the next
    const half = Math.acos(Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1]))) / 2;
    const t = r / Math.tan(half);
    const bisector = unit([d1[0] + d2[0], d1[1] + d2[1]]);
    const centre = add(p, mul(bisector, r / Math.sin(half)));
    const a = add(p, mul(d1, t));
    const b = add(p, mul(d2, t));
    tangentIn[i] = a;
    tangentOut[i] = b;
    centres[i] = centre;
    ccw[i] = cross2(sub(a, centre), sub(b, centre)) >= 0;
  }
  const segments: ProfileSegment[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const to = tangentIn[j] ?? P(j);
    segments.push({ kind: 'line', to, source: edgeSources[i] as string });
    const r = radii[j] ?? 0;
    if (r > 0) {
      segments.push({
        kind: 'arc',
        to: tangentOut[j] as ProfilePoint,
        centre: centres[j] as ProfilePoint,
        ccw: ccw[j] as boolean,
        source: arcSources[j] ?? (edgeSources[i] as string),
      });
    }
  }
  return segments;
}

/**
 * The radii of a thread as printed, from its profile: the basic major radius
 * D/2 and the root, `depth` closer to the axis (external) or further out
 * (internal), both moved by the tolerance into the part's material.
 */
export interface ThreadRadii {
  /** Crest to root, mm. */
  depth: number;
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
  profile: ThreadProfileName,
  diameter: number,
  pitch: number,
  tolerance: number,
  internal: boolean,
): ThreadRadii {
  const shape = threadProfile(profile, pitch, { internal });
  const major = diameter / 2;
  const crest = internal ? major - shape.depth + tolerance : major - tolerance;
  const root = internal ? major + tolerance : major - shape.depth - tolerance;
  return {
    depth: shape.depth,
    crest,
    root,
    crestHalf: shape.crestHalf,
    rootHalf: shape.rootHalf,
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
  group: 'metric' | 'metric-fine' | 'unc' | 'unf' | 'trapezoidal' | 'bottle' | 'npt';
  /** The tooth profile this size belongs to. */
  profile: ThreadProfileName;
  /** mm. */
  diameter: number;
  /** mm. */
  pitch: number;
  /** Expressions for the number fields: `diameter`, `pitch`. */
  exprs: Readonly<Record<string, string>>;
  /**
   * A tapered thread's half angle (radians; P4-12): the cone the thread is
   * made for. `diameter` is then the major diameter at the cone's small end.
   * Absent for a straight thread.
   */
  taper?: number;
}

/**
 * ISO 261 coarse pitch series, `[size, pitch]` in mm. It goes to M64 (P4-11:
 * B9's fuzzing, below): `autoThread` fits a hole only with a thread *larger*
 * than it, so a bore wider than M30 — the largest size before then — had no
 * fit at all and the cap of benchmark B9 could not be made bigger. ISO 261's
 * M55 is left out: M56 is the size in use.
 */
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
  [33, 3.5],
  [36, 4],
  [39, 4],
  [42, 4.5],
  [45, 4.5],
  [48, 5],
  [52, 5],
  [56, 5.5],
  [60, 5.5],
  [64, 6],
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
      profile: 'iso',
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
    profile: 'iso',
    diameter: diameter * 25.4,
    pitch: 25.4 / tpi,
    exprs: { diameter: `${diameter} in`, pitch: `1 in / ${tpi}` },
  });
};

/** ISO 2901 / DIN 103 trapezoidal sizes, `[nominal diameter, pitch]` in mm. */
const TRAPEZOIDAL: readonly (readonly [number, number])[] = [
  [8, 1.5],
  [10, 2],
  [12, 3],
  [16, 4],
  [20, 4],
];

const trapezoidal = ([size, pitch]: readonly [number, number]): ThreadPreset => ({
  id: `tr${size}x${pitch}`,
  label: `Tr ${size} × ${pitch}`,
  group: 'trapezoidal',
  profile: 'trapezoidal',
  diameter: size,
  pitch,
  exprs: { diameter: `${size} mm`, pitch: `${pitch} mm` },
});

/**
 * NPT's taper (ASME B1.20.1): 1 in 16 on the diameter, so a half angle of
 * atan(1/32) = 1.7899°.
 */
export const NPT_TAPER = Math.atan(1 / 32);

/** How far a cone's taper may be from a preset's and still be that thread (radians): 0.2°. */
export const TAPER_SLACK = (0.2 * Math.PI) / 180;

/**
 * American National Standard taper pipe threads (NPT, ASME B1.20.1, Table 2),
 * `[size, E0 in inches, threads per inch]`: E0 is the pitch diameter at the
 * small end of the external thread. The major diameter there is E0 + h, with
 * h = 0.8 p the truncated thread's height (Table 2's "h"), the same rule for
 * every size. The pipe's outside diameters (D) are 0.405, 0.540, 0.675,
 * 0.840, 1.050 and 1.315 in for the six sizes.
 */
const NPT: readonly (readonly [string, number, number])[] = [
  ['1/8', 0.36351, 27],
  ['1/4', 0.47739, 18],
  ['3/8', 0.61201, 18],
  ['1/2', 0.75843, 14],
  ['3/4', 0.96768, 14],
  ['1', 1.21363, 11.5],
];

/**
 * An NPT preset: the ISO 68-1 basic profile stands for NPT's own (both have
 * 60° flanks; NPT's flats are truncated a little differently, 0.8 p deep
 * against ISO's 0.541 p), on the cone of `NPT_TAPER`.
 */
const npt = ([name, e0, tpi]: readonly [string, number, number]): ThreadPreset => ({
  id: `npt-${name.replace('/', 'q')}`,
  label: `NPT ${name}`,
  group: 'npt',
  profile: 'iso',
  diameter: (e0 + 0.8 / tpi) * 25.4,
  pitch: 25.4 / tpi,
  exprs: { diameter: `${e0} in + 0.8 in / ${tpi}`, pitch: `1 in / ${tpi}` },
  taper: NPT_TAPER,
});

export const THREAD_PRESETS: readonly ThreadPreset[] = [
  ...METRIC_COARSE.map(metric('metric')),
  ...METRIC_FINE.map(metric('metric-fine')),
  ...UNC.map(inch('unc')),
  ...UNF.map(inch('unf')),
  ...TRAPEZOIDAL.map(trapezoidal),
  {
    id: 'pco-1881',
    label: 'PCO-1881',
    group: 'bottle',
    profile: 'bottle',
    diameter: 27.43,
    pitch: 2.7,
    exprs: { diameter: '27.43 mm', pitch: '2.7 mm' },
  },
  ...NPT.map(npt),
];

/** The preset with this ID. */
export function threadPreset(id: string): ThreadPreset | undefined {
  return THREAD_PRESETS.find((p) => p.id === id);
}

/**
 * The preset a diameter, pitch (mm) and profile are, to 0.001 mm; undefined
 * for a custom size. The profile matters: the same diameter and pitch in a
 * different profile is not that preset. With `taper` (radians, P4-12) the
 * taper matters too: a preset's own (0 for a straight one) must be within
 * `TAPER_SLACK` of its size, either way along the axis; without it, any.
 */
export function threadPresetOf(
  diameter: number,
  pitch: number,
  profile: ThreadProfileName = 'iso',
  taper?: number,
): ThreadPreset | undefined {
  return THREAD_PRESETS.find(
    (p) =>
      p.profile === profile &&
      Math.abs(p.diameter - diameter) < 1e-3 &&
      Math.abs(p.pitch - pitch) < 1e-3 &&
      (taper === undefined || Math.abs((p.taper ?? 0) - Math.abs(taper)) <= TAPER_SLACK),
  );
}

/** A taper in degrees as a designation says it: "1.8°". */
export function taperDegrees(taper: number): string {
  return `${Number(((Math.abs(taper) * 180) / Math.PI).toFixed(1))}°`;
}

/**
 * The ISO metric coarse thread for a face of `radius` mm (`autoThread`):
 * on a shaft the largest whose major diameter isn't more than 0.1 mm over
 * the shaft's, in a hole the largest whose minor diameter is at most the
 * hole's + 0.1 mm and whose major is larger than it (a tap-drill hole finds
 * its thread). Undefined when none fits.
 */
export function autoThread(
  radius: number,
  internal: boolean,
  group: ThreadPreset['group'] = 'metric',
): ThreadPreset | undefined {
  const d = 2 * radius;
  const coarse = THREAD_PRESETS.filter((p) => p.group === group);
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

/**
 * The NPT thread for a cone (P4-12): the same fit as `autoThread`, by the
 * cone's radius at its small end, when its half angle is within
 * `TAPER_SLACK` of `NPT_TAPER`; undefined for any other cone, which needs a
 * size of its own.
 */
export function autoTaperThread(
  smallRadius: number,
  taper: number,
  internal: boolean,
): ThreadPreset | undefined {
  if (Math.abs(Math.abs(taper) - NPT_TAPER) > TAPER_SLACK) return undefined;
  return autoThread(smallRadius, internal, 'npt');
}

/**
 * What a thread reports (`FeatureOutput.report`, P4-12): each threaded
 * face's designation ("M8", "NPT 1/2", "Ø20 × 1.5, taper 1.8°"), in the
 * order of its faces, for the dialog's Size line.
 */
export interface ThreadReport {
  kind: 'thread';
  designations: string[];
}

export function isThreadReport(report: unknown): report is ThreadReport {
  return (report as { kind?: unknown } | null | undefined)?.kind === 'thread';
}
