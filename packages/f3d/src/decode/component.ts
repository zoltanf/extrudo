/**
 * The component tree of a design segment.
 *
 * A component (`E03784ED…`) is a record whose most-derived level references
 * its own containers — among them its occurrence list (`904F885E…`), its body
 * container (`CD57BC48…`) and its history (`C3423E04…`) — and ends with two
 * strings: a GUID, then the component's name (the root's is the design's
 * name with its version, "Bracket v3").
 *
 * - The history references the component's feature list (`3A6D1E62…`) and its
 *   own timeline (`2F4C1849…`; only the root's lists items: the file keeps one
 *   timeline). The feature list's base level lists every record the component
 *   owns, and every timeline feature's base level ends with a reference to the
 *   feature list of the component it belongs to.
 * - A body (`D3937028…`) references the body container of its component, and
 *   the container references the component.
 * - An occurrence that is hidden is named, by its path from the root, by a
 *   `2BB3BB69…` record; a hidden component hides the ones inside it.
 * - An occurrence (`CE2913AA…`) places a component: a reference to the
 *   component, u32 ordinal (1 for the first occurrence of a component, 2, 3…
 *   for copies), the component's GUID and the occurrence's GUID, then, when
 *   it is placed, a row-major 4×4 rigid transform (translation in cm). The
 *   root's is named `rootInstance`. A component's occurrence list references
 *   the occurrences of its children.
 *
 * Records are found by these references, not by offsets: the frames differ
 * between file generations.
 */
import { Reader } from '../bytes';
import type { Segment } from '../segment';
import { BODY } from './body';
import { BODY_LINK, BODY_OPERAND } from './pattern';
import { refAhead } from './sketch-geometry';

export const COMPONENT = 'E03784ED-5E19-4E14-B9F2-3B07017018CD';
export const OCCURRENCE = 'CE2913AA-CFE0-4F04-9102-24424ED3BCFA';
export const OCCURRENCE_LIST = '904F885E-D859-4755-A7EF-6EBED8732FAD';
export const COMPONENT_HISTORY = 'C3423E04-7E85-4B44-8E31-A5FA9C100052';
export const FEATURE_LIST = '3A6D1E62-99F8-4E32-BAAA-DBA0A2CFB27C';
export const BODY_CONTAINER = 'CD57BC48-50EC-47DC-975A-FB6DEA72F4DA';
/**
 * A record that names a component (first) and its occurrence: one per
 * occurrence whose light bulb is off. Read from the files alone: in every
 * multi-component sample, the components these name are the ones a STEP
 * export of the same design leaves out.
 */
export const HIDDEN_OCCURRENCE = '2BB3BB69-B0FD-4D56-B4CD-DEBD30847BE3';

/** A row-major 4×4 transform, translation in cm. */
export type Transform = number[];

export interface F3dOccurrence {
  /** The occurrence record. */
  id: number;
  /** One-based: 1 for a component's first occurrence, then 2, 3… for copies. */
  ordinal: number;
  /** Where it is placed, when the record stores a transform. */
  transform?: Transform;
}

export interface F3dComponent {
  /** The component record. */
  id: number;
  name: string;
  root: boolean;
  /** False when the file hides it (its occurrence's light bulb is off). */
  visible: boolean;
  /** Its occurrences, in record order. */
  occurrences: F3dOccurrence[];
  /** The component whose occurrence list holds this one's occurrence. */
  parent?: number;
}

export interface ComponentTree {
  /** Root first, then the others in record order. */
  components: F3dComponent[];
  /** Feature list record → component record. */
  featureLists: Map<number, number>;
  /** Body container record → component record. */
  bodyContainers: Map<number, number>;
  /** Feature (or other record) → the body records its body links say it made. */
  bodiesMadeBy: Map<number, number[]>;
}

