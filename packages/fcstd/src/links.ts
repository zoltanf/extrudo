/**
 * Links as copies (P6-25 S12b, ADR-0144). Where what an `App::Link` shows
 * came into the design as bodies, the link is a `move` with `copy` over those
 * bodies, placed by the transform from where they are to where the link shows
 * them, so the copy follows every edit of what it copies. A link array is one
 * copy an element; a link to an `App::Part` copies every body of the part.
 * Each copy is checked against the stored shape it shows (what S3 bakes into
 * a STEP), in a transaction of its own; a link that doesn't hold comes in as
 * S3 brought it. The plan (`planLink`) is from the file alone and iterative.
 */
import type { Design } from '@extrudo/api';
import { moveInputs } from '@extrudo/core';
import { combined } from './check';
import { flatten } from './compounds';
import {
  type FinalShape,
  invert,
  isLink,
  linkPlacement,
  linkTarget,
  MAX_LINK_HOPS,
  placement,
} from './final-shapes';
import type { ShapeMeasure } from './import-kernel';
import type { FcDocument, FcObject, FcPlacement } from './model';
import { cleanName } from './names';
import { moveFor } from './part-import';
import { disagreement, setBodies } from './shapes';
import { compose, containerChain } from './sketch-place';
import type { Stopped, StructureBuild } from './structure-build';

/** The most elements one array expands to (arrays of arrays multiply). */
export const MAX_ARRAY_ELEMENTS = 1_000;
/** The most copies the links of one import make. */
export const MAX_LINK_COPIES = 2_000;
/** The farthest a placement may move anything, mm (10 km, S11's limit). */
const MAX_DISTANCE = 1e7;

export type LinkReason =
  /** It scales what it shows: left out (S3 baked it at the wrong size). */
  | 'scaled'
  /** What it links to didn't come into the design as bodies. */
  | 'target'
  /** A link array whose elements can't be read (a list that doesn't parse or match its count). */
  | 'array'
  /** Past `MAX_ARRAY_ELEMENTS` or `MAX_LINK_COPIES`. */
  | 'limit'
  /** Elements that show different objects. */
  | 'mixed'
  /** A part that holds a link back to itself, directly or through others. */
  | 'cycle'
  /** The copy didn't measure as the stored shape the link shows. */
  | 'check'
  /** The kernel failed, or the time ran out. */
  | 'kernel'
  /** S3's own problems: a link to nothing, to itself, through too many links. */
  | 'broken';

export interface LinkImport {
  readonly object: string;
  readonly name: string;
  /** `copy`: copies of what came in; `today`: S3's `import` (or left out as S3 left it); `left-out`: scaled. */
  readonly outcome: 'copy' | 'today' | 'left-out';
  readonly reason?: LinkReason;
  readonly detail?: string;
  /** What the link shows, through further links. */
  readonly target?: string;
  /** The final shapes whose bodies were copied (the target, or a part's shapes). */
  readonly sources?: readonly string[];
  /** The moves (one per element) and the copies they make. */
  readonly moves: readonly string[];
  readonly bodies: readonly string[];
  /** For an array: its elements, and whether they came in one copy each. */
  readonly array?: { readonly elements: number; readonly expanded: boolean };
  /** A link to a part: its copies form a component of their own. */
  readonly part?: true;
}

export interface LinkPlan {
  readonly link: FinalShape;
  readonly target: FcObject;
  /** One chain per instance, outermost first: what places the target's stored shape where the link shows it. */
  readonly instances: readonly (readonly FcPlacement[])[];
  readonly array?: { readonly elements: number };
}

export interface LinkRefusal {
  readonly link: FinalShape;
  readonly reason: LinkReason;
  readonly detail: string;
  readonly array?: { readonly elements: number };
}

const IDENTITY: FcPlacement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };

/** Whether an object scales what it shows (a scale that isn't 1, or one the reader couldn't read). */
function scales(o: FcObject): boolean {
  if (o.unreadable?.some((p) => p === 'Scale' || p === 'ScaleVector')) return true;
  const s = o.properties.Scale?.value;
  if (s && (s.kind === 'float' || s.kind === 'integer') && s.value !== 1) return true;
  const v = o.properties.ScaleVector?.value;
  return v?.kind === 'vector' && v.value.some((x) => x !== 1);
}

/** The bytes of a list property stored as its own entry (`PlacementList`, `ScaleList`). */
function listEntry(doc: FcDocument, o: FcObject, name: string): Uint8Array | undefined {
  const v = o.properties[name]?.value;
  if (v?.kind !== 'file' || !v.entry) return undefined;
  return doc.entries.get(v.entry);
}

const sane = (p: FcPlacement) =>
  [...p.position, ...p.rotation].every(Number.isFinite) &&
  p.position.every((x) => Math.abs(x) <= MAX_DISTANCE);

/**
 * A placement list entry (FORMAT.md): a `uint32` count, then seven numbers
 * each, double (or, marked so, single) precision. `undefined` when it doesn't
 * hold exactly `count` finite placements with a rotation.
 */
export function readPlacementList(bytes: Uint8Array, count: number): FcPlacement[] | undefined {
  if (bytes.length < 4) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = view.getUint32(0, true);
  if (n !== count) return undefined;
  const size = bytes.length === 4 + 56 * n ? 8 : bytes.length === 4 + 28 * n ? 4 : 0;
  if (size === 0 || n === 0) return undefined;
  const out: FcPlacement[] = [];
  for (let i = 0; i < n; i++) {
    const at = 4 + 7 * size * i;
    const v = Array.from({ length: 7 }, (_, k) =>
      size === 8 ? view.getFloat64(at + 8 * k, true) : view.getFloat32(at + 4 * k, true),
    );
    const q = v.slice(3);
    const norm = Math.hypot(...q);
    if (!Number.isFinite(norm) || norm < 1e-9) return undefined;
    const p: FcPlacement = {
      position: [v[0] as number, v[1] as number, v[2] as number],
      rotation: q.map((x) => x / norm) as unknown as FcPlacement['rotation'],
    };
    if (!sane(p)) return undefined;
    out.push(p);
  }
  return out;
}

/** Whether a scale list entry holds `count` scales of exactly 1 (a missing or empty entry is no scale). */
export function scaleListIsOne(bytes: Uint8Array | undefined, count: number): boolean | undefined {
  if (!bytes || bytes.length === 0) return true;
  if (bytes.length < 4) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = view.getUint32(0, true);
  if (n === 0 && bytes.length === 4) return true;
  if (n !== count || bytes.length !== 4 + 24 * n) return undefined;
  for (let i = 0; i < 3 * n; i++) if (view.getFloat64(4 + 8 * i, true) !== 1) return false;
  return true;
}

/**
 * What a link shows, as instances of one target, or why it can't be copied.
 * Follows `LinkedObject` through further links (at most `MAX_LINK_HOPS` on
 * each path) and expands arrays: by their `App::LinkElement`s when the array
 * shows them, else by the placement list; arrays of arrays multiply, bounded
 * by `maxElements` and `maxCopies` before anything is expanded past them.
 * The chains follow S3's rule: the link's placement, then, when the link
 * replaces its target's placement, the inverse of the target's.
 */
