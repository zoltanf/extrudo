/**
 * A plugin's manifest (P6-03, ADR-0077 §1): `plugin.json` in a
 * `.extrudo-plugin` file, which says what the plugin is and what it offers —
 * commands (one-offs that add features) and custom features (timeline entries
 * with a dialog of typed inputs).
 *
 * The manifest is checked with this schema **before anything else of the file
 * is read**, and strictly: a key the schema lacks, an input `kind` this version
 * doesn't draw, a command with `keys` (a plugin never binds a key, ADR-0023) is
 * refused with the path and the reason (`PluginManifestError`), never guessed.
 * A new input kind is an amendment of ADR-0077 and a line in
 * `docs/file-format.md` §6.32.
 */
import { type GeomRefKind, GeomRefKindSchema } from './refs';
import { z } from './zod';

/** A plugin's ID: lower case, digits and dashes, 2 to 64 characters (`name-plate`). */
export const PLUGIN_ID = /^[a-z][a-z0-9-]{1,63}$/;

/** A command's ID or a custom feature's type within a plugin (`three-holes`). */
export const PLUGIN_NAME = /^[a-z][a-z0-9-]{0,63}$/;

/** A feature input's name: an identifier, so a handler reads it as `inputs.width`. */
export const PLUGIN_INPUT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** A semantic version: `1.2.0`, `0.3.0-beta.1`, `2.0.0+build.7`. */
export const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** An SPDX license expression, by its form: `MIT`, `GPL-3.0-or-later`, `MIT OR Apache-2.0`. */
const SPDX = /^[A-Za-z0-9.+-]+(?: (?:AND|OR|WITH) [A-Za-z0-9.+-]+)*$/;

/** The module a plugin runs: TypeScript (its types stripped) or JavaScript. */
export const PLUGIN_MAINS = ['main.ts', 'main.js'] as const;

/** How long a plugin's module may be, in characters (ADR-0077 §1: a Script's doubled). */
export const PLUGIN_MAX_CODE = 200_000;

/** What an `expr` input measures: a length (mm), an angle (degrees) or a plain number. */
export const PLUGIN_UNITS = ['length', 'angle', 'none'] as const;
export type PluginUnit = (typeof PLUGIN_UNITS)[number];

/** The input kinds a custom feature's dialog may have (ADR-0077 §1). */
export const PLUGIN_INPUT_KINDS = ['expr', 'bool', 'enum', 'ref'] as const;
export type PluginInputKind = (typeof PLUGIN_INPUT_KINDS)[number];

/** What a `ref` input may accept: every reference kind but a timeline feature. */
export const PLUGIN_REF_KINDS = GeomRefKindSchema.options.filter(
  (kind): kind is Exclude<GeomRefKind, 'feature'> => kind !== 'feature',
);

/**
 * A control character (other than a tab) or a bidi override or isolate: what
 * could make a label in the Plugins dialog, the Create menu or Ctrl+K read as
 * something else. Refused, not stripped: the file is the author's.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: that is the check
const UNSAFE_TEXT = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;

/** A string the UI shows: no control characters, no bidi overrides. */
const shown = (text: z.ZodString) =>
  text.refine((value) => !UNSAFE_TEXT.test(value), {
    message: 'must not contain control or bidirectional-override characters',
  });

const label = shown(z.string().trim().min(1).max(60));
const hint = shown(z.string().max(200));
const inputBase = {
  name: z.string().regex(PLUGIN_INPUT_NAME, 'must be an identifier like width or hole_count'),
  label,
  hint: hint.optional(),
};

const ExprPluginInput = z.strictObject({
  ...inputBase,
  kind: z.literal('expr'),
  unit: z.enum(PLUGIN_UNITS),
  /** An expression (`'40 mm'`, `'2 * wall'`) or a number in the unit's base. */
  default: z.union([z.string().min(1), z.number()]).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

const BoolPluginInput = z.strictObject({
  ...inputBase,
  kind: z.literal('bool'),
  default: z.boolean().optional(),
});

const EnumPluginInput = z
  .strictObject({
    ...inputBase,
    kind: z.literal('enum'),
    options: z
      .array(shown(z.string().min(1).max(60)))
      .min(1)
      .max(50),
    default: z.string().optional(),
  })
  .refine((input) => input.default === undefined || input.options.includes(input.default), {
    message: 'must be one of the options',
    path: ['default'],
  });

const RefPluginInput = z.strictObject({
  ...inputBase,
  kind: z.literal('ref'),
  accepts: z.array(z.enum(PLUGIN_REF_KINDS)).min(1),
  multiple: z.boolean().optional(),
});

export const PluginInputSchema = z.discriminatedUnion('kind', [
  ExprPluginInput,
  BoolPluginInput,
  EnumPluginInput,
  RefPluginInput,
]);
export type PluginInput = z.infer<typeof PluginInputSchema>;

export const PluginCommandSchema = z.strictObject({
  id: z.string().regex(PLUGIN_NAME, 'must be lower case letters, digits and dashes'),
  label,
  hint: hint.optional(),
});
export type PluginCommand = z.infer<typeof PluginCommandSchema>;

export const PluginFeatureSchema = z
  .strictObject({
    type: z.string().regex(PLUGIN_NAME, 'must be lower case letters, digits and dashes'),
    label,
    hint: hint.optional(),
    /** One of the design system's tool icons by name: a plugin ships no assets. */
    icon: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,63}$/, 'must be the name of a tool icon')
      .optional(),
    inputs: z.array(PluginInputSchema).max(32),
  })
  .superRefine((feature, ctx) => {
    for (const [at, name] of repeats(feature.inputs.map((input) => input.name))) {
      ctx.addIssue({
        code: 'custom',
        path: ['inputs', at, 'name'],
        message: `"${name}" is used by an earlier input`,
      });
    }
  });