/** Every local reference in a byte range, by shape, left to right. */
function refs(seg: Segment, start: number, end: number): number[] {
  const r = new Reader(seg.bulk, start, end);
  const out: number[] = [];
  while (r.pos < end) {
    const id = refAhead(seg, r);
    if (id !== undefined) out.push(id);
    r.pos += id !== undefined ? 9 : 1;
  }
  return out;
}

/** Each record's references, read once per segment (the walks below revisit records). */
const levelCache = new WeakMap<Segment, Map<number, number[]>>();
const levelRefs = (seg: Segment, id: number): readonly number[] => {
  let cache = levelCache.get(seg);
  if (!cache) {
    cache = new Map();
    levelCache.set(seg, cache);
  }
  let out = cache.get(id);
  if (!out) {
    const f = seg.frame(id);
    out = refs(seg, f.start, f.end);
    cache.set(id, out);
  }
  return out;
};
const baseRefs = (seg: Segment, id: number): number[] => {
  const f = seg.frame(id);
  return f.base ? refs(seg, f.base.start, f.base.end) : [];
};
const ofType = (seg: Segment, ids: readonly number[], guid: string) =>
  ids.filter((id) => seg.typeOf(id)?.guid === guid);

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A UTF-16 GUID string (u32 36, then 36 code units) at the reader, read; else undefined. */
function guidAt(r: Reader): string | undefined {
  if (r.peekU32() !== 36 || r.remaining < 76) return undefined;
  const at = r.pos;
  const text = r.wstr(36);
  if (GUID.test(text)) return text;
  r.pos = at;
  return undefined;
}

/**
 * A component's name, in the record's base level: after the reference to its
 * occurrence list, a few bytes, the component's GUID string, then the name.
 */
export function componentName(seg: Segment, id: number): string {
  const f = seg.frame(id);
  const end = f.base?.end ?? f.end;
  const r = new Reader(seg.bulk, f.start, end);
  let seen = false;
  while (r.pos < end) {
    const ref = refAhead(seg, r);
    if (ref !== undefined) {
      seen ||= seg.typeOf(ref)?.guid === OCCURRENCE_LIST;
      r.ref();
      continue;
    }
    if (seen && guidAt(r) !== undefined) {
      try {
        return r.wstr(1024);
      } catch {
        return '';
      }
    }
    r.pos++;
  }
  return '';
}

/** A row-major rigid 4×4 transform at a byte offset, or undefined. */
function rigidAt(view: DataView, p: number): Transform | undefined {
  const m: number[] = [];
  for (let i = 0; i < 16; i++) m.push(view.getFloat64(p + 8 * i, true));
  if (!m.every(Number.isFinite)) return undefined;
  if (m[12] !== 0 || m[13] !== 0 || m[14] !== 0 || m[15] !== 1) return undefined;
  const col = (j: number) => [m[j] as number, m[4 + j] as number, m[8 + j] as number];
  const dot = (a: number[], c: number[]) => a.reduce((s, x, i) => s + x * (c[i] as number), 0);
  const [x, y, z] = [col(0), col(1), col(2)];
  for (const [a, c, want] of [
    [x, x, 1],
    [y, y, 1],
    [z, z, 1],
    [x, y, 0],
    [y, z, 0],
    [x, z, 0],
  ] as const)
    if (Math.abs(dot(a, c) - want) > 1e-6) return undefined;
  return m;
}

/**
 * An occurrence: the first reference to a component, the u32 ordinal and two
 * GUID strings after it, then a rigid transform anywhere after them (none in
 * an unplaced occurrence).
 */
