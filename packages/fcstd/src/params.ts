/**
 * A FreeCAD file's parameters (ADR-0144 S10): its spreadsheets' cells and its
 * variable sets' properties as Extrudo user parameters, and every expression
 * the file's objects hold, parsed once with its target and what it reads.
 * `prepareParameters` does everything that needs no geometry, before the
 * first sketch or feature: it names the parameters (aliases, then variable-set
 * properties, then named constraints, then the names the importer makes up),
 * infers their kinds, translates the cells' formulas and adds the parameters
 * in one undo step. `bind.ts` then binds each sketch dimension, feature input
 * and plane offset as the walk adds it.
 *
 * Everything here is the file's text: names and labels go through `Map`s and
 * null-prototype records only, every list is capped, every walk is bounded.
 */
import type { Design } from '@extrudo/api';
import {
  type ExtrudoDocument,
  evaluateParameters,
  isReservedName,
  PARAMETER_NAME,
  type Parameter,
  type ParameterId,
  parameterNames,
} from '@extrudo/core';
import {
  ANGLE,
  type ExDim,
  type ExpressionReason,
  emitExtrudo,
  LENGTH,
  NONE,
  type Resolver,
} from './fc-emit';
import {
  cellAddress,
  type FcDim,
  type FcNode,
  FcSyntaxError,
  isFcToken,
  parseFcExpression,
} from './fc-expr';
import type { FcCell, FcDocument, FcObject, FcProperty } from './model';
import { cleanName } from './names';

/** The most user parameters one import adds (measured: `parameter-limits.test.ts`). */
export const MAX_IMPORT_PARAMETERS = 1_000;
/** The most cells read from one sheet. */
export const MAX_SHEET_CELLS = 10_000;
/** The most expressions read from one object (a feature keeps at most `MAX_FEATURE_EXPRESSIONS` of them). */
export const MAX_OBJECT_EXPRESSIONS = 256;
/** The most expressions read from one file. */
export const MAX_IMPORT_EXPRESSIONS = 10_000;
/** The longest parameter name the import writes. */
export const MAX_PARAMETER_NAME = 64;
/** The longest group (the schema's 40). */
export const MAX_GROUP_LENGTH = 40;
/** The longest comment. */
export const MAX_COMMENT_LENGTH = 300;
/** How many `name_1`, `name_2` … one name tries before it gives up. */
export const MAX_RENAME_TRIES = 1_000;

/** The FreeCAD dimension of a value, `undefined` where it can't be known. */
const D0: FcDim = { length: 0, angle: 0 };
const DL: FcDim = { length: 1, angle: 0 };
const DA: FcDim = { length: 0, angle: 1 };

export type ParameterKind = 'length' | 'angle' | 'unitless';
const kindDim = (k: ParameterKind): ExDim =>
  k === 'length' ? LENGTH : k === 'angle' ? ANGLE : NONE;
const dimKind = (d: FcDim): ParameterKind | undefined =>
  d.other
    ? undefined
    : d.length === 0 && d.angle === 0
      ? 'unitless'
      : d.length === 1 && d.angle === 0
        ? 'length'
        : d.length === 0 && d.angle === 1
          ? 'angle'
          : undefined;

/** A number for an expression: 15 significant digits. */
const literal = (v: number) => `${Number(v.toPrecision(15))}`;

/** Variable-set property types that come in, by their FreeCAD dimension. */
const VARIABLE_TYPES: ReadonlyMap<string, FcDim> = new Map([
  ['App::PropertyLength', DL],
  ['App::PropertyDistance', DL],
  ['App::PropertyAngle', DA],
  ['App::PropertyFloat', D0],
  ['App::PropertyInteger', D0],
  ['App::PropertyFloatConstraint', D0],
  ['App::PropertyIntegerConstraint', D0],
  ['App::PropertyPercent', D0],
  ['App::PropertyPrecision', D0],
  ['App::PropertyQuantity', D0],
]);

/** One parameter source: a cell or a variable-set property. */
export interface Source {
  readonly key: string;
  readonly object: FcObject;
  readonly kind: 'cell' | 'variable';
  /** A cell's address, a property's name. */
  readonly at: string;
  readonly alias?: string;
  readonly cell?: FcCell;
  readonly property?: FcProperty;
  /** The formula's tree (a cell `=…`), or the quantity a cell holds. */
  node?: FcNode;
  /** Its value when the file holds it (a plain number, a quantity, a property). */
  value?: number;
  /** Its FreeCAD dimension (`undefined` until known, or never). */
  fc?: FcDim;
  /** Why it can't come in as a formula (it may still come in as a proven number). */
  formulaFailure?: { reason: ExpressionReason; detail: string };
  /** The values properties bound to exactly this source store (FreeCAD's value of it). */
  proofs: number[];
  /** Votes for its kind from what reads it. */
  votes: Set<ParameterKind>;
  read: boolean;
  kindOf?: ParameterKind;
  name?: string;
  expression?: string;
  /** How it came in. */
  from?: 'value' | 'formula' | 'proven';
  /** Why it didn't come in. */
  out?: { reason: ExpressionReason | 'text' | 'type'; detail: string };
}

/** What an expression sets, as far as the file says before the walk. */
export type TargetKind = 'dimension' | 'input' | 'plane' | 'other';