export type PluginFeature = z.infer<typeof PluginFeatureSchema>;

export const PluginManifestSchema = z
  .strictObject({
    id: z.string().regex(PLUGIN_ID, 'must be lower case letters, digits and dashes, 2 to 64'),
    name: shown(z.string().trim().min(1).max(80)),
    version: z.string().regex(SEMVER, 'must be a version like 1.0.0'),
    description: shown(z.string().max(500)),
    author: shown(z.string().max(200)),
    license: z.string().regex(SPDX, 'must be an SPDX license like MIT or GPL-3.0-or-later'),
    main: z.enum(PLUGIN_MAINS),
    commands: z.array(PluginCommandSchema).max(100).default([]),
    features: z.array(PluginFeatureSchema).max(100).default([]),
  })
  .superRefine((manifest, ctx) => {
    for (const [at, id] of repeats(manifest.commands.map((command) => command.id))) {
      ctx.addIssue({
        code: 'custom',
        path: ['commands', at, 'id'],
        message: `"${id}" is used by an earlier command`,
      });
    }
    for (const [at, type] of repeats(manifest.features.map((feature) => feature.type))) {
      ctx.addIssue({
        code: 'custom',
        path: ['features', at, 'type'],
        message: `"${type}" is used by an earlier feature`,
      });
    }
  });
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

/** The manifest's file name in a plugin file. */
export const PLUGIN_MANIFEST_FILE = 'plugin.json';

/**
 * A manifest the app doesn't understand: `message` says where and why
 * ("plugin.json › features[0] › inputs[2] › kind: expected one of expr, bool,
 * enum, ref"); `path` is the place in the manifest, empty for the whole file.
 */
export class PluginManifestError extends Error {
  override readonly name = 'PluginManifestError';
  // Fields, not constructor parameter properties: Node runs core's TypeScript
  // as it is (P5-03's CLI).
  readonly path: readonly (string | number)[];
  readonly reason: string;
  constructor(path: readonly (string | number)[], reason: string) {
    super(`${[PLUGIN_MANIFEST_FILE, ...steps(path)].join(' › ')}: ${reason}`);
    this.path = path;
    this.reason = reason;
  }
}

/**
 * The manifest of `plugin.json`, from its text or its parsed JSON. Throws
 * `PluginManifestError` for text that isn't JSON or a manifest the schema
 * refuses, with the first problem's place and reason.
 */
export function parsePluginManifest(json: unknown): PluginManifest {
  let value = json;
  if (typeof json === 'string') {
    try {
      value = JSON.parse(json);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new PluginManifestError([], `isn't valid JSON (${reason})`);
    }
  }
  const parsed = PluginManifestSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new PluginManifestError(
    (issue?.path ?? []).map((part) => (typeof part === 'symbol' ? String(part) : part)),
    issue ? reasonOf(issue) : 'is not a plugin manifest',
  );
}

/** The ID a plugin command is offered under in the app: `plugin:<plugin>:<command>`. */
export function pluginCommandId(plugin: string, command: string): string {
  return `plugin:${plugin}:${command}`;
}

/** The file name a plugin is saved under: `<id>.extrudo-plugin`. */
export function pluginFileName(manifest: Pick<PluginManifest, 'id'>): string {
  return `${manifest.id}.extrudo-plugin`;
}

/** A zod issue in the user's words: a wrong `kind` lists the kinds there are. */
function reasonOf(issue: z.core.$ZodIssue): string {
  const last = issue.path.at(-1);
  if (issue.code === 'invalid_union' && last === 'kind') {
    return `expected one of ${PLUGIN_INPUT_KINDS.join(', ')}`;
  }
  if (issue.code === 'unrecognized_keys') {
    const keys = issue.keys.map((key) => `"${key}"`).join(', ');
    return `${keys} ${issue.keys.length === 1 ? 'is not a key' : 'are not keys'} a plugin manifest has here`;
  }
  if (issue.code === 'invalid_value') {
    return `expected one of ${issue.values.map((value) => String(value)).join(', ')}`;
  }
  return issue.message;
}

/** `['features', 0, 'inputs', 2, 'kind']` → `features[0]`, `inputs[2]`, `kind`. */
function steps(path: readonly (string | number)[]): string[] {
  const out: string[] = [];
  for (const part of path) {
    if (typeof part === 'number' && out.length > 0) out[out.length - 1] += `[${part}]`;
    else out.push(String(part));
  }
  return out;
}

/** The later of every value that repeats an earlier one, with its index. */
function repeats(values: readonly string[]): [number, string][] {
  const seen = new Set<string>();
  const out: [number, string][] = [];
  values.forEach((value, at) => {
    if (seen.has(value)) out.push([at, value]);
    seen.add(value);
  });
  return out;
}

/**
 * Orders two semantic versions by SemVer 2.0's precedence (P6-03 slice 2: the
 * plugin store refuses an install that isn't newer): negative when `a` comes
 * first, 0 when they are equal, positive after. Build metadata (`+…`) doesn't
 * count, a pre-release comes before its release, and pre-release identifiers
 * compare numerically when both are numbers, a number before a word.
 */
export function compareSemver(a: string, b: string): number {
  const parse = (version: string) => {
    const [core = '', pre] = version.split('+', 1)[0]?.split(/-(.*)/s) ?? [];
    return { core: core.split('.').map(Number), pre: pre ? pre.split('.') : [] };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  if (x.pre.length === 0 || y.pre.length === 0)
    return y.pre.length - x.pre.length === 0 ? 0 : x.pre.length === 0 ? 1 : -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) {
      const d = Number(p) - Number(q);
      if (d !== 0) return Math.sign(d);
    } else if (pn !== qn) return pn ? -1 : 1;
    else if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}
