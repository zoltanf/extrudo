/**
 * Deterministic identifiers (ADR-0068 §2).
 *
 * The app hands out a UUID per entity and never reuses one. The API can't: a
 * script runs again on every recompute (P5-02), and features whose IDs changed
 * would lose their references each time. So a design counts instead, per kind:
 * `f1`, `f2`… for features, `p1`… for parameters, `s1`… for sketch entities,
 * `sh1`, `sv1`, `si1` for sheets, their views and items, and so on (see `PREFIX`). The counters start past every ID a loaded
 * document already has, so a new one never collides with a stored feature's.
 *
 * `options.ids` replaces the whole factory (a UUID generator, a recorded run).
 */
import {
  type DocumentId,
  type ExtrudoDocument,
  MAX_FEATURE_ID_LENGTH,
  MAX_ID_LENGTH,
} from '@extrudo/core';
import { ApiError } from './error';

/** What an ID is for. The prefix is part of the API's surface: `f1` is a feature. */
export type IdKind =
  | 'document'
  | 'feature'
  | 'parameter'
  | 'group'
  | 'sketchEntity'
  | 'constraint'
  | 'dimension'
  | 'configuration'
  | 'component'
  | 'joint'
  | 'annotation'
  | 'sheet'
  | 'sheetView'
  | 'sheetItem';

const PREFIX: Readonly<Record<IdKind, string>> = {
  document: 'doc',
  feature: 'f',
  parameter: 'p',
  group: 'g',
  sketchEntity: 's',
  constraint: 'c',
  dimension: 'd',
  configuration: 'cfg',
  component: 'cmp',
  joint: 'jnt',
  annotation: 'n',
  sheet: 'sh',
  sheetView: 'sv',
  sheetItem: 'si',
};

/** The document keys `storedIds` reads: the IDs an API factory must skip past. */
type StoredIdDocument = Pick<
  ExtrudoDocument,
  'features' | 'parameters' | 'groups' | 'components' | 'joints' | 'annotations' | 'sheets'
>;

/** Hands out the design's IDs. One call per new entity, in creation order. */
export type IdFactory = (kind: IdKind) => string;

/**
 * A counting factory, seeded with the IDs a document already uses so nothing
 * it hands out collides with a stored one.
 */
export class CounterIds {
  readonly #counts = new Map<IdKind, number>();
  readonly #taken: Set<string>;

  constructor(doc?: StoredIdDocument) {
    this.#taken = new Set(doc ? storedIds(doc) : []);
  }

  /**
   * Takes in the IDs of a loaded document, so the counters skip past them: a
   * `from` design must not hand out an ID a stored feature already has.
   */
  seed(doc: StoredIdDocument): void {
    for (const id of storedIds(doc)) this.#taken.add(id);
  }

  /** Every ID a document stores, which is what this factory skips past. */
  static all(doc: StoredIdDocument): string[] {
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

/** Every ID a document stores: features, parameters, groups, components, joints, annotations and sheets (their views and items too). */
export function storedIds(doc: StoredIdDocument): string[] {
  const ids: string[] = [];
  for (const parameter of doc.parameters) ids.push(parameter.id);
  for (const feature of doc.features) {
    ids.push(feature.id);
    for (const input of Object.values(feature.inputs)) {
      if (input.kind !== 'sketchData') continue;
      // A loop, not a spread: a sketch of many entities passes the engine's argument limit.
      for (const table of [
        input.sketch.entities,
        input.sketch.constraints,
        input.sketch.dimensions,
      ])
        for (const id of Object.keys(table)) ids.push(id);
    }
  }
  for (const group of doc.groups ?? []) ids.push(group.id);
  for (const component of doc.components ?? []) ids.push(component.id);
  for (const joint of doc.joints ?? []) ids.push(joint.id);
  for (const annotation of doc.annotations ?? []) ids.push(annotation.id);
  for (const sheet of doc.sheets ?? []) {
    ids.push(sheet.id);
    for (const view of sheet.views) ids.push(view.id);
    for (const item of sheet.items) ids.push(item.id);
  }
  return ids;
}

/**
 * `id` as the ID of a new or named entity of `kind`, or `ApiError` when the
 * document can't hold it (ADR-0003's amendments of 2026-11-23): at most
 * `MAX_ID_LENGTH` characters, a feature's at most `MAX_FEATURE_ID_LENGTH`
 * (its bodies' IDs, `<feature>:<n>`, must fit too). Every ID the API takes
 * from a caller (`options.id`, a body's ID) or its factory passes here, so
 * the call is refused, never the design when it is opened again.
 */
export function checkedId(kind: IdKind | 'body', id: string): string {
  if (kind === 'feature' && id.length > MAX_FEATURE_ID_LENGTH) {
    throw new ApiError(`A feature's ID may have at most ${MAX_FEATURE_ID_LENGTH} characters.`, {
      path: 'id',
    });
  }
  if (id.length > MAX_ID_LENGTH) {
    throw new ApiError(
      `An ID may have at most ${MAX_ID_LENGTH.toLocaleString('en-US')} characters.`,
      { path: 'id' },
    );
  }
  return id;
}

/** The document's own ID: given, or the next of the factory's. */
export function documentId(factory: IdFactory, id?: DocumentId): DocumentId {
  return id ?? (factory('document') as DocumentId);
}