/** One `ExpressionEngine` entry of the file. */
export interface Entry {
  readonly owner: FcObject;
  readonly path: string;
  readonly text: string;
  readonly target: TargetKind;
  /** A constraint target's index; an input's property name. */
  readonly index?: number;
  readonly property?: string;
  readonly node?: FcNode;
  /** Why it can't come in, whatever its target does (syntax, limit …). */
  readonly failure?: { reason: ExpressionReason; detail: string };
  /** The outcome, once the walk is done. */
  outcome?: { outcome: 'kept' | ExpressionReason; detail?: string; text?: string };
}

/** A name the file gave that changed on the way in. */
export interface NameChange {
  readonly from: string;
  readonly to: string;
  readonly what: 'alias' | 'property' | 'constraint' | 'cell';
  readonly why: 'reserved' | 'taken' | 'invalid' | 'long';
}

/** A user parameter that came in. */
export interface ImportedParameter {
  readonly name: string;
  readonly source: 'sheet' | 'variable-set';
  /** The FreeCAD object's internal name, and the cell's address or the property's name. */
  readonly object: string;
  readonly at: string;
  readonly kind: ParameterKind;
  readonly expression: string;
  readonly group?: string;
  /** From the file's value, its formula, or a number a bound property proves. */
  readonly from: 'value' | 'formula' | 'proven';
}

export interface ParameterLeftOut {
  readonly object: string;
  readonly at: string;
  readonly reason: ExpressionReason | 'text' | 'type';
  readonly detail: string;
}

/** Resolves FreeCAD's object references: by name first, then by label; `<<label>>` by label only. */
export class ObjectIndex {
  readonly #byName: ReadonlyMap<string, FcObject>;
  readonly #byLabel = new Map<string, FcObject | null>();
  constructor(doc: FcDocument) {
    this.#byName = doc.byName;
    for (const o of doc.objects) this.#byLabel.set(o.label, this.#byLabel.has(o.label) ? null : o);
  }
  /** The object a path's first part names, or `undefined` (missing or ambiguous). */
  resolve(name: string, quoted: boolean): FcObject | undefined {
    const label = this.#byLabel.get(name);
    if (quoted) return label ?? undefined;
    const named = this.#byName.get(name);
    if (named) return label && label !== named ? undefined : named;
    return label ?? undefined;
  }
}