export function readOccurrence(
  seg: Segment,
  id: number,
): { component: number; occurrence: F3dOccurrence } | undefined {
  const f = seg.frame(id);
  const r = new Reader(seg.bulk, f.start, f.end);
  while (r.pos < f.end) {
    const ref = refAhead(seg, r);
    if (ref === undefined || seg.typeOf(ref)?.guid !== COMPONENT) {
      r.pos++;
      continue;
    }
    r.ref();
    // then, after a stretch that differs between generations, the ordinal and the two GUIDs
    for (let at = r.pos; at + 12 <= f.end; at++) {
      const q = new Reader(seg.bulk, at, f.end);
      const ordinal = q.u32();
      if (ordinal < 1 || ordinal > 4096 || q.peekU32() !== 36) continue;
      try {
        if (!GUID.test(q.wstr(36)) || q.peekU32() !== 36 || !GUID.test(q.wstr(36))) continue;
      } catch {
        continue;
      }
      const view = new DataView(seg.bulk.buffer, seg.bulk.byteOffset, seg.bulk.byteLength);
      let transform: Transform | undefined;
      for (let p = q.pos; p + 128 <= f.end && !transform; p++) transform = rigidAt(view, p);
      return { component: ref, occurrence: { id, ordinal, ...(transform ? { transform } : {}) } };
    }
    return undefined;
  }
  return undefined;
}

/** The design's components, and which feature lists and body containers are whose. */
export function readComponents(seg: Segment): ComponentTree {
  const components = new Map<number, F3dComponent>();
  const featureLists = new Map<number, number>();
  const bodyContainers = new Map<number, number>();
  const occurrenceLists = new Map<number, number>();
  for (const id of seg.idsOf(COMPONENT)) {
    components.set(id, {
      id,
      name: componentName(seg, id),
      root: false,
      visible: true,
      occurrences: [],
    });
    const own = levelRefs(seg, id);
    for (const history of ofType(seg, own, COMPONENT_HISTORY))
      for (const list of ofType(seg, levelRefs(seg, history), FEATURE_LIST))
        featureLists.set(list, id);
    for (const list of ofType(seg, [...own, ...baseRefs(seg, id)], OCCURRENCE_LIST))
      occurrenceLists.set(list, id);
  }
  for (const id of seg.idsOf(BODY_CONTAINER)) {
    const owner = ofType(seg, levelRefs(seg, id), COMPONENT).at(-1);
    if (owner !== undefined) bodyContainers.set(id, owner);
  }
  for (const id of seg.idsOf(OCCURRENCE)) {
    if (seg.frame(id).name === 'rootInstance') {
      const root = components.get(ofType(seg, levelRefs(seg, id), COMPONENT)[0] ?? -1);
      if (root) root.root = true;
    }
    const read = readOccurrence(seg, id);
    const component = read && components.get(read.component);
    if (!component) continue;
    component.occurrences.push(read.occurrence);
  }
  for (const [list, owner] of occurrenceLists)
    for (const occ of ofType(seg, levelRefs(seg, list), OCCURRENCE)) {
      const child = [...components.values()].find((c) => c.occurrences.some((o) => o.id === occ));
      if (child && child.id !== owner) child.parent = owner;
    }
  // A hidden-occurrence record names the occurrence's path from the root, then
  // the path again: the occurrence is the last one before the repeat (else the
  // record's first component, where the path's references are of another form).
  const byOccurrence = new Map<number, F3dComponent>();
  for (const c of components.values()) for (const o of c.occurrences) byOccurrence.set(o.id, c);
  for (const id of seg.idsOf(HIDDEN_OCCURRENCE)) {
    const refs = levelRefs(seg, id);
    const path = ofType(seg, refs, OCCURRENCE);
    const repeat = path.indexOf(path[0] as number, 1);
    const leaf = path[(repeat > 0 ? repeat : path.length) - 1];
    const hidden =
      (leaf !== undefined ? byOccurrence.get(leaf) : undefined) ??
      components.get(ofType(seg, refs, COMPONENT)[0] ?? -1);
    if (hidden && !hidden.root) hidden.visible = false;
  }
  // A hidden component hides the components inside it.
  const hiddenAbove = (c: F3dComponent, depth = 0): boolean => {
    const parent = c.parent === undefined ? undefined : components.get(c.parent);
    return !!parent && depth < 64 && (!parent.visible || hiddenAbove(parent, depth + 1));
  };
  for (const c of components.values()) if (hiddenAbove(c)) c.visible = false;
  const bodiesMadeBy = new Map<number, number[]>();
  for (const link of seg.idsOf(BODY_LINK)) {
    const refs = levelRefs(seg, link);
    const at = refs.findIndex((r) => seg.typeOf(r)?.guid === BODY);
    const body = refs[at];
    const by = refs[at + 1];
    if (at < 0 || body === undefined || by === undefined) continue;
    const list = bodiesMadeBy.get(by) ?? [];
    if (!list.includes(body)) list.push(body);
    bodiesMadeBy.set(by, list);
  }
  const all = [...components.values()];
  return {
    components: [...all.filter((c) => c.root), ...all.filter((c) => !c.root)],
    featureLists,
    bodyContainers,
    bodiesMadeBy,
  };
}

