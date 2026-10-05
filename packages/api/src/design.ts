/**
 * `Design`: a document and the commands that change it (ADR-0068 §2).
 *
 * ```
 * const d = Design.create({ name: 'Bracket', units: 'mm' });   // or Design.from(json)
 * const width = d.parameter('width', '40 mm');                 // `${width}` in expressions
 * const box = d.box({ length: width, width: '20 mm', height: '5 mm' });
 * d.rename(box, 'Base');
 * d.toJSON();            // ExtrudoDocument, schema-valid
 * await d.toFile();      // `.extrudo` bytes (storage's archive writer)
 * ```
 *
 * Every change is one of core's commands on a `DocumentState`, so the document
 * is always valid, undo works (`design.state.undo()`), and a call's inputs are
 * checked with the feature's own schema before anything is dispatched: a call
 * that throws `ApiError` leaves the design as it was.
 *
 * **Determinism.** IDs come from a counting factory (`ids.ts`), names follow the
 * app's (`nextFeatureName`: "Extrude1"), and nothing reads a clock unless the
 * caller gave one. The same calls on the same starting document give the same
 * JSON, byte for byte, which is what lets a script run on every recompute
 * (P5-02) without the features after it losing their references.
 *
 * The methods for the feature types themselves (`d.box`, `d.extrude`, …) are
 * generated from core's feature registry: see `generated/features.ts`.
 */
import {
  addConfiguration,
  addParameter,
  type Command,
  CommandError,
  type ConfigurationId,
  type Customizer,
  configurationChanges,
  createDocument,
  createDocumentStore,
  type DocumentId,
  type DocumentState,
  type DocumentStore,
  documentFeatures,
  type ExtrudoDocument,
  type Feature,
  type FeatureDefinition,
  type FeatureId,
  type FeatureInputs,
  type GeomRef,
  type GroupId,
  groupFeatures,
  insertFeature,
  type LengthUnit,
  type LoadResult,
  loadDocument,
  loadNotice,
  modifySketch,
  moveFeature,
  type NewDocumentOptions,
  nextFeatureName,
  nextModelParameterName,
  type Parameter,
  type ParameterId,
  removeFeature,
  removeParameter,
  renameFeature,
  SKETCH_TYPE,
  type SketchDimension,
  setFeatureSuppressed,
  setParameterExpressions,
  sketchInputs,
  updateParameter,
} from '@extrudo/core';
import { emptyAdd } from '@extrudo/sketch/build';
import { writeArchive } from '@extrudo/storage';
import { ApiError } from './error';
import { inferUnit } from './expr';
import { type FeatureMethods, featureMethods } from './generated/features';
import { FeatureHandle, type OriginRefs, originRefs, ParameterHandle, ref } from './handles';
import { CounterIds, type IdFactory } from './ids';
import { type FeatureInputValue, storedInputs } from './inputs';
import { SketchBuilder, SketchHandle, type SketchOptions } from './sketch';

/** What a feature may be named besides its default, and where it goes. */
export interface FeatureOptions {
  /** The feature's ID; the design's counter hands one out otherwise. */
  id?: string;
  /** The feature's name; `nextFeatureName` gives "Extrude1" and the like. */
  name?: string;
  /** Timeline position to insert at (the rollback marker by default). */
  index?: number;
}

/** What a parameter may carry besides its name and expression. */
export interface ParameterOptions {
  /** What it measures: `length`, `angle` or `unitless`. Read off the expression otherwise. */
  unit?: Parameter['unit'];
  /** A note beside it in the Parameters dialog. */
  comment?: string;
  /** How the customizer shows it (ADR-0059): its slider's range, step and group. */
  customizer?: Customizer;
  /** The parameter's ID; the design's counter hands one out otherwise. */
  id?: string;
}

export interface DesignOptions {
  /** The document's name. */
  name?: string;
  /** The document's length unit: `mm`, `cm`, `m` or `in`. */
  units?: LengthUnit;
  /** The document's own ID. */
  id?: DocumentId;
  /** The ISO time stamped into `meta.created` and `meta.modified`; the clock otherwise. */
  now?: string;
  /** Written into `meta.appVersion`. */
  appVersion?: string;
  /** Hands out the IDs for everything a call creates; a counter by default (`ids.ts`). */
  ids?: IdFactory;
}