/** The name rule: kept when Extrudo can take it, else cleaned, cut and numbered (`name_1`). */
export class Names {
  readonly taken: Set<string>;
  readonly changes: NameChange[] = [];
  constructor(doc: ExtrudoDocument) {
    this.taken = parameterNames(doc);
  }
  /** A free name for `wanted`, taken; `undefined` past `MAX_RENAME_TRIES`. */
  fit(wanted: string, what: NameChange['what']): string | undefined {
    let base = wanted;
    let why: NameChange['why'] | undefined;
    if (!PARAMETER_NAME.test(base)) {
      why = 'invalid';
      base = base
        .replace(/[^A-Za-z0-9_]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
      if (base === '' || /^[0-9]/.test(base)) base = `p_${base}`;
    }
    if (base.length > MAX_PARAMETER_NAME) {
      why ??= 'long';
      base = base.slice(0, MAX_PARAMETER_NAME);
    }
    const free = (n: string) => !this.taken.has(n) && !isReservedName(n);
    let name = base;
    if (!free(name)) {
      why ??= isReservedName(base) ? 'reserved' : 'taken';
      let found: string | undefined;
      for (let k = 1; k <= MAX_RENAME_TRIES; k++) {
        const suffix = `_${k}`;
        const n = base.slice(0, MAX_PARAMETER_NAME - suffix.length) + suffix;
        if (free(n)) {
          found = n;
          break;
        }
      }
      if (found === undefined) return undefined;
      name = found;
    }
    this.taken.add(name);
    if (name !== wanted) this.changes.push({ from: wanted, to: name, what, why: why ?? 'invalid' });
    return name;
  }
  /** Extrudo's own next `dN`, skipping every name taken. */
  auto(): string {
    let n = 1;
    while (this.taken.has(`d${n}`) || isReservedName(`d${n}`)) n++;
    const name = `d${n}`;
    this.taken.add(name);
    return name;
  }
}

/** Parses FreeCAD text with the parser's limits; a reason instead of a throw. */
export function parseText(
  text: string,
): { node: FcNode } | { failure: { reason: ExpressionReason; detail: string } } {
  try {
    return { node: parseFcExpression(text) };
  } catch (error) {
    if (error instanceof FcSyntaxError)
      return { failure: { reason: error.limit ? 'limit' : 'syntax', detail: error.message } };
    throw error;
  }
}

/** The dimension of a constraint type's value in FreeCAD (`Sketch.Constraints.x`). */
export function constraintDim(type: number): FcDim | undefined {
  // Distance, DistanceX, DistanceY, Radius, Diameter: lengths; Angle: an angle.
  if (type === 6 || type === 7 || type === 8 || type === 11 || type === 18) return DL;
  if (type === 9) return DA;
  return undefined;
}

/** Quantity properties whose unit their class sets (the file says only `PropertyQuantityConstraint`). */
const QUANTITY_UNITS: ReadonlyMap<string, FcDim> = new Map([
  ['PartDesign::Fillet\u0000Radius', DL],
  ['PartDesign::Chamfer\u0000Size', DL],
  ['PartDesign::Chamfer\u0000Size2', DL],
]);

/** A feature property's dimension and how FreeCAD sets it, by its declared type (and its owner's class). */
export function propertyDim(
  p: FcProperty | undefined,
  ownerType = '',
): { dim: FcDim; count: boolean } | undefined {
  if (!p) return undefined;
  if (p.type === 'App::PropertyLength' || p.type === 'App::PropertyDistance')
    return { dim: DL, count: false };
  if (p.type === 'App::PropertyAngle') return { dim: DA, count: false };
  if (p.type.startsWith('App::PropertyInteger')) return { dim: D0, count: true };
  if (p.type === 'App::PropertyQuantityConstraint' || p.type === 'App::PropertyQuantity') {
    const d = QUANTITY_UNITS.get(`${ownerType}\u0000${p.name}`);
    return d ? { dim: d, count: false } : undefined;
  }
  if (p.type.startsWith('App::PropertyFloat')) return { dim: D0, count: false };
  return undefined;
}

const CONSTRAINT_PATH = (n: FcNode | undefined): { index?: number; name?: string } | undefined => {
  if (n?.kind !== 'path' || n.document !== undefined) return undefined;
  const [c, more] = n.components;
  if (!c || more || c.quoted || c.name !== 'Constraints' || c.slice) return undefined;
  if (c.index !== undefined) return { index: c.index };
  return undefined;
};

/** A sketch's raw constraint records: type, name, value, driving. */
export function constraintRecords(
  o: FcObject,
): { type: number; name: string; value: number; driving: boolean }[] {
  const v = o.properties.Constraints?.value;
  if (v?.kind !== 'constraints') return [];
  return v.records.map((r) => ({
    type: Number(r.attrs.Type),
    name: r.attrs.Name ?? '',
    value: Number(r.attrs.Value),
    driving:
      r.attrs.IsDriving === undefined || r.attrs.IsDriving === '1' || r.attrs.IsDriving === 'true',
  }));
}

/** Everything `prepareParameters` found, for the walk and the report. */
export interface PreparedParameters {
  readonly entries: readonly Entry[];
  /** Entries by owner, in the file's order. */
  readonly byOwner: ReadonlyMap<string, readonly Entry[]>;
  readonly sources: readonly Source[];
  readonly names: Names;
  /** The Extrudo name of each named driving constraint, by sketch and constraint index. */
  readonly constraintNames: ReadonlyMap<string, ReadonlyMap<number, string>>;
  readonly objects: ObjectIndex;
  /** The source a path reads (`Sheet.alias`, `VarSet.Prop`), when it is one. */
  readonly sourceOf: (
    owner: FcObject,
    path: Extract<FcNode, { kind: 'path' }>,
  ) => Source | undefined;
  /** The (object, property) pairs an expression reads (`Pad.Length`): their inputs get a name. */
  readonly readInputs: ReadonlySet<string>;
  /** The (sketch, index) pairs an expression reads. */
  readonly readConstraints: ReadonlySet<string>;
  readonly parameters: readonly ImportedParameter[];
  readonly leftOut: readonly ParameterLeftOut[];
  /** Expressions past the per-object or per-import cap. */
  readonly overLimit: number;
}

export const pairKey = (object: string, what: string | number) => `${object}\u0000${what}`;

/**
 * Reads the file's parameters and expressions and adds the parameters to
 * `design` in one undo step. Never throws for anything the file holds.
 */
export function prepareParameters(
  doc: FcDocument,
  design: Design,
  options: { maxParameters?: number; maxExpressions?: number } = {},
): PreparedParameters {
  const objects = new ObjectIndex(doc);
  const maxExpressions = options.maxExpressions ?? MAX_IMPORT_EXPRESSIONS;

  // ---------------------------------------------------------------- sources
  const sources: Source[] = [];
  const bySheet = new Map<FcObject, { cells: Map<string, Source>; aliases: Map<string, Source> }>();
  const byVariable = new Map<string, Source>();
  const leftOut: ParameterLeftOut[] = [];
  for (const o of doc.objects) {
    if (o.type === 'Spreadsheet::Sheet') {
      const v = o.properties.cells?.value;
      const cells = new Map<string, Source>();
      const aliases = new Map<string, Source>();
      bySheet.set(o, { cells, aliases });
      if (v?.kind !== 'sheet') continue;
      let n = 0;
      for (const cell of v.cells) {
        if (++n > MAX_SHEET_CELLS) {
          leftOut.push({
            object: o.name,
            at: '',
            reason: 'limit',
            detail: `cells past the first ${MAX_SHEET_CELLS} of the sheet aren't read`,
          });
          break;
        }
        const address = cellAddress(cell.address);
        if (!address || cells.has(address)) continue;
        const s: Source = {
          key: pairKey(o.name, address),
          object: o,
          kind: 'cell',
          at: address,
          cell,
          proofs: [],
          votes: new Set(),
          read: false,
          ...(cell.alias !== undefined ? { alias: cell.alias } : {}),
        };
        cells.set(address, s);
        if (cell.alias !== undefined && !aliases.has(cell.alias) && !cellAddress(cell.alias))
          aliases.set(cell.alias, s);
        sources.push(s);
      }
    } else if (o.type === 'App::VarSet') {
      for (const p of Object.values(o.properties)) {
        if (p.group === undefined) continue;
        const s: Source = {
          key: pairKey(o.name, p.name),
          object: o,
          kind: 'variable',
          at: p.name,
          property: p,
          proofs: [],
          votes: new Set(),
          read: false,
        };
        byVariable.set(s.key, s);
        sources.push(s);
      }
    }
  }

  /** The source `path` reads from `owner` (a sheet's formula reads its own cells by bare name). */
  const sourceOf = (
    owner: FcObject,
    path: Extract<FcNode, { kind: 'path' }>,
  ): Source | undefined => {
    if (path.document !== undefined) return undefined;
    const c = path.components;
    const cellOf = (sheet: FcObject, name: string) => {
      const s = bySheet.get(sheet);
      if (!s) return undefined;
      const address = cellAddress(name);
      return address ? s.cells.get(address) : s.aliases.get(name);
    };
    const first = c[0];
    if (!first || first.index !== undefined || first.key !== undefined || first.slice)
      return undefined;
    if (path.local || c.length === 1) {
      if (c.length !== 1 || owner.type !== 'Spreadsheet::Sheet' || first.quoted) return undefined;
      return cellOf(owner, first.name);
    }
    const second = c[1];
    if (
      c.length !== 2 ||
      !second ||
      second.quoted ||
      second.index !== undefined ||
      second.key !== undefined ||
      second.slice
    )
      return undefined;
    const o = objects.resolve(first.name, first.quoted);
    if (!o) return undefined;
    if (o.type === 'Spreadsheet::Sheet') return cellOf(o, second.name);
    if (o.type === 'App::VarSet') return byVariable.get(pairKey(o.name, second.name));
    return undefined;
  };

  // ------------------------------------------------------------ expressions
  const entries: Entry[] = [];
  const byOwner = new Map<string, Entry[]>();
  let overLimit = 0;
  for (const o of doc.objects) {
    let mine = 0;
    for (const e of o.expressions) {
      if (++mine > MAX_OBJECT_EXPRESSIONS || entries.length >= maxExpressions) {
        overLimit++;
        const entry: Entry = {
          owner: o,
          path: e.path,
          text: e.expression,
          target: 'other',
          failure: { reason: 'limit', detail: 'past the most expressions the import reads' },
        };
        entries.push(entry);
        const list = byOwner.get(o.name) ?? [];
        list.push(entry);
        byOwner.set(o.name, list);
        continue;
      }
      const entry = classify(o, e.path, e.expression);
      entries.push(entry);
      const list = byOwner.get(o.name) ?? [];
      list.push(entry);
      byOwner.set(o.name, list);
    }
  }

  // ---------------------------------------------------- cells' own contents
  for (const s of sources) {
    if (s.kind === 'variable') {
      const p = s.property as FcProperty;
      const dim = VARIABLE_TYPES.get(p.type);
      if (!dim || (p.value.kind !== 'float' && p.value.kind !== 'integer')) {
        s.out = {
          reason: 'type',
          detail: `a ${p.type.replace('App::Property', '').toLowerCase() || 'property'} doesn't come in`,
        };
        continue;
      }
      s.fc = dim;
      s.value = p.value.value;
      continue;
    }
    const content = (s.cell as FcCell).content;
    if (content.startsWith('=')) {
      const parsed = parseText(content.slice(1));
      if ('failure' in parsed) s.formulaFailure = parsed.failure;
      else s.node = parsed.node;
      continue;
    }
    if (content.startsWith("'") || content.trim() === '') {
      s.out = { reason: 'text', detail: 'it holds text' };
      continue;
    }
    if (/^\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\s*$/.test(content)) {
      const v = Number(content);
      if (Number.isFinite(v)) {
        s.value = v;
        s.fc = D0;
        continue;
      }
    }
    // A quantity typed into a cell (`6 mm`): one number with a unit.
    const parsed = parseText(content);
    const n = 'node' in parsed ? parsed.node : undefined;
    const negated = n?.kind === 'unary' && n.op === '-' && n.arg.kind === 'num';
    if (n && (n.kind === 'num' || negated)) s.node = n;
    else s.out = { reason: 'text', detail: 'it holds text' };
  }

  // --------------------------------------------------- what reads what
  const formulaReads = new Map<Source, Source[]>();
  const pathsIn = (node: FcNode) => {
    const out: Extract<FcNode, { kind: 'path' }>[] = [];
    const stack: FcNode[] = [node];
    while (stack.length > 0) {
      const n = stack.pop() as FcNode;
      if (n.kind === 'path') out.push(n);
      else if (n.kind === 'unary') stack.push(n.arg);
      else if (n.kind === 'binary' || n.kind === 'compare') stack.push(n.left, n.right);
      else if (n.kind === 'conditional') stack.push(n.test, n.yes, n.no);
      else if (n.kind === 'call') stack.push(...n.args);
      else if (n.kind === 'member') stack.push(n.of);
    }
    return out;
  };
  for (const s of sources) {
    if (!s.node || s.kind !== 'cell' || !(s.cell as FcCell).content.startsWith('=')) continue;
    const reads: Source[] = [];
    for (const p of pathsIn(s.node)) {
      const r = sourceOf(s.object, p);
      if (r) reads.push(r);
      else
        s.formulaFailure ??= {
          reason: 'reference',
          detail: 'its formula reads a value that is not a cell or a variable',
        };
    }
    formulaReads.set(s, reads);
  }
  const readInputs = new Set<string>();
  const readConstraints = new Set<string>();
  for (const e of entries) {
    if (!e.node) continue;
    for (const p of pathsIn(e.node)) {
      const r = sourceOf(e.owner, p);
      if (r) {
        r.read = true;
        continue;
      }
      const model = modelRead(e.owner, p, objects);
      if (model?.kind === 'input') readInputs.add(pairKey(model.object.name, model.property));
      if (model?.kind === 'constraint') readConstraints.add(pairKey(model.object.name, model.at));
    }
  }
  // An unaliased cell comes in when something that comes in reads it: mark the closure.
  const marked = new Set<Source>();
  const stack: Source[] = sources.filter(
    (s) => s.read || (s.alias !== undefined && s.kind === 'cell') || s.kind === 'variable',
  );
  while (stack.length > 0) {
    const s = stack.pop() as Source;
    if (marked.has(s)) continue;
    marked.add(s);
    for (const r of formulaReads.get(s) ?? []) {
      r.read = true;
      stack.push(r);
    }
  }
  const wanted = sources.filter(
    (s) => !s.out && (s.kind === 'variable' || s.alias !== undefined || s.read),
  );

  // ------------------------------------------------------------------ cycles
  const cyclic = cycleMembers(wanted, formulaReads);
  for (const s of cyclic)
    s.formulaFailure = {
      reason: 'cycle',
      detail: 'its formula is part of a loop of cells that read each other',
    };

  // ------------------------------------------------------ FreeCAD dimensions
  const dimResolver =
    (owner: FcObject): Resolver =>
    (p) => {
      const s = sourceOf(owner, p);
      if (!s || !s.fc)
        return { reason: 'reference', detail: 'it reads a value whose unit is unknown' };
      return { text: 'x', fc: s.fc, ex: s.fc };
    };
  for (const s of topological(wanted, formulaReads)) {
    if (s.fc || !s.node) continue;
    if (s.formulaFailure && s.formulaFailure.reason !== 'reference') continue;
    const r = emitExtrudo(s.node, dimResolver(s.object), { mode: 'any' });
    if (r.ok) {
      if (!s.formulaFailure) s.fc = r.fc;
    } else s.formulaFailure ??= { reason: r.reason, detail: r.detail };
  }

  // A formula whose unit can't be worked out but whose value a bound property proves is a plain number.
  for (const e of entries) {
    if (e.node?.kind !== 'path') continue;
    const s = sourceOf(e.owner, e.node);
    if (s && !s.fc && s.node) s.fc = D0;
  }

  // ------------------------------------------------------------- proofs
  for (const e of entries) {
    if (e.node?.kind !== 'path') continue;
    const s = sourceOf(e.owner, e.node);
    const stored = storedValue(e);
    if (s && stored !== undefined) s.proofs.push(stored);
  }

  // ---------------------------------------------------------------- votes
  const voteFrom = (owner: FcObject, node: FcNode, kind: ParameterKind | 'count') => {
    const target: ParameterKind = kind === 'count' ? 'unitless' : kind;
    const dimOf = (p: Extract<FcNode, { kind: 'path' }>): FcDim | undefined => {
      const s = sourceOf(owner, p);
      if (s) return s.fc;
      return modelRead(owner, p, objects)?.dim;
    };
    vote(node, target, dimOf, (p) => sourceOf(owner, p));
  };
  for (const e of entries) {
    if (!e.node) continue;
    const k = targetKind(e);
    if (k) voteFrom(e.owner, e.node, k);
  }
  // Backwards through the formulas: a formula cell's kind votes for its one carrier.
  for (const s of topological(wanted, formulaReads).reverse()) {
    if (!s.node || s.formulaFailure || !s.fc || dimKind(s.fc) !== 'unitless') continue;
    const k = unanimous(s.votes);
    if (k) voteFrom(s.object, s.node, k);
  }

  // ------------------------------------------------------------------ kinds
  for (const s of topological(wanted, formulaReads)) {
    if (!s.fc) continue;
    const own = dimKind(s.fc);
    if (own !== 'unitless') {
      s.kindOf = own;
      continue;
    }
    const k = unanimous(s.votes) ?? (s.votes.size > 1 ? 'unitless' : undefined);
    if (k) {
      s.kindOf = k;
      continue;
    }
    if (s.node && (s.cell as FcCell | undefined)?.content.startsWith('=') && !s.formulaFailure) {
      // A formula's kind follows from its parts.
      const kinds: Resolver = (p) => {
        const r = sourceOf(s.object, p);
        if (!r?.fc || !r.kindOf) return { reason: 'reference', detail: 'unknown' };
        return { text: 'x', fc: r.fc, ex: kindDim(r.kindOf) };
      };
      const natural = emitExtrudo(s.node, kinds, { mode: 'any' });
      if (natural.ok) {
        s.kindOf = dimKind(natural.ex) ?? 'unitless';
        continue;
      }
    }
    const display = (s.cell as FcCell | undefined)?.displayUnit?.trim();
    const shown = display ? displayKind(display) : undefined;
    s.kindOf = shown ?? 'unitless';
  }

  // ------------------------------------------------------------------ names
  const names = new Names(design.doc);
  const max = options.maxParameters ?? MAX_IMPORT_PARAMETERS;
  let count = 0;
  const nameSource = (s: Source, wantedName: string, what: NameChange['what']) => {
    if (s.out) return;
    if (count >= max) {
      s.out = { reason: 'limit', detail: `past the ${max} parameters an import adds` };
      return;
    }
    const n = names.fit(wantedName, what);
    if (n === undefined) {
      s.out = { reason: 'limit', detail: 'no free name for it' };
      return;
    }
    s.name = n;
    count++;
  };
  for (const s of wanted)
    if (s.kind === 'cell' && s.alias !== undefined) nameSource(s, s.alias, 'alias');
  for (const s of wanted) if (s.kind === 'variable') nameSource(s, s.at, 'property');
  const constraintNames = new Map<string, Map<number, string>>();
  for (const o of doc.objects) {
    if (!o.type.startsWith('Sketcher::SketchObject')) continue;
    const map = new Map<number, string>();
    constraintRecords(o).forEach((c, i) => {
      if (!c.driving || c.name === '' || constraintDim(c.type) === undefined) return;
      const n = names.fit(c.name, 'constraint');
      if (n !== undefined) map.set(i, n);
    });
    if (map.size > 0) constraintNames.set(o.name, map);
  }
  for (const s of wanted)
    if (s.kind === 'cell' && s.alias === undefined)
      nameSource(s, `${cleanName(s.object.label, s.object.name)}_${s.at}`, 'cell');

  // ------------------------------------------------------------ expressions
  const named = wanted.filter((s) => s.name !== undefined && s.kindOf !== undefined);
  const resolveFor =
    (owner: FcObject): Resolver =>
    (p) => {
      const s = sourceOf(owner, p);
      if (!s || s.name === undefined || !s.fc || !s.kindOf || s.out)
        return { reason: 'reference', detail: "it reads a cell or variable that doesn't come in" };
      return { text: s.name, fc: s.fc, ex: kindDim(s.kindOf) };
    };
  const proven = (s: Source): number | undefined => {
    const [first] = s.proofs;
    if (first === undefined) return undefined;
    return s.proofs.every((v) => Math.abs(v - first) <= 1e-9 * Math.max(1, Math.abs(first)))
      ? first
      : undefined;
  };
  const asNumber = (s: Source, v: number) => {
    const unit = s.kindOf === 'length' ? ' mm' : s.kindOf === 'angle' ? ' deg' : '';
    return `${literal(v)}${unit}`;
  };
  for (const s of topological(named, formulaReads)) {
    const kind = s.kindOf as ParameterKind;
    if (s.value !== undefined && !s.node) {
      s.expression = asNumber(s, s.value);
      s.from = 'value';
      continue;
    }
    const formula = (s.cell as FcCell | undefined)?.content.startsWith('=');
    if (s.node && !s.formulaFailure) {
      const r = emitExtrudo(s.node, resolveFor(s.object), {
        mode: 'parameter',
        dim: kindDim(kind),
      });
      if (r.ok) {
        s.expression = r.text;
        s.from = formula ? 'formula' : 'value';
        continue;
      }
      s.formulaFailure = { reason: r.reason, detail: r.detail };
    }
    const v = proven(s);
    if (v !== undefined) {
      s.expression = asNumber(s, v);
      s.from = 'proven';
      continue;
    }
    s.out = s.formulaFailure ?? { reason: 'reference', detail: 'its value is not in the file' };
  }

  // Extrudo's own evaluation of the set: a parameter that errors takes its proven number, or stays out.
  for (let round = 0; round <= named.length; round++) {
    const list = named.filter((s) => !s.out && s.expression !== undefined);
    const params: Parameter[] = list.map((s, i) => ({
      id: `fcp${i}` as ParameterId,
      name: s.name as string,
      expression: s.expression as string,
      unit: s.kindOf as ParameterKind,
    }));
    const evaluation = evaluateParameters({ ...design.doc, parameters: params, features: [] });
    let changed = false;
    for (const s of list) {
      const r = evaluation.parameters.get(s.name as string)?.result;
      if (r?.ok && Number.isFinite(r.value)) continue;
      changed = true;
      const v = s.from === 'formula' ? proven(s) : undefined;
      if (v !== undefined) {
        s.expression = asNumber(s, v);
        s.from = 'proven';
      } else
        s.out = {
          reason:
            r && !r.ok && r.error.code === 'cycle'
              ? 'cycle'
              : s.from === 'formula'
                ? 'differs'
                : 'reference',
          detail: r && !r.ok ? r.error.message : 'it has no value',
        };
    }
    if (!changed) break;
  }

  // ------------------------------------------------------------------ add
  const parameters: ImportedParameter[] = [];
  const come = named.filter((s) => !s.out && s.expression !== undefined);
  if (come.length > 0)
    design.transaction('Parameters from the file', () => {
      for (const s of come) {
        const group = cleanName(s.object.label, s.object.name);
        const comment = s.property?.doc ? cleanName(s.property.doc, '') : '';
        const g = [...group].slice(0, MAX_GROUP_LENGTH).join('').trim();
        design.parameter(s.name as string, s.expression as string, {
          unit: s.kindOf as ParameterKind,
          ...(g ? { group: g } : {}),
          ...(comment ? { comment: [...comment].slice(0, MAX_COMMENT_LENGTH).join('') } : {}),
        });
        parameters.push({
          name: s.name as string,
          source: s.kind === 'cell' ? 'sheet' : 'variable-set',
          object: s.object.name,
          at: s.at,
          kind: s.kindOf as ParameterKind,
          expression: s.expression as string,
          ...(g ? { group: g } : {}),
          from: s.from as 'value' | 'formula' | 'proven',
        });
      }
    });
  for (const s of sources)
    if (s.out && (s.kind === 'variable' || s.alias !== undefined || s.read))
      leftOut.push({ object: s.object.name, at: s.at, reason: s.out.reason, detail: s.out.detail });

  return {
    entries,
    byOwner,
    sources,
    names,
    constraintNames,
    objects,
    sourceOf,
    readInputs,
    readConstraints,
    parameters,
    leftOut,
    overLimit,
  };
}

const displayKind = (unit: string): ParameterKind | undefined => {
  const parsed = parseText(`1 ${unit}`);
  if (!('node' in parsed) || parsed.node.kind !== 'num' || !parsed.node.unit) return undefined;
  const r = emitExtrudo(parsed.node, () => ({ reason: 'reference', detail: '' }), { mode: 'any' });
  return r.ok ? dimKind(r.fc) : undefined;
};

const unanimous = (votes: ReadonlySet<ParameterKind>): ParameterKind | undefined =>
  votes.size === 1 ? [...votes][0] : undefined;

/** A path that reads a model value: a constraint of a sketch, or a feature's property. */
export function modelRead(
  owner: FcObject,
  path: Extract<FcNode, { kind: 'path' }>,
  objects: ObjectIndex,
):
  | { kind: 'constraint'; object: FcObject; at: number; dim: FcDim }
  | { kind: 'input'; object: FcObject; property: string; dim: FcDim }
  | undefined {
  if (path.document !== undefined) return undefined;
  const c = path.components;
  let object: FcObject | undefined;
  let rest = c;
  const first = c[0];
  if (!first) return undefined;
  if (path.local || c.length === 1) object = owner;
  else {
    object = objects.resolve(first.name, first.quoted);
    rest = c.slice(1);
    // FreeCAD reads `Name.x` as the owner's own property `Name` when no object is called that.
    if (!object && !first.quoted) {
      object = owner;
      rest = c;
    }
  }
  if (!object) return undefined;
  const [p, q] = rest;
  if (!p || p.quoted || p.slice || p.key !== undefined) return undefined;
  if (object.type.startsWith('Sketcher::SketchObject') && p.name === 'Constraints') {
    const records = constraintRecords(object);
    let at: number | undefined;
    if (p.index !== undefined && rest.length === 1) at = p.index;
    else if (
      p.index === undefined &&
      q &&
      rest.length === 2 &&
      !q.quoted &&
      q.index === undefined
    ) {
      at = records.findIndex((r) => r.name === q.name);
      if (at < 0) at = undefined;
    }
    if (at === undefined || at < 0 || at >= records.length) return undefined;
    const dim = constraintDim(records[at]?.type as number);
    return dim ? { kind: 'constraint', object, at, dim } : undefined;
  }
  if (rest.length !== 1 || p.index !== undefined) return undefined;
  if (!object.type.startsWith('PartDesign::')) return undefined;
  const d = propertyDim(
    Object.hasOwn(object.properties, p.name) ? object.properties[p.name] : undefined,
    object.type,
  );
  return d ? { kind: 'input', object, property: p.name, dim: d.dim } : undefined;
}

/** What an entry sets, from its owner and path alone. */
function classify(o: FcObject, path: string, text: string): Entry {
  const base = { owner: o, path, text };
  const parsedPath = parseText(path);
  const node = parseText(text);
  const failure = 'failure' in node ? node.failure : undefined;
  const withNode = {
    ...base,
    ...('node' in node ? { node: node.node } : {}),
    ...(failure ? { failure } : {}),
  };
  if ('failure' in parsedPath) return { ...withNode, target: 'other' };
  const p = parsedPath.node;
  if (p.kind !== 'path') return { ...withNode, target: 'other' };
  const names = p.components.map((c) => c.name);
  if (o.type.startsWith('Sketcher::SketchObject') && names[0] === 'Constraints') {
    const records = constraintRecords(o);
    const at =
      CONSTRAINT_PATH(p)?.index ??
      (names.length === 2 ? records.findIndex((r) => r.name === names[1]) : -1);
    if (at !== undefined && at >= 0 && at < records.length)
      return { ...withNode, target: 'dimension', index: at };
    return { ...withNode, target: 'other' };
  }
  if (
    names.join('.') === 'AttachmentOffset.Base.z' &&
    (o.type.startsWith('Sketcher::SketchObject') || o.type === 'PartDesign::Plane')
  )
    return { ...withNode, target: 'plane' };
  if (
    o.type.startsWith('PartDesign::') &&
    names.length === 1 &&
    p.components[0]?.index === undefined
  )
    return { ...withNode, target: 'input', property: names[0] as string };
  return { ...withNode, target: 'other' };
}

/** The kind of value an entry's target takes, when it is a number. */
function targetKind(e: Entry): ParameterKind | 'count' | undefined {
  if (e.target === 'plane') return 'length';
  if (e.target === 'dimension') {
    const c = constraintRecords(e.owner)[e.index as number];
    const d = c ? constraintDim(c.type) : undefined;
    return d ? (d.angle === 1 ? 'angle' : 'length') : undefined;
  }
  if (e.target === 'input') {
    const p = Object.hasOwn(e.owner.properties, e.property as string)
      ? e.owner.properties[e.property as string]
      : undefined;
    const d = propertyDim(p, e.owner.type);
    if (!d) return undefined;
    return d.count ? 'count' : (dimKind(d.dim) ?? undefined);
  }
  return undefined;
}

/** The value the file stores for an entry's target (mm, degrees, a count). */
export function storedValue(e: Entry): number | undefined {
  if (e.target === 'dimension') {
    const c = constraintRecords(e.owner)[e.index as number];
    if (!c || !Number.isFinite(c.value)) return undefined;
    return c.type === 9 ? (c.value * 180) / Math.PI : c.value;
  }
  if (e.target === 'plane') {
    const v = e.owner.properties.AttachmentOffset?.value;
    return v?.kind === 'placement' ? v.value.position[2] : undefined;
  }
  if (e.target === 'input') {
    const p = Object.hasOwn(e.owner.properties, e.property as string)
      ? e.owner.properties[e.property as string]
      : undefined;
    return p && (p.value.kind === 'float' || p.value.kind === 'integer')
      ? p.value.value
      : undefined;
  }
  return undefined;
}

/**
 * Votes for the kinds of the plain-number sources `node` reads when its
 * result goes to a value of `target`: a source that alone carries the result's
 * unit (reached through sums, products, a numerator, `abs`, `min`, `max` …)
 * votes for that unit; one inside a trigonometric function, a rounding, an
 * exponent, a denominator, or beside a value that already has the unit votes
 * for none. One pass over the tree.
 */
function vote(
  node: FcNode,
  target: ParameterKind,
  dimOf: (p: Extract<FcNode, { kind: 'path' }>) => FcDim | undefined,
  sourceOf: (p: Extract<FcNode, { kind: 'path' }>) => Source | undefined,
): void {
  const carriers = new Set<Source>();
  const plain = new Set<Source>();
  let unitless = true;
  const walk = (n: FcNode, carrying: boolean) => {
    switch (n.kind) {
      case 'path': {
        const s = sourceOf(n);
        const d = dimOf(n);
        if (d && (d.length !== 0 || d.angle !== 0) && carrying) unitless = false;
        if (s && s.fc && s.fc.length === 0 && s.fc.angle === 0 && !s.fc.other)
          (carrying ? carriers : plain).add(s);
        return;
      }
      case 'num':
        if (n.unit && carrying) unitless = false;
        return;
      case 'unary':
        walk(n.arg, carrying);
        return;
      case 'binary':
        if (n.op === '+' || n.op === '-' || n.op === '*') {
          walk(n.left, carrying);
          walk(n.right, carrying);
        } else if (n.op === '/' || n.op === '%') {
          walk(n.left, carrying);
          walk(n.right, false);
        } else {
          walk(n.left, false);
          walk(n.right, false);
        }
        return;
      case 'call': {
        const keeps = ['abs', 'min', 'max', 'sum', 'average', 'hypot', 'cath', 'mod'].includes(
          n.name,
        );
        n.args.forEach((a, i) => walk(a, keeps && carrying && !(n.name === 'mod' && i > 0)));
        return;
      }
      case 'compare':
      case 'conditional':
      case 'member':
        return;
      default:
        return;
    }
  };
  walk(node, true);
  for (const s of plain) s.votes.add('unitless');
  if (target === 'unitless' || !unitless) {
    for (const s of carriers) s.votes.add('unitless');
    return;
  }
  if (carriers.size === 1) for (const s of carriers) s.votes.add(target);
}

/** The sources in an order where each comes after the sources its formula reads (cycle members last). */
function topological(
  list: readonly Source[],
  reads: ReadonlyMap<Source, readonly Source[]>,
): Source[] {
  const inList = new Set(list);
  const done = new Set<Source>();
  const out: Source[] = [];
  for (const start of list) {
    if (done.has(start)) continue;
    // An explicit stack: (source, next read to visit).
    const stack: [Source, number][] = [[start, 0]];
    const onStack = new Set<Source>([start]);
    while (stack.length > 0) {
      const top = stack[stack.length - 1] as [Source, number];
      const [s, i] = top;
      const r = (reads.get(s) ?? []).filter((x) => inList.has(x));
      if (i < r.length) {
        top[1]++;
        const n = r[i] as Source;
        if (!done.has(n) && !onStack.has(n)) {
          stack.push([n, 0]);
          onStack.add(n);
        }
        continue;
      }
      stack.pop();
      onStack.delete(s);
      done.add(s);
      out.push(s);
    }
  }
  return out;
}

/** The sources whose formulas are on a loop of reads (Tarjan's strongly connected components, iterative). */
function cycleMembers(
  list: readonly Source[],
  reads: ReadonlyMap<Source, readonly Source[]>,
): Set<Source> {
  const index = new Map<Source, number>();
  const low = new Map<Source, number>();
  const onStack = new Set<Source>();
  const stack: Source[] = [];
  const out = new Set<Source>();
  let counter = 0;
  for (const root of list) {
    if (index.has(root)) continue;
    const work: [Source, number][] = [[root, 0]];
    index.set(root, counter);
    low.set(root, counter++);
    stack.push(root);
    onStack.add(root);
    while (work.length > 0) {
      const top = work[work.length - 1] as [Source, number];
      const [v, i] = top;
      const next = reads.get(v) ?? [];
      if (i < next.length) {
        top[1]++;
        const w = next[i] as Source;
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter++);
          stack.push(w);
          onStack.add(w);
          work.push([w, 0]);
        } else if (onStack.has(w))
          low.set(v, Math.min(low.get(v) as number, index.get(w) as number));
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent[0], Math.min(low.get(parent[0]) as number, low.get(v) as number));
      if (low.get(v) === index.get(v)) {
        const members: Source[] = [];
        for (;;) {
          const w = stack.pop() as Source;
          onStack.delete(w);
          members.push(w);
          if (w === v) break;
        }
        const selfLoop = (reads.get(v) ?? []).includes(v);
        if (members.length > 1 || selfLoop) for (const m of members) out.add(m);
      }
    }
  }
  return out;
}

export { isFcToken };
