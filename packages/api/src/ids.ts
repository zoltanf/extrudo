/**
 * Deterministic identifiers (ADR-0068 §2).
 *
 * The app hands out a UUID per entity and never reuses one. The API can't: a
 * script runs again on every recompute (P5-02), and features whose IDs changed
 * would lose their references each time. So a design counts instead, per kind:
 * `f1`, `f2`… for features, `p1`… for parameters, `s1`… for sketch entities,
 * and so on (see `PREFIX`). The counters start past every ID a loaded
 * document already has, so a new one never collides with a stored feature's.
 *
 * `options.ids` replaces the whole factory (a UUID generator, a recorded run).
 */
import type { DocumentId, ExtrudoDocument } from '@extrudo/core';

/** What an ID is for. The prefix is part of the API's surface: `f1` is a feature. */
export type IdKind =
  | 'document'
  | 'feature'
  | 'parameter'
  | 'group'
  | 'sketchEntity'
  | 'constraint'
  | 'dimension'
  | 'configuration';

const PREFIX: Readonly<Record<IdKind, string>> = {
  document: 'doc',
  feature: 'f',
  parameter: 'p',
  group: 'g',
  sketchEntity: 's',
  constraint: 'c',
  dimension: 'd',
  configuration: 'cfg',
};

/** Hands out the design's IDs. One call per new entity, in creation order. */
export type IdFactory = (kind: IdKind) => string;

/**
 * A counting factory, seeded with the IDs a document already uses so nothing
 * it hands out collides with a stored one.
 */
export class CounterIds {
  readonly #counts = new Map<IdKind, number>();
  readonly #taken: Set<string>;

  constructor(doc?: Pick<ExtrudoDocument, 'features' | 'parameters' | 'groups'>) {
    this.#taken = new Set(doc ? storedIds(doc) : []);
  }

  /**
   * Takes in the IDs of a loaded document, so the counters skip past them: a
   * `from` design must not hand out an ID a stored feature already has.
   */
  seed(doc: Pick<ExtrudoDocument, 'features' | 'parameters' | 'groups'>): void {
    for (const id of storedIds(doc)) this.#taken.add(id);
  }

  /** Every ID a document stores, which is what this factory skips past. */
  static all(doc: Pick<ExtrudoDocument, 'features' | 'parameters' | 'groups'>): string[] {
    return storedIds(doc);
  }

  /** The next ID of `kind`, skipping one the document already has. */
  next = (kind: IdKind): string => {
    const prefix = PREFIX[kind];
    let n = this.#counts.get(kind) ?? 0;
    let id = '';
    do {
      n += 1;
      id = `${prefix}${n}`;
    } while (this.#taken.has(id));
    this.#counts.set(kind, n);
    this.#taken.add(id);
    return id;
  };
}

/** Every ID a document stores: features, parameters, groups and sketch entities. */
export function storedIds(
  doc: Pick<ExtrudoDocument, 'features' | 'parameters' | 'groups'>,
): string[] {
  const ids: string[] = [];
  for (const parameter of doc.parameters) ids.push(parameter.id);
  for (const feature of doc.features) {
    ids.push(feature.id);
    for (const input of Object.values(feature.inputs)) {
      if (input.kind !== 'sketchData') continue;
      ids.push(...Object.keys(input.sketch.entities));
      ids.push(...Object.keys(input.sketch.constraints));
      ids.push(...Object.keys(input.sketch.dimensions));
    }
  }
  for (const group of doc.groups ?? []) ids.push(group.id);
  return ids;
}

/** The document's own ID: given, or the next of the factory's. */
export function documentId(factory: IdFactory, id?: DocumentId): DocumentId {
  return id ?? (factory('document') as DocumentId);
}