/** What else goes into the `.extrudo` file beside the document. */
export interface FileOptions {
  /** A PNG to show as the project's thumbnail. */
  thumbnail?: Uint8Array;
}

/** A feature, named however the caller has it: an ID or a handle. */
export type FeatureLike = string | FeatureHandle;
/** A parameter, named however the caller has it: a name, an ID or a handle. */
export type ParameterLike = string | ParameterHandle;

/**
 * A design: the document, the commands that change it, and (through the
 * interface at the bottom of this file) one method per feature type.
 */
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: see the interface below.
export class Design {
  /** The document and its undo history, for anything the API doesn't wrap. */
  get state(): DocumentState {
    return this.#store.getState();
  }

  /** The document as it is now (frozen; dispatch a command, never change it). */
  get doc(): ExtrudoDocument {
    return this.state.doc;
  }

  /**
   * What a loaded document said about itself: a newer file format, or keys this
   * version left out (core's `loadNotice`, ADR-0050). Empty for a document this
   * version wrote.
   */
  readonly notices: readonly string[];

  /** The origin planes, axes and the world origin, as references (ADR-0068 §4). */
  readonly origin: OriginRefs = originRefs();

  readonly #store: DocumentStore;
  readonly #ids: IdFactory;

  private constructor(store: DocumentStore, ids: IdFactory, notices: readonly string[]) {
    this.#store = store;
    this.#ids = ids;
    this.notices = notices;
    // One method per registered feature type (`generated/features.ts`).
    Object.assign(this, featureMethods(this));
  }

  /** A new, empty design. `options` names it and pins its ID, its clock and its IDs. */
  static create(options: DesignOptions = {}): Design {
    const ids = options.ids ?? new CounterIds().next;
    const created: NewDocumentOptions = {
      ...newDocumentOptions(options),
      id: options.id ?? (ids('document') as DocumentId),
    };
    return new Design(createDocumentStore(createDocument(created)), ids, []);
  }

  /**
   * An existing design: an `ExtrudoDocument` or the raw JSON of one. It goes
   * through core's `loadDocument`, so it is migrated and validated, and what a
   * newer file carried is in `notices`. Throws `ApiError` for anything that
   * isn't a design, or a design this version can't read.
   */
  static from(source: ExtrudoDocument | unknown, options: DesignOptions = {}): Design {
    const counter = new CounterIds();
    const ids = options.ids ?? counter.next;
    let result: LoadResult;
    try {
      result = loadDocument(source, {
        ...(options.now ? { now: options.now } : {}),
        // Migrations mint IDs; the design's factory keeps them deterministic.
        newId: () => ids('document'),
      });
    } catch (error) {
      throw new ApiError(error instanceof Error ? error.message : String(error));
    }
    // New IDs must not collide with the ones the loaded document already has.
    if (!options.ids) counter.seed(result.doc);
    const notice = loadNotice(result, 'drops');
    return new Design(createDocumentStore(result.doc), ids, notice ? [notice] : []);
  }

  // --------------------------------------------------------------- parameters

