/**
 * PartDesign features that are in no body, as plain data (ADR-0144 S12a). FreeCAD had no bodies
 * before 0.17: a part is a row of features, each with its own stored shape, where a feature finds
 * what it builds on through a link. A **loose feature** is a PartDesign feature in no body; a
 * **loose chain** is a tip and the loose features reached from it by following each one's base,
 * root first. A feature that is the base of several others belongs to several chains: each walks
 * its own copy.
 *
 * A feature's base is, in this order: its `BaseFeature`; a dress-up's `Base`; of a pattern's
 * originals the one no other of them builds on (the first when they aren't in one row); the object
 * its sketch is attached to, when that holds a solid. The base as read is never trusted: the walk
 * checks every feature against the shape the file stores for it.
 *
 * No kernel, no recursion on the file's depth. What a file can make the plan do is bounded by two
 * budgets of the planner, refused chains counted: `PLAN_VISITS_PER_FEATURE` times `maxFile` features
 * visited and `MAX_ORIGINAL_LINKS` links followed among patterns' originals. Past either a chain
 * comes in as today (`limit`).
 */
import { supportsOf } from './attach';
import { FEATURE_TYPES, MAX_ORIGINALS } from './features';
import { type FinalShape, linkedObjects, storedSolid } from './final-shapes';
import { type FcDocument, type FcObject, storedShapeEntry } from './model';
import { cleanName } from './names';

/** The most loose chains one import plans at its top (the library has 14). */
export const MAX_LOOSE_CHAINS = 256;
/** The most links followed to tell which of one pattern's originals is the last of their row. */
const MAX_ORIGINAL_STEPS = 500;
/** The most such links one file may have followed, every pattern together (the library needs none). */
export const MAX_ORIGINAL_LINKS = 20_000;
/**
 * How many times `maxFile` the planner may visit features, those of chains it refuses included: a
 * refused chain gives back what it counted against `maxFile`, so this is what bounds such rows.
 */
export const PLAN_VISITS_PER_FEATURE = 4;

/** Which rule gave a feature's base; `none` when it starts a new solid. */
export type BaseRule = 'base-feature' | 'dress-up' | 'original' | 'support' | 'none';

export interface LooseChain {
  /** The final shape's feature, last of `features`. */
  readonly tip: FcObject;
  /** Root first, the tip last. Empty when the chain is refused. */
  readonly features: readonly FcObject[];
  /** What the root builds on when that is no loose feature: a Part box, a cut, any stored shape. */
  readonly foreignBase?: FcObject;
  /** Why the chain comes in as today (its tip's stored shape). */
  readonly refused?: { readonly reason: 'chain' | 'limit' | 'type'; readonly detail: string };
  /** How each feature's base was read, in `features`' order. */
  readonly rules: readonly BaseRule[];
  /** How many features name a `BaseFeature` other than the object their sketch is attached to. */
  readonly conflicts: number;
}

export interface LooseChainLimits {
  /** The most features one chain may have (`MAX_BODY_FEATURES`). */
  readonly maxFeatures: number;
  /** The most features the chains of one import may have in all, shared features counted per chain. */
  readonly maxFile: number;
  readonly maxChains?: number;
}

const NOT_LOOSE = new Set(['Body', 'Plane', 'Line', 'Point', 'CoordinateSystem']);
const BINDER = /Binder$/;
/** Object families that hold no shape a feature could build on. */
const NOT_A_SHAPE = ['Sketcher::', 'Spreadsheet::', 'App::', 'TechDraw::', 'Fem::'];

const named = (name: string) => cleanName(name, name);

/** Every object some PartDesign body holds. */
function bodyMembers(doc: FcDocument): Set<string> {
  const members = new Set<string>();
  for (const o of doc.objects) {
    if (o.type !== 'PartDesign::Body') continue;
    for (const key of ['Group', 'Model']) {
      const v = o.properties[key]?.value;
      if (v) for (const m of linkedObjects(v)) members.add(m);
    }
  }
  return members;
}

interface BaseRead {
  readonly name?: string;
  readonly rule: BaseRule;
  readonly broken?: string;
  /** The planner's budget for patterns' originals ran out here. */
  readonly over?: true;
  readonly conflict: boolean;
}

/** The sketch a sketch-based feature names (`Profile`, or `Sketch` before 0.17). */
function sketchOf(doc: FcDocument, o: FcObject): FcObject | undefined {
  const v = o.properties.Profile?.value ?? o.properties.Sketch?.value;
  const name = v?.kind === 'linkSub' || v?.kind === 'link' ? v.object : undefined;
  const sketch = name ? doc.byName.get(name) : undefined;
  return sketch?.type.startsWith('Sketcher::SketchObject') ? sketch : undefined;
}

