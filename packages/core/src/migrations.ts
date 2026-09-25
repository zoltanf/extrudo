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
  constructor(
    readonly code: DocumentLoadErrorCode,
    message: string,
    readonly issues: readonly z.core.$ZodIssue[] = [],
  ) {
    super(message);
  }
}

export interface LoadResult {
  doc: ExtrudoDocument;
  /** The `formatVersion` the file had before migration. */
  loadedVersion: number;
  migrated: boolean;
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
 *   `appVersion` sit at the top level.
 */
const v0ToV1: Migration = {
  from: 0,
  description: 'settings object, parameter IDs and unit kinds, suppressed flag, timeline marker',
  migrate(doc, ctx) {
    const { units, created, appVersion, parameters, features, ...rest } = doc;
    const featureList = asArray(features).map((raw) => {
      const { disabled, ...feature } = asObject(raw);
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

function unitKindOfSymbol(symbol: unknown): string {
  if (symbol === 'deg' || symbol === 'rad') return 'angle';
  if (symbol === '' || symbol === undefined) return 'unitless';
  return 'length';
}

/** Every migration, in order. The last one must produce `FORMAT_VERSION`. */
export const MIGRATIONS: readonly Migration[] = [v0ToV1];

/**
 * Brings raw document JSON up to the current format version and validates it.
 * Throws `DocumentLoadError`.
 */
export function loadDocument(raw: unknown, ctx?: Partial<MigrationContext>): LoadResult {
  if (!isObject(raw) || raw.format !== FORMAT_NAME || !Number.isInteger(raw.formatVersion)) {
    throw new DocumentLoadError('not-a-document', 'This is not an Extrudo document.');
  }
  const loadedVersion = raw.formatVersion as number;
  if (loadedVersion > FORMAT_VERSION) {
    throw new DocumentLoadError(
      'too-new',
      `This document was saved by a newer Extrudo (format ${loadedVersion}; this version reads up to ${FORMAT_VERSION}). Update Extrudo to open it.`,
    );
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
  const parsed = DocumentSchema.safeParse(doc);
  if (!parsed.success) {
    throw new DocumentLoadError(
      'invalid',
      `The document is damaged: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || '(root)'} ${i.message}`)
        .join('; ')}.`,
      parsed.error.issues,
    );
  }
  return { doc: parsed.data, loadedVersion, migrated: loadedVersion !== FORMAT_VERSION };
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
