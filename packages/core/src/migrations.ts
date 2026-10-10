/**
 * Loading a document: format check, migrations, schema validation.
 *
 * Migrations work on raw JSON, one version step at a time, and never import
 * the current schema types: a migration written for v3 → v4 must keep working
 * after v5 changes `schema.ts`. Each one is pure; IDs and timestamps come from
 * the context so tests can pin them.
 */
import type { z } from 'zod';
import { FORMAT_NAME, FORMAT_VERSION } from './format';
import { newId } from './ids';
import { DocumentSchema, type ExtrudoDocument } from './schema';

export type JsonObject = { [key: string]: unknown };

export interface MigrationContext {
  newId(): string;
  /** ISO timestamp, for fields an old format didn't have. */
  now: string;
}

export interface Migration {
  /** Migrates a document of `formatVersion` `from` to `from + 1`. */
  from: number;
  description: string;
  migrate(doc: JsonObject, ctx: MigrationContext): JsonObject;
}

export type DocumentLoadErrorCode = 'not-a-document' | 'too-new' | 'invalid';

export class DocumentLoadError extends Error {
  override readonly name = 'DocumentLoadError';
  // Plain fields, not parameter properties: Node loads core's TypeScript
  // directly when a script imports it (scripts/generate-api.mjs), and type
  // stripping doesn't allow parameter properties.
  readonly code: DocumentLoadErrorCode;
  readonly issues: readonly z.core.$ZodIssue[];
  constructor(
    code: DocumentLoadErrorCode,
    message: string,
    issues: readonly z.core.$ZodIssue[] = [],
  ) {
    super(message);
    this.code = code;
    this.issues = issues;
  }
}

export interface LoadResult {
  doc: ExtrudoDocument;
  /** The `formatVersion` the file had before migration. */
  loadedVersion: number;
  migrated: boolean;
  /**
   * Keys this version doesn't know, left out of `doc` (P3-13): a newer
   * Extrudo added them. Paths like `features.0.inputs.depth.newKey`.
   */
  dropped: string[];
}

/**
 * Format version 0: the draft shape used before the v1 schema (P0-06). No
 * Extrudo release wrote it; it exists so the migration chain has a real first
 * step and a fixture (`fixtures/v0-bracket.json`). Differences from v1:
 * - top-level `units`, no `settings`, no document `id`;
 * - parameters without `id`, and `unit` is a unit symbol (`mm`, `deg`, `""`)
 *   rather than a unit kind;
 * - features have an optional `disabled` instead of `suppressed`;
 * - no `timelineMarker`, `bodies`, `views` or `meta`; `created` and
 *   `appVersion` sit at the top level;
 * - sketch data holds `entities` and `constraints` as arrays of objects with
 *   an `id`, and no `dimensions`.
 */
const v0ToV1: Migration = {
  from: 0,
  description:
    'settings object, parameter IDs and unit kinds, suppressed flag, timeline marker, sketch records',
  migrate(doc, ctx) {
    const { units, created, appVersion, parameters, features, ...rest } = doc;
    const featureList = asArray(features).map((raw) => {
      const { disabled, ...feature } = asObject(raw);
      if (feature.type === 'sketch') feature.inputs = sketchInputsV1(asObject(feature.inputs));
      return { ...feature, suppressed: disabled === true };
    });
    const createdAt = typeof created === 'string' ? created : ctx.now;
    return {
      ...rest,
      formatVersion: 1,
      id: ctx.newId(),
      settings: { units: units ?? 'mm', precision: 2 },
      parameters: asArray(parameters).map((raw) => {
        const { unit, ...parameter } = asObject(raw);
        return { id: ctx.newId(), ...parameter, unit: unitKindOfSymbol(unit) };
      }),
      features: featureList,
      timelineMarker: featureList.length,
      bodies: {},
      views: [],
      meta: {
        created: createdAt,
        modified: createdAt,
        appVersion: typeof appVersion === 'string' ? appVersion : '0.0.0',
      },
    };
  },
};

/** v0 sketch data kept its lists as arrays; v1 keys them by ID. */
function sketchInputsV1(inputs: JsonObject): JsonObject {
  const input = asObject(inputs.sketch);
  if (input.kind !== 'sketchData') return inputs;
  const { entities, constraints, dimensions, ...rest } = asObject(input.sketch);
  const byId = (list: unknown) =>
    Object.fromEntries(
      asArray(list).map((raw) => {
        const { id, ...item } = asObject(raw);
        return [String(id), item];
      }),
    );
  return {
    ...inputs,
    sketch: {
      ...input,
      sketch: {
        ...rest,
        entities: byId(entities),
        constraints: byId(constraints),
        dimensions: byId(dimensions),
      },
    },
  };
}

function unitKindOfSymbol(symbol: unknown): string {
  if (symbol === 'deg' || symbol === 'rad') return 'angle';
  if (symbol === '' || symbol === undefined) return 'unitless';
  return 'length';
}

/** Every migration, in order. The last one must produce `FORMAT_VERSION`. */
export const MIGRATIONS: readonly Migration[] = [v0ToV1];

/** At most this many rounds of dropping unknown keys (each round finds every one it can see). */
const LENIENT_ROUNDS = 4;