export function planLink(
  doc: FcDocument,
  link: FinalShape,
  maxElements = MAX_ARRAY_ELEMENTS,
  maxCopies = MAX_LINK_COPIES,
): LinkPlan | LinkRefusal {
  const o = link.object;
  const top = o.properties.ElementCount?.value;
  const elements = top?.kind === 'integer' && top.value > 0 ? top.value : undefined;
  const array = elements !== undefined ? { array: { elements } } : {};
  const refuse = (reason: LinkReason, detail: string): LinkRefusal => ({
    link,
    reason,
    detail,
    ...array,
  });
  // S3's containers: a loop of containers leaves them out (S3 noted the problem).
  const containers = containerChain(doc, o)?.chain ?? [];
  type Step = {
    at: FcObject;
    chain: readonly FcPlacement[];
    hops: number;
    path: ReadonlySet<string>;
  };
  const work: Step[] = [{ at: o, chain: containers, hops: 0, path: new Set([o.name]) }];
  const instances: FcPlacement[][] = [];
  let target: FcObject | undefined;
  let planned = 1;
  while (work.length > 0) {
    const step = work.pop() as Step;
    const c = step.at;
    if (!isLink(c)) {
      if (target && target.name !== c.name)
        return refuse('mixed', `its elements show ${target.name} and ${c.name}`);
      target = c;
      instances.push([...step.chain]);
      continue;
    }
    if (step.hops >= MAX_LINK_HOPS)
      return refuse('broken', `a link through more than ${MAX_LINK_HOPS} links`);
    if (scales(c)) return refuse('scaled', `${c.name} scales what it shows`);
    const count = c.properties.ElementCount?.value;
    const n =
      c.type === 'App::Link' && count?.kind === 'integer' && count.value > 0 ? count.value : 0;
    const next = (from: FcObject, chain: FcPlacement[]): Step | LinkRefusal => {
      const { target: name, keep } = linkTarget(from);
      const t = name === undefined ? undefined : doc.byName.get(name);
      if (!t)
        return refuse(
          'broken',
          name === undefined
            ? 'a link to nothing in this file'
            : `a link to ${name}, which isn't in the file`,
        );
      if (step.path.has(t.name)) return refuse('broken', 'links that lead back to themselves');
      if (!keep) chain.push(invert(isLink(t) ? linkPlacement(t) : (placement(t) ?? IDENTITY)));
      return { at: t, chain, hops: step.hops + 1, path: new Set([...step.path, t.name]) };
    };
    if (n === 0) {
      const s = next(c, [...step.chain, linkPlacement(c)]);
      if ('reason' in s) return s;
      work.push(s);
      continue;
    }
    // An array: each element on top of the array's own placement.
    if (n > maxElements)
      return refuse('limit', `an array of ${n} elements; at most ${maxElements} come in`);
    planned = planned - 1 + n;
    if (planned > maxCopies) return refuse('limit', `more than ${maxCopies} copies`);
    const base = [...step.chain, linkPlacement(c)];
    const shown = c.properties.ShowElement?.value;
    const list = c.properties.ElementList?.value;
    const objects = list?.kind === 'linkList' ? list.objects : [];
    const steps: Step[] = [];
    if (shown?.kind === 'bool' && shown.value && objects.length > 0) {
      if (objects.length !== n)
        return refuse('array', `it lists ${objects.length} elements where it counts ${n}`);
      for (const name of objects) {
        const e = doc.byName.get(name);
        if (!e || e.type !== 'App::LinkElement')
          return refuse('array', `its element ${name} isn't a link element`);
        if (step.path.has(e.name)) return refuse('broken', 'links that lead back to themselves');
        steps.push({
          at: e,
          chain: base,
          hops: step.hops + 1,
          path: new Set([...step.path, e.name]),
        });
      }
    } else {
      const bytes = listEntry(doc, c, 'PlacementList');
      const places = bytes ? readPlacementList(bytes, n) : undefined;
      if (!places) return refuse('array', "its placement list can't be read");
      const one = scaleListIsOne(listEntry(doc, c, 'ScaleList'), n);
      if (one === undefined) return refuse('array', "its scale list can't be read");
      if (!one) return refuse('scaled', `${c.name} scales its elements`);
      for (const p of places) {
        const s = next(c, [...base, p]);
        if ('reason' in s) return s;
        steps.push(s);
      }
    }
    // In order: the first element is the first copy.
    for (let i = steps.length - 1; i >= 0; i--) work.push(steps[i] as Step);
  }
  if (!target) return refuse('broken', 'a link to nothing in this file');
  return { link, target, instances, ...array };
}