  /**
   * A new parameter, and a handle to it. Its name is what expressions use:
   * ``d.extrude({ profiles, distance: `2 * ${wall}` })``.
   */
  parameter(name: string, expression: string, options: ParameterOptions = {}): ParameterHandle {
    const id = (options.id ?? this.#ids('parameter')) as ParameterId;
    const parameter: Parameter = {
      id,
      name,
      expression,
      unit: options.unit ?? inferUnit(expression),
      ...(options.comment ? { comment: options.comment } : {}),
      ...(options.customizer ? { customizer: options.customizer } : {}),
    };
    this.#dispatch(addParameter({ parameter }));
    return new ParameterHandle(this, id);
  }

  /** The handle of a parameter that is already there, by its name or ID. */
  getParameter(parameter: ParameterLike): ParameterHandle {
    return new ParameterHandle(this, this.#parameterOf(parameter).id);
  }

  /** Changes a parameter's expression (and its unit, comment or customizer range). */
  setParameter(
    parameter: ParameterLike,
    expression: string,
    options: Omit<ParameterOptions, 'id'> = {},
  ): ParameterHandle {
    const found = this.#parameterOf(parameter);
    this.#dispatch(
      updateParameter({
        id: found.id,
        changes: {
          expression,
          ...(options.unit ? { unit: options.unit } : {}),
          ...(options.comment !== undefined ? { comment: options.comment } : {}),
          ...(options.customizer ? { customizer: options.customizer } : {}),
        },
      }),
    );
    return new ParameterHandle(this, found.id);
  }

  /** Deletes a parameter. Refused while an expression still names it. */
  removeParameter(parameter: ParameterLike): void {
    this.#dispatch(removeParameter({ id: this.#parameterOf(parameter).id }));
  }

  /**
   * A named set of parameter values to switch between (ADR-0059): `values` gives
   * each parameter the expression it should hold, by name, ID or handle. What
   * the parameters hold now is what the configuration captures (`capturedValues`).
   * Returns the configuration's ID.
   */
  configuration(
    name: string,
    values: Readonly<Record<string, string>>,
    options: { id?: string } = {},
  ): ConfigurationId {
    const id = (options.id ?? this.#ids('configuration')) as ConfigurationId;
    const held: Record<string, string> = {};
    for (const [parameter, expression] of Object.entries(values)) {
      held[this.#parameterOf(parameter).id] = expression;
    }
    this.#dispatch(addConfiguration({ configuration: { id, name, values: held } }));
    return id;
  }

  /**
   * Puts a configuration's values on the parameters, as one undo step (ADR-0059);
   * the app re-solves the sketches whose dimensions read them.
   */
  applyConfiguration(configuration: string | ConfigurationId): void {
    const id =
      typeof configuration === 'string' &&
      this.doc.configurations?.some((c) => c.name === configuration)
        ? (this.doc.configurations.find((c) => c.name === configuration)?.id as ConfigurationId)
        : (configuration as ConfigurationId);
    if (!this.doc.configurations?.some((c) => c.id === id)) {
      throw new ApiError(`There is no configuration "${configuration}".`);
    }
    const changes = configurationChanges(this.doc, id);
    if (changes.length > 0) this.#dispatch(setParameterExpressions({ changes }));
  }

  /** The configurations the document holds, by name and ID. */
  get configurations(): readonly { id: ConfigurationId; name: string }[] {
    return (this.doc.configurations ?? []).map(({ id, name }) => ({ id, name }));
  }

  // ----------------------------------------------------------------- features

  /**
   * The handle of a feature that is already there, by its ID. A sketch comes
   * back as a `SketchHandle`, with the profile references of ADR-0068 §4.
   */
  feature(id: FeatureLike): FeatureHandle {
    const found = this.#featureOf(id);
    return found.type === SKETCH_TYPE
      ? new SketchHandle(this, found.id, found.type)
      : new FeatureHandle(this, found.id, found.type);
  }

  /**
   * A sketch on `plane`, filled by `build` (ADR-0068 §5):
   *
   * ```ts
   * const s = d.sketch(d.origin.xy, (k) => {
   *   const plate = k.rectangle([0, 0], [40, 20]);
   *   k.circle([10, 10], '3 mm');
   *   k.dimension(plate.bottom, '40 mm', { name: 'width' });
   * });
   * d.extrude({ profiles: s.profileAt([1, 1]), distance: '10 mm' });
   * ```
   *
   * The entities, constraints and dimensions come from `@extrudo/sketch/build`,
   * the builders the drawing tools use, and nothing is solved: positions are
   * stored as given. The whole call is one undo step, and a throw inside
   * `build` leaves the design as it was.
   */
  sketch(
    plane: GeomRef,
    build: (builder: SketchBuilder) => void,
    options: SketchOptions = {},
  ): SketchHandle {
    return this.transaction(options.name ? `Create ${options.name}` : 'Create sketch', () => {
      const added = this.add<typeof SKETCH_TYPE>(SKETCH_TYPE, sketchInputs(plane), options);
      const handle = new SketchHandle(this, added.id, SKETCH_TYPE);
      const construction = options.construction === true;
      const builder = new SketchBuilder(handle, emptyAdd(), {
        newId: (kind) =>
          this.#ids(
            kind === 'constraint'
              ? 'constraint'
              : kind === 'dimension'
                ? 'dimension'
                : 'sketchEntity',
          ),
        construction: () => construction,
      });
      // While the call runs, the handle reads what it collects, so a dimension
      // can tell a line from a circle before the sketch is stored.
      handle.collect(() => builder.data);
      try {
        build(builder);
      } finally {
        handle.collect(undefined);
      }
      const dimensions = namedDimensions(builder.data.dimensions, this.doc);
      const { entities, constraints } = builder.data;
      // One `modifySketch`, as the app's tools make their edits: core checks the
      // whole change (references, parameter names) before anything is stored.
      this.#dispatch(
        modifySketch({ feature: handle.id, label: 'Draw', entities, constraints, dimensions }),
      );
      return handle;
    });
  }

  /**
   * Adds a feature of any type by name, which is what every generated
   * `d.<type>()` method calls. The inputs are checked against the feature's own
   * schema first, so a bad call throws `ApiError` and changes nothing.
   */
  add<T extends string>(
    type: T,
    inputs: FeatureInputValue = {},
    options: FeatureOptions = {},
  ): FeatureHandle<T> {
    const definition = documentFeatures().get(type);
    if (!definition) {
      throw new ApiError(`There is no feature type "${type}".`, {
        featureType: type,
        path: 'type',
      });
    }
    const id = (options.id ?? this.#ids('feature')) as FeatureId;
    const feature: Feature = {
      id,
      type,
      name: options.name ?? nextFeatureName(this.doc, definition.label),
      suppressed: false,
      inputs: checkInputs(type, definition, storedInputs(type, inputs)),
    };
    this.#dispatch(insertFeature({ feature, index: options.index }));
    return new FeatureHandle<T>(this, id, type);
  }

  /** Deletes a feature. Refused while another feature refers to it. */
  remove(feature: FeatureLike): void {
    this.#dispatch(removeFeature({ id: this.#featureOf(feature).id }));
  }

  /** Suppresses a feature, or unsuppresses it, which rolls its effect back. */
  suppress(feature: FeatureLike, suppressed = true): void {
    this.#dispatch(setFeatureSuppressed({ id: this.#featureOf(feature).id, suppressed }));
  }

  /** Renames a feature, as F2 does on its timeline chip. */
  rename(feature: FeatureLike, name: string): void {
    this.#dispatch(renameFeature({ id: this.#featureOf(feature).id, name }));
  }

  /**
   * Moves a feature to `index` in the timeline (its position afterwards), under
   * core's rules: refused when it would come before a feature that builds on it,
   * and the rollback marker keeps to the same other features.
   */
  move(feature: FeatureLike, index: number): void {
    this.#dispatch(moveFeature({ id: this.#featureOf(feature).id, index }));
  }

  /**
   * Groups the features from `first` to `last` under one name (ADR-0065): they
   * must be neighbours in the timeline and in no group yet. Returns the new
   * group's ID.
   */
  group(
    first: FeatureLike,
    last: FeatureLike,
    options: { name?: string; collapsed?: boolean } = {},
  ): GroupId {
    const from = this.#indexOf(this.#featureOf(first).id);
    const to = this.#indexOf(this.#featureOf(last).id);
    if (to < from) {
      throw new ApiError('Group a run of features from the first to the last one.');
    }
    const features = this.doc.features.slice(from, to + 1).map((f) => f.id);
    const id = this.#ids('group') as GroupId;
    this.#dispatch(groupFeatures({ id, features, ...options }));
    return id;
  }

  // -------------------------------------------------------------------- other

  /**
   * Runs `body` as one undo step: the commands it dispatches are grouped, and
   * one Ctrl+Z takes them all. A throw rolls the whole thing back.
   */
  transaction<T>(label: string, body: () => T): T {
    const state = this.state;
    state.beginTransaction(label);
    try {
      const result = body();
      state.commitTransaction();
      return result;
    } catch (error) {
      state.cancelTransaction();
      throw error;
    }
  }

  /** A reference of any kind, for what the helpers don't build (ADR-0068 §4). */
  ref = ref;

  /**
   * What is wrong with the document: every feature of an unknown type or with
   * inputs that don't match its schema, as `ApiError`s (ADR-0024's
   * `FeatureRegistry.check`). Empty for a design the API built.
   */
  validate(): ApiError[] {
    return documentFeatures()
      .check(this.doc)
      .map(
        (issue) =>
          new ApiError(`${this.#featureOf(issue.featureId).name}: ${issue.message}`, {
            featureId: issue.featureId,
            featureType: this.#featureOf(issue.featureId).type,
          }),
      );
  }

  /** The document, as `JSON.stringify` would write it. */
  toJSON(): ExtrudoDocument {
    return this.doc;
  }

  /** `.extrudo` bytes for the document (storage's archive writer, ADR-0068 §2). */
  toFile(options: FileOptions = {}): Promise<Uint8Array> {
    return Promise.resolve(writeArchive(this.doc, options.thumbnail));
  }

  // ----------------------------------------------------------------- internal

  /** What a handle reads the document through (ADR-0068 §4). */
  find(id: FeatureId): Feature | undefined {
    return this.doc.features.find((f) => f.id === id);
  }

  #dispatch<P>(command: Command<P>): void {
    try {
      this.state.dispatch(command);
    } catch (error) {
      // A refused command (a delete another feature depends on, a name in use)
      // is a bad call like any other; its message is the one to show.
      if (error instanceof CommandError) throw new ApiError(error.message);
      throw error;
    }
  }

  #featureOf(feature: FeatureLike): Feature {
    const id = typeof feature === 'string' ? feature : feature.id;
    const found = this.doc.features.find((f) => f.id === id);
    if (!found) throw new ApiError(`There is no feature "${id}".`, { featureId: id });
    return found;
  }