/**
 * Validates `doc` (mutated), dropping keys the schema doesn't know. The
 * schema's objects are strict, so an unknown key is an `unrecognized_keys`
 * issue with its path; when those are the only issues, the keys are removed
 * and the document is checked again. Any other issue fails. `schema` is the
 * document's own; tests pass an older one to read a file the way a previous
 * Extrudo would (ADR-0081: an older reader drops `components`).
 */
export function parseLeniently(
  doc: JsonObject,
  schema: z.ZodType<ExtrudoDocument> = DocumentSchema,
):
  | { ok: true; doc: ExtrudoDocument; dropped: string[] }
  | { ok: false; issues: z.core.$ZodIssue[] } {
  const dropped: string[] = [];
  for (let round = 0; ; round++) {
    const parsed = schema.safeParse(doc);
    if (parsed.success) return { ok: true, doc: parsed.data, dropped };
    const { issues } = parsed.error;
    const other = issues.filter((i) => i.code !== 'unrecognized_keys');
    if (other.length > 0 || round === LENIENT_ROUNDS)
      return { ok: false, issues: other.length ? other : issues };
    for (const issue of issues) {
      if (issue.code !== 'unrecognized_keys') continue;
      const owner = issue.path.reduce<unknown>(
        (at, key) =>
          isObject(at) || Array.isArray(at) ? (at as JsonObject)[key as string] : undefined,
        doc,
      );
      if (!isObject(owner)) return { ok: false, issues };
      for (const key of issue.keys) {
        delete owner[key];
        dropped.push([...issue.path, key].join('.'));
      }
    }
  }
}

const describeIssues = (issues: readonly z.core.$ZodIssue[]) =>
  issues
    .slice(0, 3)
    .map((i) => `${i.path.join('.') || '(root)'} ${i.message}`)
    .join('; ');

/**
 * Brings raw document JSON up to the current format version and validates it.
 * Keys a newer Extrudo added are left out (`dropped`), and a document of a
 * newer format version is read as far as this version understands it
 * (`loadedVersion` > `FORMAT_VERSION`); `loadNotice` words both for the
 * user. Throws `DocumentLoadError`: `too-new` when a newer document has
 * more than unknown keys (a changed shape, a feature type this version
 * doesn't have).
 */
export function loadDocument(raw: unknown, ctx?: Partial<MigrationContext>): LoadResult {
  if (!isObject(raw) || raw.format !== FORMAT_NAME || !Number.isInteger(raw.formatVersion)) {
    throw new DocumentLoadError('not-a-document', 'This is not an Extrudo document.');
  }
  const loadedVersion = raw.formatVersion as number;
  if (loadedVersion > FORMAT_VERSION) {
    // Read it as ours: if all that's new are keys, what's left is a valid design.
    const doc = JSON.parse(JSON.stringify(raw)) as JsonObject;
    doc.formatVersion = FORMAT_VERSION;
    const parsed = parseLeniently(doc);
    if (!parsed.ok) {
      throw new DocumentLoadError(
        'too-new',
        `This design was saved by a newer Extrudo (file format ${loadedVersion}; this version reads up to ${FORMAT_VERSION}) and uses things this version doesn't have. Update Extrudo to open it.`,
        parsed.issues,
      );
    }
    return { doc: parsed.doc, loadedVersion, migrated: false, dropped: parsed.dropped };
  }
  const context: MigrationContext = {
    newId: ctx?.newId ?? (() => newId()),
    now: ctx?.now ?? new Date().toISOString(),
  };
  // A JSON round trip: copies the input (migrations may reuse its objects) and drops non-JSON values.
  let doc = JSON.parse(JSON.stringify(raw)) as JsonObject;
  for (let version = loadedVersion; version < FORMAT_VERSION; version++) {
    const step = MIGRATIONS.find((m) => m.from === version);
    if (!step) {
      throw new DocumentLoadError('invalid', `No migration from format version ${version}.`);
    }
    doc = step.migrate(doc, context);
  }
  const parsed = parseLeniently(doc);
  if (!parsed.ok) {
    throw new DocumentLoadError(
      'invalid',
      `The document is damaged: ${describeIssues(parsed.issues)}.`,
      parsed.issues,
    );
  }
  return {
    doc: parsed.doc,
    loadedVersion,
    migrated: loadedVersion !== FORMAT_VERSION,
    dropped: parsed.dropped,
  };
}

/**
 * What to tell the user about a load (P3-13), or undefined when there is
 * nothing to say: a newer file, or unknown keys left out. `saving` is what
 * saving does to the source: `'drops'` when the source itself is
 * overwritten (a stored project), `'copy'` when it isn't (an imported file).
 */
export function loadNotice(result: LoadResult, saving: 'drops' | 'copy'): string | undefined {
  const newer = result.loadedVersion > FORMAT_VERSION;
  if (!newer && result.dropped.length === 0) return undefined;
  const who = newer
    ? `a newer Extrudo (file format ${result.loadedVersion}; this version reads ${FORMAT_VERSION})`
    : 'a newer Extrudo';
  const count = result.dropped.length;
  const what =
    count === 0
      ? 'Everything in it is known here'
      : `${count} ${count === 1 ? 'setting' : 'settings'} this version doesn't know ${count === 1 ? 'was' : 'were'} left out`;
  const after =
    saving === 'drops'
      ? count === 0
        ? 'Saving here writes it in this version’s format.'
        : 'Saving here loses them; reload to update Extrudo first if you need them.'
      : 'The file itself is unchanged.';
  return `This design was saved by ${who}. ${what}. ${after}`;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asObject(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
