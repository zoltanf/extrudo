/**
 * PartDesign features that are in no body, as plain data (ADR-0144 S12a). FreeCAD had no bodies
 * before 0.17: a part is a row of features, each with its own stored shape, where a feature finds
 * what it builds on through a link. A **loose feature** is a PartDesign feature in no body; a
 * **loose chain** is a tip and the loose features reached from it by following each one's base,
 * root first. A feature that is the base of several others belongs to several chains: each walks
 * its own copy.
 *
 * A feature's base is, in this order: its `BaseFeature`; a dress-up's `Base`; a pattern's first
 * original; the object its sketch is attached to, when that holds a solid. The base as read is
 * never trusted: the walk checks every feature against the shape the file stores for it.
 *
 * No kernel, no recursion on the file's depth. Every chain is followed once and the whole plan is
 * bounded by `maxFile` features and `maxChains` chains, so a file of many tips on one long row
 * costs the caps, not the square of the row.
 */
import { type FinalShape, linkedObjects } from './final-shapes';
import { brepHasSolid, type FcDocument, type FcObject, storedShapeEntry } from './model';
import { cleanName } from './names';

/** The most loose chains one import brings in with their history (the library has 31). */
export const MAX_LOOSE_CHAINS = 256;

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
  readonly refused?: { readonly reason: 'chain' | 'limit'; readonly detail: string };
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
  readonly conflict: boolean;
}

/** The sketch a sketch-based feature names (`Profile`, or `Sketch` before 0.17). */
function sketchOf(doc: FcDocument, o: FcObject): FcObject | undefined {
  const v = o.properties.Profile?.value ?? o.properties.Sketch?.value;
  const name = v?.kind === 'linkSub' || v?.kind === 'link' ? v.object : undefined;
  const sketch = name ? doc.byName.get(name) : undefined;
  return sketch?.type.startsWith('Sketcher::SketchObject') ? sketch : undefined;
}

/** The first object a sketch is attached to, in either grammar. */
function supportOf(sketch: FcObject): string | undefined {
  const v = sketch.properties.AttachmentSupport?.value ?? sketch.properties.Support?.value;
  return v ? linkedObjects(v)[0] || undefined : undefined;
}

/** What is read once per file, however many chains ask: who is loose and what each feature builds on. */
export interface LoosePlanner {
  /** Whether `o` is a PartDesign feature in no body. */
  readonly isLoose: (o: FcObject) => boolean;
  /**
   * The chain ending at `tip`. `used` counts the features planned so far across the calls that
   * share it: past `limits.maxFile` a chain is refused without being followed.
   */
  readonly chain: (tip: FcObject, limits: LooseChainLimits, used: { features: number }) => LooseChain;
}

/** The planner of one file: each feature's base is read once, however many chains pass through it. */
export function loosePlanner(doc: FcDocument): LoosePlanner {
  const members = bodyMembers(doc);
  const isLoose = (o: FcObject) =>
    o.type.startsWith('PartDesign::') &&
    !NOT_LOOSE.has(o.type.slice('PartDesign::'.length)) &&
    !BINDER.test(o.type) &&
    !members.has(o.name);

  const solids = new Map<string, boolean>();
  /** Whether `o` stores a solid: read once per object, the reader's problems left alone. */
  const holdsSolid = (o: FcObject): boolean => {
    const known = solids.get(o.name);
    if (known !== undefined) return known;
    let result = false;
    const before = doc.problems.length;
    try {
      const entry = storedShapeEntry(doc, o);
      const bytes = entry === undefined ? undefined : doc.entries.get(entry);
      if (bytes && bytes.length > 0 && !entry?.endsWith('.bin'))
        result = brepHasSolid(new TextDecoder('latin1').decode(bytes));
    } catch {
      result = false;
    }
    doc.problems.length = before;
    solids.set(o.name, result);
    return result;
  };

  /** A base named outright must be something that can hold a shape. */
  const namedBase = (name: string, what: string, rule: BaseRule, conflict: boolean): BaseRead => {
    const target = doc.byName.get(name);
    if (!target)
      return { rule, conflict, broken: `${what} ${named(name)} isn't in the file` };
    if (NOT_A_SHAPE.some((x) => target.type.startsWith(x)))
      return { rule, conflict, broken: `${what} ${named(name)} is a ${target.type}, not a shape` };
    return { name, rule, conflict };
  };

  const reads = new Map<string, BaseRead>();
  const baseOf = (o: FcObject): BaseRead => {
    const known = reads.get(o.name);
    if (known) return known;
    const read = ((): BaseRead => {
      const sketch = sketchOf(doc, o);
      const supportName = sketch ? supportOf(sketch) : undefined;
      const support = supportName ? doc.byName.get(supportName) : undefined;
      const onSolid =
        support && !NOT_A_SHAPE.some((x) => support.type.startsWith(x)) && holdsSolid(support)
          ? support
          : undefined;
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
      if (originals?.kind === 'linkList' && originals.objects[0] !== undefined)
        return namedBase(originals.objects[0], 'its first original', 'original', false);
      if (onSolid) return { name: onSolid.name, rule: 'support', conflict: false };
      return { rule: 'none', conflict: false };
    })();
    reads.set(o.name, read);
    return read;
  };

  const chain: LoosePlanner['chain'] = (tip, limits, used) => {
    const refuse = (reason: 'chain' | 'limit', detail: string): LooseChain => ({
      tip,
      features: [],
      refused: { reason, detail },
      rules: [],
      conflicts: 0,
    });
    const overFile = `the file's rows have more than ${limits.maxFile} features`;
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
      used.features++;
      seen.add(at.name);
      features.push(at);
      const base = baseOf(at);
      rules.push(base.rule);
      if (base.conflict) conflicts++;
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
  return { isLoose, chain };
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
