/**
 * The rule of ADR-0144 S10, as the walk adds each feature: **an expression
 * comes in only when Extrudo's own evaluation of what the importer wrote
 * gives the value the file stores for that property.** For every sketch
 * dimension, feature input and plane offset a feature brings in, the file's
 * expression is translated (`fc-emit.ts`), written into the design inside the
 * feature's transaction, the design's parameters are evaluated by
 * `@extrudo/core`, and each value is compared with the stored one; what fails,
 * for any reason, goes back to the stored number with its reason. The
 * feature's check against its stored shape then runs on the design with the
 * expressions in it. A feature that doesn't hold takes its bindings with it.
 *
 * Model values an expression reads (a constraint, `Pad.Length`) become names
 * here: a driving dimension has one already, an input someone reads gets the
 * import's next `dN`.
 */
import type { Design } from '@extrudo/api';
import {
  type DimensionId,
  evaluateParameters,
  type FeatureId,
  type FeatureInputs,
  updateFeatureInputs,
  updateSketchDimension,
} from '@extrudo/core';
import {
  ANGLE,
  type EmitTarget,
  type ExDim,
  type ExpressionReason,
  emitExtrudo,
  LENGTH,
  NONE,
  type Resolver,
} from './fc-emit';
import type { FcDim, FcNode } from './fc-expr';
import type { DecodedFeature } from './features';
import type { FcObject } from './model';
import {
  type Entry,
  modelRead,
  type PreparedParameters,
  pairKey,
  propertyDim,
  storedValue,
} from './params';
import type { DimensionTransform } from './sketch-map';
import type { AddSketchResult } from './sketches';

/** The rule's tolerance: relative, with a floor of 1e-9 mm or degrees for values below 1. */
export const BIND_TOLERANCE = 1e-9;
/** The most rounds of the rule over one feature's bindings (each round takes at least one out). */
export const MAX_BIND_ROUNDS = 64;

export const within = (got: number, want: number) =>
  Math.abs(got - want) <= BIND_TOLERANCE * Math.max(1, Math.abs(want));

/** A model value an expression can read: a parameter name and how its value is FreeCAD's. */
interface ModelValue {
  readonly name: string;
  readonly transform: DimensionTransform;
  readonly fc: FcDim;
  readonly ex: ExDim;
}

type Holder =
  | { readonly kind: 'dimension'; readonly feature: FeatureId; readonly id: DimensionId }
  | { readonly kind: 'input'; readonly feature: FeatureId; readonly input: string };

interface Candidate {
  readonly entry: Entry;
  readonly holder: Holder;
  readonly transform: DimensionTransform;
  readonly target: EmitTarget;
  readonly expected: number;
  readonly count: boolean;
  /** The literal the importer wrote, to go back to. */
  readonly literal: string;
  /** A sketch's own offset plane, no longer shared once it follows an expression. */
  release?: string;
  text?: string;
}

const dims = (k: string | undefined): ExDim =>
  k === 'angle' ? ANGLE : k === 'unitless' ? NONE : LENGTH;
const fcOf = (d: ExDim): FcDim => ({ length: d.length, angle: d.angle });

/** The design's naming hooks for `addSketch`, set while a binder walks it. */
const naming = new WeakMap<
  Design,
  { names: (sketch: string) => ReadonlyMap<number, string> | undefined; freeName: () => string }
