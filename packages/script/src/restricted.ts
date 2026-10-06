/**
 * The `Design` a script gets (ADR-0070 §1): one that may only **add**.
 *
 * Every method of the API's generated feature methods is an add — a hole cuts, a
 * pattern copies, `removeBodies` and `moveBodies` add the Remove and Move
 * features that do the work — so they are all allowed. What a script may not do
 * is change the document it was given: removing, moving, renaming or
 * suppressing a feature, adding or changing a parameter, grouping, or writing a
 * file. Those calls are refused by name, with the rule in the message, so the
 * script's own error reads as a sentence about scripts.
 */
import {
  ApiError,
  type Design,
  FEATURE_METHOD_DESCRIPTIONS,
  type FeatureHandle,
  type FeatureId,
  type FeatureInputValue,
  type FeatureLike,
  type FeatureOptions,
  featureMethods,
  type GeomFingerprint,
  type GeomRefKind,
  type OriginRefs,
  type ParameterLike,
  ref,
} from '@extrudo/api';
import { SCRIPT_TYPE } from '@extrudo/core';
import { featureCountMessage, ScriptError } from './limits';

/**
 * What every refusal says, so the rule is the same wherever it is hit:
 * "A script can only add features: `design.remove()` would delete a feature."
 */
export const REFUSAL_RULE = 'A script can only add features';

/**
 * Why each method of `Design` a script cannot call is refused. Every one of
 * them is in `SCRIPT_METHODS` as well, so a script is told the rule instead of
 * finding `undefined` (and the editor's autocompletion can leave them out).
 */
export const REFUSED_METHODS: Readonly<Record<string, string>> = {
  remove: 'would delete a feature',
  removeParameter: 'would delete a parameter',
  move: 'would move a feature',
  rename: 'would rename a feature',
  suppress: 'would suppress a feature',
  group: 'would group the features that are there',
  parameter: 'would add a parameter',
  setParameter: 'would change a parameter',
  configuration: 'would add a configuration',
  applyConfiguration: 'would change parameters',
  transaction: 'needs a function a script cannot pass',
  toFile: 'would write a file',
};

/** What `design.script(…)` or `design.add('script', …)` inside a script says. */
export const SCRIPT_IN_SCRIPT = "A script can't add a script.";

/** The names of the API's own generated feature methods (ADR-0068 §3). */
const GENERATED: readonly string[] = Object.keys(
  featureMethods({ add: () => undefined as unknown as FeatureHandle }),
);

/**
 * The names `design` has in the sandbox: every allowed name and every refused
 * one, sorted. `sketch` is here too, but the bridge calls it itself, because its
 * build callback is a function inside QuickJS.
 */
export const SCRIPT_METHODS: readonly string[] = [
  ...GENERATED,
  'add',
  'feature',
  'features',
  'getParameter',
  'origin',
  'ref',
  'sketch',
  'toJSON',
  'validate',
  ...Object.keys(REFUSED_METHODS),
].sort();

/** The editor and sandbox share this list; refused calls and nested scripts stay out. */
export const ALLOWED_SCRIPT_METHODS = SCRIPT_METHODS.filter(
  (name) => !(name in REFUSED_METHODS) && name !== SCRIPT_TYPE,
);

/** Generated API descriptions, carried beside the allowed names for completion. */
export const SCRIPT_METHOD_DESCRIPTIONS = FEATURE_METHOD_DESCRIPTIONS;

/** One feature of the document, as a script may read it: its ID, name and type. */
export interface FeatureSummary {
  id: FeatureId;
  name: string;
  type: string;
}

/**
 * The design a script adds to, wrapped so that everything else is refused.
 *
 * The bridge (`bridge.ts`) builds QuickJS objects from `SCRIPT_METHODS` and calls
 * `call`; the kernel evaluator (slice 2) reads `added` and the features
 * themselves. One `add` counts, so the limit is the same whatever call made the
 * feature.
 */
export class ScriptDesign {
  /** The origin planes, axes and point as references, as on `Design`. */
  readonly origin: OriginRefs;