  #parameterOf(parameter: ParameterLike): Parameter {
    const wanted = typeof parameter === 'string' ? parameter : parameter.name;
    const found = this.doc.parameters.find((p) => p.id === wanted || p.name === wanted);
    if (!found) throw new ApiError(`There is no parameter "${wanted}".`);
    return found;
  }

  #indexOf(id: FeatureId): number {
    const index = this.doc.features.findIndex((f) => f.id === id);
    if (index < 0) throw new ApiError(`There is no feature "${id}".`, { featureId: id });
    return index;
  }
}

/**
 * The generated feature methods (`generated/features.ts`), which merge into the
 * class above: one method per registered feature type, typed with that type's
 * own inputs.
 */
export interface Design extends FeatureMethods {}

/**
 * New driving dimensions take the next free model parameter names (`d1`, `d2`…),
 * as the app's host gives them when a tool adds one (ADR-0016); a named
 * dimension keeps the name its call gave.
 */
function namedDimensions(
  dimensions: Record<string, SketchDimension>,
  doc: ExtrudoDocument,
): Record<string, SketchDimension> {
  let next = Number(nextModelParameterName(doc).slice(1));
  const named: Record<string, SketchDimension> = {};
  for (const [id, dimension] of Object.entries(dimensions)) {
    named[id] =
      dimension.driven || dimension.paramName !== undefined
        ? dimension
        : { ...dimension, paramName: `d${next++}` };
  }
  return named;
}