/** The component a timeline feature belongs to: its base level names the feature list. */
export function componentOfFeature(
  seg: Segment,
  tree: ComponentTree,
  id: number,
): number | undefined {
  for (const list of ofType(seg, baseRefs(seg, id), FEATURE_LIST).reverse()) {
    const owner = tree.featureLists.get(list);
    if (owner !== undefined) return owner;
  }
  return undefined;
}

/** The component a body is in: through the body container it references. */
export function componentOfBody(seg: Segment, tree: ComponentTree, id: number): number | undefined {
  for (const container of ofType(seg, levelRefs(seg, id), BODY_CONTAINER)) {
    const owner = tree.bodyContainers.get(container);
    if (owner !== undefined) return owner;
  }
  return undefined;
}

/** "Body to Component": moves bodies into another component. */
export const BODY_TO_COMPONENT = '56225BC7-69B7-446A-9AEA-6AA25BC7806E';
/**
 * A cut and paste of bodies into another component (`CutPasteBodies`): its
 * records have a Body to Component's shape, so it is read as one. It keeps
 * no history state of its own, so a missing state doesn't mean suppressed.
 */
export const CUT_PASTE_BODIES = 'BA3059E4-4B23-4D02-9D18-E7BB95C991F3';
/** The timeline items that move bodies into another component. */
export const BODY_MOVES: ReadonlySet<string> = new Set([BODY_TO_COMPONENT, CUT_PASTE_BODIES]);

/**
 * One "Body to Component": the bodies it takes (body records, in the component
 * they were made in), the body records it makes in the target component, and
 * that component.
 */
export interface F3dBodyMove {
  /** The timeline item. */
  id: number;
  sources: number[];
  made: number[];
  target?: number;
}

/**
 * Reads a "Body to Component" item. The bodies it takes are named by body
 * operands (`9716F783…` → body link `D26351F0…` → body); the bodies it makes
 * are those whose body link names the item, or one of its own records, as
 * the feature that made them. The target is the component those are in.
 */
export function readBodyMove(seg: Segment, tree: ComponentTree, id: number): F3dBodyMove {
  const own = new Set([id, ...levelRefs(seg, id), ...baseRefs(seg, id)]);
  const sources: number[] = [];
  for (const operand of new Set(ofType(seg, levelRefs(seg, id), BODY_OPERAND)))
    for (const link of new Set(ofType(seg, levelRefs(seg, operand), BODY_LINK)))
      for (const body of ofType(seg, levelRefs(seg, link), BODY).slice(0, 1))
        if (!sources.includes(body)) sources.push(body);
  const made: number[] = [];
  for (const by of own)
    for (const body of tree.bodiesMadeBy.get(by) ?? [])
      if (!sources.includes(body) && !made.includes(body)) made.push(body);
  const target = made.map((b) => componentOfBody(seg, tree, b)).find((c) => c !== undefined);
  return { id, sources, made, ...(target !== undefined ? { target } : {}) };
}