  readonly #design: Design;
  readonly #limit: number;
  readonly #added: FeatureId[] = [];
  readonly #calls: Map<string, (...args: unknown[]) => unknown>;

  constructor(design: Design, featureLimit: number) {
    this.#design = design;
    this.#limit = featureLimit;
    this.origin = design.origin;
    // The generated methods are the API's own, bound to this wrapper's `add`
    // (ADR-0068 §3), so a script's call is checked and counted like `add` is.
    const generated = featureMethods(this) as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >;
    this.#calls = new Map<string, (...args: unknown[]) => unknown>([
      ['add', (type, inputs, options) => this.#adding('add', type, inputs, options)],
      ['feature', (id) => this.#design.feature(id as FeatureLike)],
      [
        'features',
        () =>
          this.#design.doc.features.map(
            ({ id, name, type }): FeatureSummary => ({ id, name, type }),
          ),
      ],
      ['getParameter', (parameter) => this.#design.getParameter(parameter as ParameterLike)],
      ['origin', () => this.origin],
      [
        'ref',
        (kind, id, fingerprint) =>
          ref(kind as GeomRefKind, String(id), fingerprint as GeomFingerprint),
      ],
      ['toJSON', () => this.#design.toJSON()],
      ['validate', () => this.#design.validate().map((issue) => issue.message)],
      ...Object.entries(generated),
      // Everything else the API has is refused by name.
      ...Object.entries(REFUSED_METHODS).map(
        ([name, reason]) => [name, () => refused(name, reason)] as [string, () => never],
      ),
    ]);
  }

  /** The features this script added, in the order it made them. */
  get added(): readonly FeatureId[] {
    return this.#added;
  }

  /**
   * Calls one of `SCRIPT_METHODS` (`sketch` excepted, which the bridge calls
   * itself). Throws `ScriptError` for a name that isn't one.
   */
  call(name: string, args: readonly unknown[]): unknown {
    const method = this.#calls.get(name);
    if (!method) throw new ScriptError(`design.${name} is not a method of the API.`);
    return method(...args);
  }

  /**
   * A sketch, built by a callback the bridge runs inside QuickJS: the sketch goes
   * into the document like any other feature, and what the callback drew is one
   * undo step of it.
   */
  sketch(plane: unknown, build: (builder: unknown) => void, options?: unknown): FeatureHandle {
    return this.#adding('sketch', plane, build, options);
  }

  /** What every generated method and `add` come down to (ADR-0068 §3). */
  add(type: string, inputs: FeatureInputValue = {}, options: FeatureOptions = {}): FeatureHandle {
    return this.#adding('add', type, inputs, options);
  }

  /**
   * Makes one feature (or a sketch, which is one feature), and counts it. The
   * count is checked before anything is dispatched, so the design a script that
   * runs out of features leaves behind holds exactly the limit.
   */
  #adding(
    method: 'add' | 'sketch',
    first: unknown,
    second: unknown,
    third: unknown,
  ): FeatureHandle {
    // A script's features are evaluated in its place; one it made could only
    // run another script there, which nothing could store or edit.
    if (method === 'add' && String(first) === SCRIPT_TYPE) {
      throw new ApiError(SCRIPT_IN_SCRIPT);
    }
    if (this.#added.length >= this.#limit) {
      throw new ScriptError(featureCountMessage(this.#limit));
    }
    const before = this.#design.doc.features.length;
    const made =
      method === 'add'
        ? this.#design.add(String(first), second as FeatureInputValue, third as FeatureOptions)
        : this.#design.sketch(
            first as Parameters<Design['sketch']>[0],
            second as Parameters<Design['sketch']>[1],
            third as Parameters<Design['sketch']>[2],
          );
    for (const feature of this.#design.doc.features.slice(before)) {
      this.#added.push(feature.id);
    }
    return made;
  }
}

/** The message a refused call throws: the rule, then what it would have done. */
function refused(name: string, reason: string): never {
  throw new ApiError(`${REFUSAL_RULE}: design.${name}() ${reason}.`);
}