/** Whether the walk has a mapping for this type at all. */
const walkable = (o: FcObject) => Object.hasOwn(FEATURE_TYPES, o.type);

/** What is read once per file, however many chains ask: who is loose and what each feature builds on. */
export interface LoosePlanner {
  /** Whether `o` is a PartDesign feature in no body. */
  readonly isLoose: (o: FcObject) => boolean;
  /** Whether a loose chain can end at `o`: it is loose, and of a type the walk can rebuild. */
  readonly endsChain: (o: FcObject) => boolean;
  /**
   * The chain ending at `tip`. `used` counts the features planned so far across the calls that
   * share it: past `limits.maxFile` a chain is refused without being followed.
   */
  readonly chain: (
    tip: FcObject,
    limits: LooseChainLimits,
    used: { features: number },
  ) => LooseChain;
}

/** The planner of one file: each feature's base is read once, however many chains pass through it. */
export function loosePlanner(doc: FcDocument): LoosePlanner {
  const members = bodyMembers(doc);
  const isLoose = (o: FcObject) =>
    o.type.startsWith('PartDesign::') &&
    !NOT_LOOSE.has(o.type.slice('PartDesign::'.length)) &&
    !BINDER.test(o.type) &&
    !members.has(o.name);

  /**
   * Whether `o` stores a solid. Each entry is read once, however many objects name it and whether
   * or not it can be read; one past what the import's kernel reads is never inflated.
   */
  const holdsSolid = (o: FcObject): boolean => {
    const entry = storedShapeEntry(doc, o);
    return entry !== undefined && storedSolid(doc, entry) === 'solid';
  };

  /** The first object a sketch is attached to, read once per sketch whatever its list holds. */
  const supports = new Map<string, FcObject | undefined>();
  const supportOf = (sketch: FcObject): FcObject | undefined => {
    if (supports.has(sketch.name)) return supports.get(sketch.name);
    const name = supportsOf(sketch)[0]?.object;
    const support = name ? doc.byName.get(name) : undefined;
    supports.set(sketch.name, support);
    return support;
  };
  /** The solid `o`'s sketch is attached to, if any. */
  const solidSupport = (o: FcObject): FcObject | undefined => {
    const sketch = sketchOf(doc, o);
    const support = sketch ? supportOf(sketch) : undefined;
    return support && !NOT_A_SHAPE.some((x) => support.type.startsWith(x)) && holdsSolid(support)
      ? support
      : undefined;
  };

  /** What `o` links to first, by the rules in order, a pattern by its first original. */
  const nextLink = (o: FcObject): string | undefined => {
    const declared = o.properties.BaseFeature?.value;
    if (declared?.kind === 'link' && declared.object) return declared.object;
    const dressed = o.properties.Base?.value;
    if (dressed?.kind === 'linkSub' && dressed.object) return dressed.object;
    const originals = o.properties.Originals?.value;
    if (originals?.kind === 'linkList' && originals.objects[0] !== undefined)
      return originals.objects[0];
    return solidSupport(o)?.name;
  };

  /**
   * The original no other of the list builds on: the last of them in their row. The first when
   * they aren't in one row, lead back to each other or are too many to follow; `undefined` when the
   * file has used up `MAX_ORIGINAL_LINKS`. Iterative, each object followed once per list.
   */
  let originalLinks = 0;
  const lastOriginal = (list: readonly string[]): string | undefined => {
    const first = list[0] as string;
    if (list.length < 2 || list.length > MAX_ORIGINALS) return first;
    const originals = new Set(list);
    const below = new Set<string>();
    const visited = new Set<string>();
    for (const start of originals)
      for (let at: string | undefined = start; at !== undefined && !visited.has(at); ) {
        visited.add(at);
        if (++originalLinks > MAX_ORIGINAL_LINKS) return undefined;
        if (visited.size > MAX_ORIGINAL_STEPS) return first;
        const o = doc.byName.get(at);
        at = o ? nextLink(o) : undefined;
        if (at !== undefined && originals.has(at)) below.add(at);
      }
    const last = [...originals].filter((name) => !below.has(name));
    return last.length === 1 ? (last[0] as string) : first;
  };

  /** A base named outright must be something that can hold a shape. */
  const namedBase = (name: string, what: string, rule: BaseRule, conflict: boolean): BaseRead => {
    const target = doc.byName.get(name);
    if (!target) return { rule, conflict, broken: `${what} ${named(name)} isn't in the file` };
    if (NOT_A_SHAPE.some((x) => target.type.startsWith(x)))
      return { rule, conflict, broken: `${what} ${named(name)} is a ${target.type}, not a shape` };
    return { name, rule, conflict };
  };

  const reads = new Map<string, BaseRead>();
  const baseOf = (o: FcObject): BaseRead => {
    const known = reads.get(o.name);
    if (known) return known;
    const read = ((): BaseRead => {
      const onSolid = solidSupport(o);
      const declared = o.properties.BaseFeature?.value;
      if (declared?.kind === 'link' && declared.object)
        return namedBase(
          declared.object,
          'its base',
          'base-feature',
          onSolid !== undefined && onSolid.name !== declared.object,
        );
      const dressed = o.properties.Base?.value;
      if (dressed?.kind === 'linkSub' && dressed.object)
        return namedBase(dressed.object, 'its base', 'dress-up', false);
      const originals = o.properties.Originals?.value;
      if (originals?.kind === 'linkList' && originals.objects[0] !== undefined) {
        const last = lastOriginal(originals.objects);
        return last === undefined
          ? { rule: 'original', conflict: false, over: true }
          : namedBase(last, 'its original', 'original', false);
      }
      if (onSolid) return { name: onSolid.name, rule: 'support', conflict: false };
      return { rule: 'none', conflict: false };
    })();
    reads.set(o.name, read);
    return read;
  };

  let visits = 0;
  const chain: LoosePlanner['chain'] = (tip, limits, used) => {
    const counted = used.features;
    /** A chain that doesn't come in leaves what it counted to the chains after it. */
    const refuse = (reason: 'chain' | 'limit' | 'type', detail: string): LooseChain => {
      used.features = counted;
      return { tip, features: [], refused: { reason, detail }, rules: [], conflicts: 0 };
    };
    // Its last feature could never hold: nothing below it is worth walking.
    if (!walkable(tip)) return refuse('type', `it is a ${tip.type || 'object of no type'}`);
    const overFile = `the file's rows have more than ${limits.maxFile} features`;
    const tooMany = "the file's rows take too many links to follow";
    if (used.features >= limits.maxFile) return refuse('limit', overFile);
    const features: FcObject[] = [];
    const rules: BaseRule[] = [];
    const seen = new Set<string>();
    let conflicts = 0;
    let foreignBase: FcObject | undefined;
    for (let at: FcObject | undefined = tip; at; ) {
      if (features.length >= limits.maxFeatures)
        return refuse('limit', `its row has more than ${limits.maxFeatures} features`);
      if (used.features >= limits.maxFile) return refuse('limit', overFile);
      if (++visits > PLAN_VISITS_PER_FEATURE * limits.maxFile) return refuse('limit', tooMany);
      used.features++;
      seen.add(at.name);
      features.push(at);
      const base = baseOf(at);
      rules.push(base.rule);
      if (base.conflict) conflicts++;
      if (base.over) return refuse('limit', tooMany);
      if (base.broken) return refuse('chain', `${named(at.name)}: ${base.broken}`);
      if (base.name === undefined) break;
      if (seen.has(base.name)) return refuse('chain', 'its features lead back to themselves');
      const next = doc.byName.get(base.name) as FcObject;
      if (isLoose(next)) at = next;
      else {
        foreignBase = next;
        break;
      }
    }
    return {
      tip,
      features: features.reverse(),
      ...(foreignBase ? { foreignBase } : {}),
      rules: rules.reverse(),
      conflicts,
    };
  };
  return { isLoose, endsChain: (o) => isLoose(o) && walkable(o), chain };
}

/**
 * The loose chains of the given tips, one per tip, in the tips' order. A tip past a limit, on a
 * broken link or on a cycle gets a chain with `refused`, which comes in as today.
 */
export function looseChains(
  doc: FcDocument,
  tips: readonly FinalShape[],
  limits: LooseChainLimits,
  planner: LoosePlanner = loosePlanner(doc),
): LooseChain[] {
  const maxChains = limits.maxChains ?? MAX_LOOSE_CHAINS;
  const used = { features: 0 };
  return tips.map((shape, i) =>
    i >= maxChains
      ? {
          tip: shape.object,
          features: [],
          refused: {
            reason: 'limit' as const,
            detail: `the file has more than ${maxChains} rows of features`,
          },
          rules: [],
          conflicts: 0,
        }
      : planner.chain(shape.object, limits, used),
  );
}