/** Why a copy isn't what the link shows: S3's check (solids, volume, box) and the centre of mass. */
export function copyDisagreement(got: ShapeMeasure, expected: ShapeMeasure): string | undefined {
  const wrong = disagreement(expected, got);
  if (wrong) return wrong;
  const s = expected.box;
  const diagonal = Math.hypot(...s.max.map((v, i) => v - (s.min[i] as number)));
  const off = Math.hypot(...expected.centre.map((v, i) => v - (got.centre[i] as number)));
  if (!(off <= 1e-4 * diagonal + 1e-6))
    return `the centre of mass is ${off.toPrecision(3)} mm away`;
  return undefined;
}

export interface CopyContext {
  readonly design: Design;
  readonly build: StructureBuild;
  /** Where the target's bodies stand: the containers' chain of the object they came from. */
  readonly frameOf: (target: FcObject) => readonly FcPlacement[] | undefined;
  /** What the target shows placed by `chain`: its stored shape measured (combined over a part's shapes). */
  readonly expected: (
    target: FcObject,
    chain: readonly FcPlacement[],
  ) => Promise<ShapeMeasure | Stopped>;
}

/** Copies the target's bodies once per instance and checks each copy, in one transaction. */
export async function copyLink(
  plan: LinkPlan,
  sources: readonly string[],
  ctx: CopyContext,
): Promise<{ moves: string[]; bodies: string[] } | (Stopped & { reason: LinkReason })> {
  const { design, build } = ctx;
  const frame = ctx.frameOf(plan.target);
  if (!frame)
    return { stop: 'check', reason: 'target', detail: 'its containers hold each other in a loop' };
  const expected: ShapeMeasure[] = [];
  for (const chain of plan.instances) {
    const m = await ctx.expected(plan.target, chain);
    if ('stop' in m) return { ...m, reason: m.stop === 'check' ? 'target' : 'kernel' };
    expected.push(m);
  }
  const unmeasured = sources.filter((id) => build.measure(id) === undefined);
  if (unmeasured.length > 0) {
    const again = await build.remeasure(unmeasured);
    if (again) return { ...again, reason: 'kernel' };
  }
  const ms = sources.map((id) => build.measure(id));
  if (ms.some((m) => m === undefined))
    return { stop: 'kernel', reason: 'kernel', detail: "the kernel didn't measure every body" };
  const box = combined(ms as ShapeMeasure[]).box;
  const pivot = [0, 1, 2].map((i) => ((box.min[i] as number) + (box.max[i] as number)) / 2) as [
    number,
    number,
    number,
  ];
  const back = invert(flatten(frame));
  const label = cleanName(plan.link.name, plan.link.object.name);
  const tried = await build.attempt(
    `Import ${label}`,
    () => {
      const moves = plan.instances.map((chain, i) => {
        // From where the target's bodies are to where the link shows them: C · F⁻¹.
        const t = compose(flatten(chain), back);
        return design.add('move', moveInputs(sources, { ...moveFor(t, pivot), copy: true }), {
          name: i === 0 ? label : `${label} ${i + 1}`,
        }).id as string;
      });
      return { value: moves };
    },
    (fresh, moves) => {
      const all: string[] = [];
      for (const [i, move] of moves.entries()) {
        const copies = fresh.filter((id) => id.startsWith(`${move}:`));
        const got = copies.map((id) => build.measure(id));
        if (copies.length !== sources.length || got.some((m) => m === undefined))
          return `${copies.length} copies of ${sources.length} bodies`;
        const wrong = copyDisagreement(
          combined(got as ShapeMeasure[]),
          expected[i] as ShapeMeasure,
        );
        if (wrong) return plan.instances.length > 1 ? `element ${i + 1}: ${wrong}` : wrong;
        all.push(...copies);
      }
      setBodies(design, all, plan.link, label);
      return undefined;
    },
  );
  if ('stop' in tried) return { ...tried, reason: tried.stop === 'check' ? 'check' : 'kernel' };
  const bodies = tried.fresh.filter((id) => tried.value.some((m) => id.startsWith(`${m}:`)));
  return { moves: tried.value, bodies };
}