>();
export function namingFor(design: Design) {
  return naming.get(design);
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const applyTransform = (text: string, t: DimensionTransform) => {
  if (t === 'same') return text;
  if (t === 'half') return `(${text}) / 2`;
  // `-name` → `name`, `name` → `-name`: a name or its negation needs no brackets.
  if (text.startsWith('-') && NAME.test(text.slice(1))) return text.slice(1);
  return NAME.test(text) ? `-${text}` : `-(${text})`;
};
const transformValue = (v: number, t: DimensionTransform) =>
  t === 'same' ? v : t === 'neg' ? -v : v / 2;

/** Binds the expressions of what the walk adds, feature by feature. */
export class Binder {
  readonly #design: Design;
  readonly #p: PreparedParameters;
  /** Model values that came in: by (object, constraint index) and (object, property). */
  readonly #values = new Map<string, ModelValue>();
  #pending = new Map<string, ModelValue>();
  #pendingOutcomes: [Entry, NonNullable<Entry['outcome']>][] = [];
  #before = new Set<string>();
  readonly #released: ((planeFeature: string) => void) | undefined;
  /** Rounds of the rule over the whole import (held tries only). */
  rounds = 0;
  /** What a try that doesn't hold restores. */
  #snapshot:
    | { names: ReturnType<PreparedParameters['names']['snapshot']>; rounds: number }
    | undefined;

  constructor(
    design: Design,
    prepared: PreparedParameters,
    release?: (planeFeature: string) => void,
  ) {
    this.#design = design;
    this.#p = prepared;
    this.#released = release;
    naming.set(design, {
      names: (sketch) => prepared.constraintNames.get(sketch),
      freeName: () => prepared.names.auto(),
    });
  }

  /** A feature's try begins: what it adds from here is fresh. */
  begin(): void {
    // A try neither committed nor discarded (the walk went on to another) gives its names back now.
    this.discard();
    this.#snapshot = { names: this.#p.names.snapshot(), rounds: this.rounds };
    this.#pending = new Map();
    this.#pendingOutcomes = [];
    this.#before = new Set(this.#design.doc.features.map((f) => f.id));
  }

  /** The try held: its bindings and model values stay. */
  commit(): void {
    for (const [k, v] of this.#pending) this.#values.set(k, v);
    for (const [e, o] of this.#pendingOutcomes) e.outcome = o;
    this.#pending = new Map();
    this.#pendingOutcomes = [];
    this.#snapshot = undefined;
  }

  /**
   * The try didn't hold (its transaction was cancelled): the names it took
   * (`dN`s for its sketch and for inputs others read) and its rounds of the
   * rule are given back, so a later try names what it adds as the first would.
   */
  discard(): void {
    if (!this.#snapshot) return;
    this.#p.names.restore(this.#snapshot.names);
    this.rounds = this.#snapshot.rounds;
    this.#snapshot = undefined;
    this.#pending = new Map();
    this.#pendingOutcomes = [];
  }

  /** Every entry's outcome: what didn't get one in a held feature didn't come in. */
  finish(): void {
    this.discard();
    naming.delete(this.#design);
    for (const e of this.#p.entries)
      e.outcome ??= e.failure
        ? { outcome: e.failure.reason, detail: e.failure.detail }
        : e.target === 'other'
          ? {
              outcome: 'target',
              detail: `${e.path} is not something Extrudo takes as an expression`,
            }
          : { outcome: 'unmapped', detail: 'what it sets didn’t come in' };
  }

  #value(key: string): ModelValue | undefined {
    return this.#pending.get(key) ?? this.#values.get(key);
  }

  /** Reads a path for an expression owned by `owner`. */
  #resolver(owner: FcObject): Resolver {
    return (path: Extract<FcNode, { kind: 'path' }>) => {
      const s = this.#p.sourceOf(owner, path);
      if (s) {
        if (s.name === undefined || s.out || !s.fc || !s.kindOf || s.expression === undefined)
          return { reason: 'reference', detail: 'it reads a cell or variable that didn’t come in' };
        return { text: s.name, fc: s.fc, ex: dims(s.kindOf) };
      }
      const m = modelRead(owner, path, this.#p.objects);
      if (!m)
        return {
          reason: 'reference',
          detail: 'it reads a value that doesn’t come in as a parameter',
        };
      const key =
        m.kind === 'constraint' ? pairKey(m.object.name, m.at) : pairKey(m.object.name, m.property);
      const v = this.#value(key);
      if (!v)
        return {
          reason: 'reference',
          detail: `it reads a value of ${m.object.name} that isn’t a parameter in Extrudo`,
        };
      const text =
        v.transform === 'same'
          ? v.name
          : v.transform === 'neg'
            ? `(-${v.name})`
            : `(${v.name} * 2)`;
      return { text, fc: v.fc, ex: v.ex };
    };
  }

  /**
   * Binds what a feature's try added: its new sketch's dimensions, its own
   * inputs, the plane its sketch is on and a datum plane it made. Runs inside
   * the try's transaction, before the rebuild.
   */
  bind(
    f: FcObject,
    feature: DecodedFeature,
    added: {
      feature: string;
      newSketch?: Extract<AddSketchResult, { imported: true }>;
    },
    sketchObject?: FcObject,
    datums: readonly { object: FcObject; how: string; features: readonly string[] }[] = [],
  ): void {
    const candidates: Candidate[] = [];
    const doc = () => this.#design.doc;
    const findFeature = (id: string) => doc().features.find((x) => x.id === id);
    const outcome = (e: Entry, o: NonNullable<Entry['outcome']>): void => {
      this.#pendingOutcomes.push([e, o]);
    };
    const entriesOf = (o: FcObject) => this.#p.byOwner.get(o.name) ?? [];

    // The new sketch: every driving dimension is a model value; bound ones are candidates.
    const sk = added.newSketch;
    if (sk && sketchObject) {
      const data = findFeature(sk.id)?.inputs;
      const sketchData = data
        ? Object.values(data).find((v) => (v as { kind?: string }).kind === 'sketchData')
        : undefined;
      const dimensions =
        (
          sketchData as
            | {
                sketch?: {
                  dimensions?: Record<
                    string,
                    { expr: string; paramName?: string; driven?: boolean; type?: string }
                  >;
                };
              }
            | undefined
        )?.sketch?.dimensions ?? {};
      sk.dimensions.forEach((id, index) => {
        if (id === undefined) return;
        const d = Object.hasOwn(dimensions, id) ? dimensions[id] : undefined;
        const t = sk.transforms[index];
        if (!d || d.driven || d.paramName === undefined || t === undefined) return;
        const ex = d.type === 'angle' ? ANGLE : LENGTH;
        this.#pending.set(pairKey(sketchObject.name, index), {
          name: d.paramName,
          transform: t,
          fc: fcOf(ex),
          ex,
        });
      });
      for (const e of entriesOf(sketchObject)) {
        if (e.target !== 'dimension' || e.index === undefined) continue;
        const id = sk.dimensions[e.index];
        const t = sk.transforms[e.index];
        const d = id !== undefined && Object.hasOwn(dimensions, id) ? dimensions[id] : undefined;
        if (!d || id === undefined) {
          outcome(e, {
            outcome: 'unmapped',
            detail: 'its constraint didn’t come in as a dimension',
          });
          continue;
        }
        if (d.driven) {
          outcome(e, {
            outcome: 'unmapped',
            detail: 'its constraint came in as a reference dimension',
          });
          continue;
        }
        // From here the dimension is in the design, holding the file's number.
        if (e.failure) {
          outcome(e, { outcome: e.failure.reason, detail: e.failure.detail, number: true });
          continue;
        }
        if (t === undefined) {
          outcome(e, {
            outcome: 'target',
            detail: 'its constraint came in as another value than it stores',
            number: true,
          });
          continue;
        }
        const stored = storedValue(e);
        if (stored === undefined) {
          outcome(e, {
            outcome: 'target',
            detail: 'its constraint stores no number',
            number: true,
          });
          continue;
        }
        const ex = d.type === 'angle' ? ANGLE : LENGTH;
        candidates.push({
          entry: e,
          holder: { kind: 'dimension', feature: sk.id as FeatureId, id: id as DimensionId },
          transform: t,
          target: { mode: 'constraint', dim: ex },
          expected: transformValue(stored, t),
          count: false,
          literal: d.expr,
        });
      }
      this.#plane(sketchObject, sk, candidates, outcome);
    }

    // The feature's own inputs, through its sources.
    const fe = findFeature(added.feature);
    const sources = 'sources' in feature ? feature.sources : {};
    const bySource = new Map<string, string>();
    for (const [input, property] of Object.entries(sources)) {
      if (input.includes('.')) continue;
      const name =
        feature.kind === 'hole' && input === 'cutDiameter'
          ? fe && Object.hasOwn(fe.inputs, 'cbDiameter')
            ? 'cbDiameter'
            : 'csDiameter'
          : feature.kind === 'hole' && input === 'cutDepth'
            ? 'cbDepth'
            : feature.kind === 'hole' && input === 'cutAngle'
              ? 'csAngle'
              : input;
      bySource.set(property, name);
    }
    if (fe) {
      for (const [property, input] of bySource) {
        const value = Object.hasOwn(fe.inputs, input)
          ? (fe.inputs as FeatureInputs)[input]
          : undefined;
        if (value?.kind !== 'expr') continue;
        const t = this.#writtenAs(f, property, value.expr, feature, fe.inputs as FeatureInputs);
        if (!t || t === 'zero') continue;
        const key = pairKey(f.name, property);
        const ex = dims(value.unit);
        if (this.#p.readInputs.has(key)) {
          const name = value.paramName ?? this.#p.names.auto();
          if (value.paramName === undefined)
            this.#design.state.dispatch(
              updateFeatureInputs({
                id: fe.id,
                inputs: { [input]: { ...value, paramName: name } },
              }),
            );
          const d = propertyDim(f.properties[property], f.type);
          this.#pending.set(key, { name, transform: t, fc: d?.dim ?? fcOf(ex), ex });
        }
      }
    }
    for (const e of entriesOf(f)) {
      if (e.target !== 'input') continue;
      const property = e.property as string;
      const input = bySource.get(property);
      const value =
        fe && input && Object.hasOwn(fe.inputs, input)
          ? (fe.inputs as FeatureInputs)[input]
          : undefined;
      if (!fe || !input || value?.kind !== 'expr') {
        outcome(e, {
          outcome: 'target',
          detail: input
            ? `${property} isn't an expression in Extrudo`
            : `${property} isn't taken as an expression`,
        });
        continue;
      }
      // From here the input is in the design, holding the file's number.
      if (e.failure) {
        outcome(e, { outcome: e.failure.reason, detail: e.failure.detail, number: true });
        continue;
      }
      const t = this.#writtenAs(f, property, value.expr, feature, fe.inputs as FeatureInputs);
      const stored = storedValue(e);
      if (t === 'zero') {
        outcome(e, { outcome: 'target', detail: ZERO, number: true });
        continue;
      }
      if (!t || stored === undefined) {
        outcome(e, {
          outcome: 'target',
          detail: `${property} came in as another value than the file stores`,
          number: true,
        });
        continue;
      }
      const d = propertyDim(f.properties[property], f.type);
      const count = d?.count === true;
      candidates.push({
        entry: e,
        holder: { kind: 'input', feature: fe.id, input },
        transform: t,
        target: count ? { mode: 'count' } : { mode: 'quantity', dim: dims(value.unit) },
        expected: transformValue(stored, t),
        count,
        literal: value.expr,
      });
    }

    // A datum plane the try made, kept as an offset plane of an origin plane (S9).
    for (const d of datums) {
      const id = d.features[0];
      if (d.how !== 'offset' || !id || this.#before.has(id)) continue;
      this.#offset(d.object, id, candidates, outcome, 'its datum plane');
    }

    this.#rule(candidates, outcome);
  }

  /** An offset plane's distance bound to `owner`'s `AttachmentOffset.Base.z`, when its offset only moves it along its normal. */
  #offset(
    owner: FcObject,
    planeFeature: string,
    candidates: Candidate[],
    outcome: (e: Entry, o: NonNullable<Entry['outcome']>) => void,
    what: string,
  ): void {
    const entries = (this.#p.byOwner.get(owner.name) ?? []).filter((e) => e.target === 'plane');
    const e = entries[0];
    if (!e) return;
    const why = (detail: string, number?: true) =>
      outcome(e, { outcome: 'target', detail, ...(number ? { number } : {}) });
    const plane = this.#design.doc.features.find((x) => x.id === planeFeature);
    const distance = plane ? (plane.inputs as FeatureInputs).distance : undefined;
    const stored = storedValue(e);
    if (!plane || distance?.kind !== 'expr' || stored === undefined) {
      why(`${what} has no distance`);
      return;
    }
    // From here the plane's distance is in the design, holding the file's number.
    for (const extra of entries.slice(1))
      outcome(extra, {
        outcome: 'target',
        detail: 'a second expression on the same offset',
        number: true,
      });
    if (e.failure) {
      outcome(e, { outcome: e.failure.reason, detail: e.failure.detail, number: true });
      return;
    }
    const offset = owner.properties.AttachmentOffset?.value;
    const r = offset?.kind === 'placement' ? offset.value.rotation : undefined;
    if (!r || Math.abs(r[0]) > 1e-12 || Math.abs(r[1]) > 1e-12 || Math.abs(r[2]) > 1e-12) {
      why(`${what}'s offset turns it`, true);
      return;
    }
    const t = sameOrNeg(literalValue(distance.expr), stored);
    if (t === 'zero') {
      why(ZERO, true);
      return;
    }
    if (!t) {
      why(`${what}'s distance is not its offset`, true);
      return;
    }
    candidates.push({
      entry: e,
      holder: { kind: 'input', feature: plane.id as FeatureId, input: 'distance' },
      transform: t,
      target: { mode: 'quantity', dim: LENGTH },
      expected: transformValue(stored, t),
      count: false,
      literal: distance.expr,
    });
  }

  /**
   * The plane a new sketch sits on, when the sketch's `AttachmentOffset.Base.z`
   * is that plane's distance: an offset plane of an origin plane made for this
   * sketch alone, the sketch attached to that origin plane with an offset that
   * only moves it along its normal, in a container that doesn't move it.
   */
  #plane(
    sketch: FcObject,
    sk: Extract<AddSketchResult, { imported: true }>,
    candidates: Candidate[],
    outcome: (e: Entry, o: NonNullable<Entry['outcome']>) => void,
  ): void {
    const e = (this.#p.byOwner.get(sketch.name) ?? []).find((x) => x.target === 'plane');
    if (!e) return;
    const why = (detail: string) => outcome(e, { outcome: 'target', detail });
    const plane =
      sk.plane.kind === 'plane'
        ? this.#design.doc.features.find((x) => x.id === sk.plane.id)
        : undefined;
    if (sk.outcome.plane !== 'offset' || !plane || plane.type !== 'offsetPlane') {
      why('its sketch is not on an offset plane of an origin plane');
      return;
    }
    if (this.#before.has(plane.id)) {
      why('its sketch shares its plane with another sketch');
      return;
    }
    if (sk.outcome.movedContainer) {
      why('its sketch is in a container that moves it');
      return;
    }
    const support = sketch.properties.AttachmentSupport?.value;
    const items = support?.kind === 'linkSubList' ? support.items : [];
    const base =
      items.length === 1 ? this.#p.objects.resolve(items[0]?.object ?? '', false) : undefined;
    if (base?.type !== 'App::Plane') {
      why('its sketch is not attached to an origin plane');
      return;
    }
    const before = candidates.length;
    this.#offset(sketch, plane.id, candidates, outcome, 'its sketch');
    // Kept, the plane is this sketch's own: no later sketch takes it at the same place.
    const c = candidates[before];
    if (c) c.release = plane.id;
  }

  /** How an input holds its property: `same` or `neg`, else not bindable. */
  #writtenAs(
    f: FcObject,
    property: string,
    expr: string,
    feature: DecodedFeature,
    inputs: FeatureInputs,
  ): DimensionTransform | 'zero' | undefined {
    const p = Object.hasOwn(f.properties, property) ? f.properties[property] : undefined;
    if (!p || (p.value.kind !== 'float' && p.value.kind !== 'integer')) return undefined;
    // A polar pattern written as its step where FreeCAD has the whole angle: not the property.
    const measure = (inputs as Record<string, { kind?: string; value?: string }>).measure;
    if (feature.kind === 'polar' && property === 'Angle' && measure?.value === 'step')
      return undefined;
    return sameOrNeg(literalValue(expr), p.value.value);
  }

  /** Writes the candidates, evaluates the design, keeps what holds; the rest go back to their numbers. */
  #rule(
    candidates: Candidate[],
    outcome: (e: Entry, o: NonNullable<Entry['outcome']>) => void,
  ): void {
    const live: Candidate[] = [];
    for (const c of candidates) {
      const node = c.entry.node as FcNode;
      const r = emitExtrudo(node, this.#resolver(c.entry.owner), c.target);
      if (!r.ok) {
        outcome(c.entry, { outcome: r.reason, detail: r.detail, number: true });
        continue;
      }
      c.text = applyTransform(r.text, c.transform);
      live.push(c);
    }
    const write = (c: Candidate, expr: string) => {
      const doc = this.#design.doc;
      const f = doc.features.find((x) => x.id === c.holder.feature);
      if (!f) return;
      if (c.holder.kind === 'dimension')
        this.#design.state.dispatch(
          updateSketchDimension({ feature: f.id, id: c.holder.id, changes: { expr } }),
        );
      else {
        const v = (f.inputs as FeatureInputs)[c.holder.input];
        if (v?.kind === 'expr')
          this.#design.state.dispatch(
            updateFeatureInputs({ id: f.id, inputs: { [c.holder.input]: { ...v, expr } } }),
          );
      }
    };
    for (const c of live) write(c, c.text as string);
    let round = 0;
    while (live.length > 0) {
      this.rounds++;
      const evaluation = evaluateParameters(this.#design.doc);
      const failed: [Candidate, ExpressionReason, string][] = [];
      for (const c of live) {
        const r =
          c.holder.kind === 'dimension'
            ? evaluation.dimensions.get(c.holder.feature)?.get(c.holder.id)
            : evaluation.inputs.get(c.holder.feature)?.get(c.holder.input);
        if (!r) failed.push([c, 'differs', 'Extrudo has no value for it']);
        else if (!r.ok) failed.push([c, coreReason(r.error), r.error.message]);
        else if (
          c.count
            ? !(Number.isInteger(r.value) && r.value === c.expected)
            : !within(r.value, c.expected)
        )
          failed.push([
            c,
            'differs',
            `Extrudo computes ${Number(r.value.toPrecision(12))}, the file stores ${Number(c.expected.toPrecision(12))}`,
          ]);
      }
      if (failed.length === 0) break;
      // An error that comes from another failing one may clear once that one is a number again.
      const own = failed.filter(([, , detail]) => !CORE_DEPENDENT.test(detail));
      const out = own.length > 0 ? own : failed;
      for (const [c, reason, detail] of out) {
        write(c, c.literal);
        live.splice(live.indexOf(c), 1);
        outcome(c.entry, { outcome: reason, detail, number: true });
      }
      if (++round >= MAX_BIND_ROUNDS) {
        for (const c of live) {
          write(c, c.literal);
          outcome(c.entry, {
            outcome: 'limit',
            detail: 'past the rounds of the rule a feature takes',
            number: true,
          });
        }
        live.length = 0;
      }
    }
    for (const c of live) {
      outcome(c.entry, { outcome: 'kept', text: c.text as string });
      if (c.release) this.#released?.(c.release);
    }
  }
}

/**
 * Core's errors this module tells apart. `ExprError.code` has `cycle` (and
 * `unknown-name`); its other errors are told by their words, pinned by
 * `bind.test.ts` so a change of wording in core fails a test here.
 */
export const CORE_DEPENDENT = /^Uses `/;
export const CORE_TOO_DEEP = /^Nested more than \d+ levels deep/;

/** The reason for an error core gives for an expression. */
export function coreReason(error: {
  code?: string | undefined;
  message: string;
}): ExpressionReason {
  if (error.code === 'cycle') return 'cycle';
  if (CORE_TOO_DEEP.test(error.message)) return 'limit';
  return 'differs';
}

/** Why an input read off its numbers with a stored 0 is not bound. */
export const ZERO = "its value is 0 in the file, so its sense can't be told";

/** A literal the importer wrote (`10 mm`, `-3 deg`, `4`) as its number. */
function literalValue(expr: string): number {
  const m = /^\s*(-?[0-9.]+(?:e-?[0-9]+)?)\s*(mm|deg)?\s*$/.exec(expr);
  return m ? Number(m[1]) : Number.NaN;
}

export function sameOrNeg(
  written: number,
  stored: number,
): DimensionTransform | 'zero' | undefined {
  if (!Number.isFinite(written) || !Number.isFinite(stored)) return undefined;
  // 0 fits both senses: read off the numbers alone, the sense can't be told.
  if (within(stored, 0)) return 'zero';
  if (within(written, stored)) return 'same';
  if (stored !== 0 && within(written, -stored)) return 'neg';
  return undefined;
}