/**
 * Checks a call's inputs against the feature's schema before anything is
 * dispatched, and returns what to store (with zod's own normalisation). The
 * first failure becomes an `ApiError` naming the input path.
 */
function checkInputs(
  type: string,
  definition: FeatureDefinition,
  inputs: FeatureInputs,
): FeatureInputs {
  const result = definition.inputsSchema.safeParse(inputs);
  if (result.success) return result.data as FeatureInputs;
  const [first] = result.error.issues;
  const path = issuePath(first ? issueOf(first) : []);
  const because = first?.message ?? 'these inputs are not valid';
  throw new ApiError(
    path ? `${definition.label}: ${path}: ${because}` : `${definition.label}: ${because}`,
    { path: path || undefined, featureType: type },
  );
}

/**
 * The path of zod's first issue. An unrecognized key names itself in `keys`,
 * not in the path, so it is taken from there.
 */
function issueOf(issue: { path: PropertyKey[]; keys?: string[] }): string[] {
  if (issue.path.length > 0) return issue.path.map(String);
  return issue.keys ?? [];
}

/** `profiles[1].kind` from zod's issue path. */
function issuePath(path: readonly string[]): string {
  return path.reduce<string>(
    (text, part) => (/^\d+$/.test(part) ? `${text}[${part}]` : `${text ? `${text}.` : ''}${part}`),
    '',
  );
}

function newDocumentOptions(options: DesignOptions): NewDocumentOptions {
  return {
    ...(options.name ? { name: options.name } : {}),
    ...(options.units ? { units: options.units } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.appVersion ? { appVersion: options.appVersion } : {}),
  };
}
