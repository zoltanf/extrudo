/**
 * Compounds at the top (P6-25 S12b, ADR-0144): a `Part::Compound` that is a
 * final shape comes in as its members, through nested compounds, each as it
 * would at the document's top (a body or a row of features with its history,
 * a Part tree through S11, a plain shape as an `import`). The plan here is
 * from the file alone and iterative; `import.ts` hands the members to the
 * body walk, the trees and the shapes import, and `placeCompounds` then
 * places them as the compound does and checks them together against the
 * compound's stored shape, in one transaction. A compound whose members
 * don't hold comes in as today: its stored shape, one `import`.
 */
import type { Design } from '@extrudo/api';
import { moveInputs } from '@extrudo/core';
import type { KernelBudget } from './budget';
import { combined, HISTORY_BOX_TOLERANCE, HISTORY_VOLUME_TOLERANCE } from './check';
import { consumersOf, type FinalShape, invert, placement, storedSolid } from './final-shapes';
import type { ImportKernel, ShapeMeasure } from './import-kernel';
import { append } from './lists';
import { type FcDocument, type FcObject, type FcPlacement, storedShapeEntry } from './model';
import { cleanName } from './names';
import { moveFor } from './part-import';
import { isIdentity } from './part-tree';
import { saneMeasure } from './shapes';
import { compose, containerChain } from './sketch-place';
import type { Stopped, StructureBuild } from './structure-build';

/** The most objects one compound's members may reach, nested compounds included. */
export const MAX_COMPOUND_OBJECTS = 1_000;

/** Why a compound comes in as today. */
export type CompoundReason =
  /** A member another object uses as well. */
  | 'shared'
  /** One object twice among its members, or a compound inside itself. */
  | 'repeated'
  /** A member it names isn't in the file. */
  | 'missing'
  /** A member of a kind this slice doesn't bring in on its own (a link). */
  | 'member'
  /** A member in other containers than the compound. */
  | 'container'
  /** No member holds a solid. */
  | 'empty'
  /** Past `MAX_COMPOUND_OBJECTS`. */
  | 'limit'
  /** A member didn't come in, or came in as more or fewer bodies than it should. */
  | 'incomplete'
  /** The members' bodies together aren't the compound's stored shape. */
  | 'check'
  /** The kernel failed or the time ran out. */
  | 'kernel';

export interface CompoundPlan {
  readonly compound: FinalShape;
  /** The members that hold a solid, as final shapes of their own, in order. */
  readonly members: readonly FinalShape[];
  /**
   * Each member's placement beyond its own, from the compounds above it
   * (outermost first, the top compound's own first): what places it where the
   * compound shows it, within the compound's containers.
   */
  readonly placed: ReadonlyMap<string, FcPlacement>;
  /** Members that hold no solid (sketches, wires, 2D objects): they give nothing. */
  readonly withoutSolid: number;
  /** Nested compounds walked through. */
  readonly nested: number;
}

export type CompoundRefusal = {
  readonly compound: FinalShape;
  readonly reason: CompoundReason;
  readonly detail: string;
};

export interface CompoundImport {
  readonly object: string;
  readonly name: string;
  /** `members`: its members came in on their own; `today`: its stored shape, as before. */
  readonly outcome: 'members' | 'today';
  readonly reason?: CompoundReason;
  readonly detail?: string;
  /** The members that hold a solid, and the bodies they came in as. */
  readonly members: readonly string[];
  readonly bodies: readonly string[];
  /** The moves that place the members as the compound does. */
  readonly moves: readonly string[];
  readonly withoutSolid: number;
  readonly nested: number;
}

const IDENTITY: FcPlacement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
const NEVER_A_MEMBER = ['Sketcher::', 'App::', 'Spreadsheet::', 'TechDraw::', 'Fem::'];

/**
 * The compounds among `shapes` (S3's kind `shape` whose object is a
 * `Part::Compound`), each with its members or why it stays as today.
 * `isLoose` tells a PartDesign feature that is in no body (S12a).
 */
export function planCompounds(
  doc: FcDocument,
  shapes: readonly FinalShape[],
  isLoose: (o: FcObject) => boolean,
  maxObjects = MAX_COMPOUND_OBJECTS,
): (CompoundPlan | CompoundRefusal)[] {
  const out: (CompoundPlan | CompoundRefusal)[] = [];
  for (const shape of shapes) {
    if (shape.kind !== 'shape' || shape.object.type !== 'Part::Compound') continue;
    out.push(plan(shape));
  }
  return out;

  /**
   * Whether a member stores a solid, noting nothing on `doc.problems`: a member whose entry can't
   * be read gives nothing, and the compound's own shape (which comes in then) is what the report
   * speaks of.
   */
  function holdsSolid(m: FcObject): boolean {
    const entry = storedShapeEntry(doc, m);
    if (entry === undefined) return false;
    const found = storedSolid(doc, entry);
    return found === 'solid' || found === 'too-large';
  }

  function plan(compound: FinalShape): CompoundPlan | CompoundRefusal {
    const refuse = (reason: CompoundReason, detail: string): CompoundRefusal => ({
      compound,
      reason,
      detail,
    });
    const top = compound.object;
    const frame = containerChain(doc, top);
    if (!frame) return refuse('container', 'its containers hold each other in a loop');
    const members: FinalShape[] = [];
    const placed = new Map<string, FcPlacement>();
    const compounds = new Set<string>([top.name]);
    const seen = new Set<string>([top.name]);
    let withoutSolid = 0;
    let nested = 0;
    // Iterative, in the file's order: each entry a compound and its members' placement so far.
    const stack: { o: FcObject; place: FcPlacement; at: number }[] = [
      { o: top, place: placement(top) ?? IDENTITY, at: 0 },
    ];
    let visited = 0;
    while (stack.length > 0) {
      const frameOf = stack[stack.length - 1] as (typeof stack)[number];
      const links = frameOf.o.properties.Links?.value;
      const names = links?.kind === 'linkList' ? links.objects : [];
      if (frameOf.at >= names.length) {
        stack.pop();
        continue;
      }
      const name = names[frameOf.at++] as string;
      if (++visited > maxObjects)
        return refuse('limit', `its members reach more than ${maxObjects} objects`);
      const m = doc.byName.get(name);
      if (!m) return refuse('missing', `${name}, which it holds, isn't in the file`);
      if (seen.has(m.name))
        return refuse(
          'repeated',
          compounds.has(m.name) ? `it holds itself through ${m.name}` : `it holds ${m.name} twice`,
        );
      seen.add(m.name);
      // Used by anything outside this compound's own nesting: that use would lose it.
      // The first such use is enough: the list isn't walked past it.
      const other = consumersOf(doc, m.name).find((u) => !compounds.has(u));
      if (other !== undefined)
        return refuse('shared', `${cleanName(m.label, m.name)} is used by ${other} too`);
      const t = m.type;
      if (t === 'Part::Compound') {
        compounds.add(m.name);
        nested++;
        stack.push({ o: m, place: compose(frameOf.place, placement(m) ?? IDENTITY), at: 0 });
        continue;
      }
      if (t === 'App::Link' || t === 'App::LinkElement')
        return refuse('member', `${cleanName(m.label, m.name)} is a link`);
      if (t === 'Mesh::Feature' || NEVER_A_MEMBER.some((x) => t.startsWith(x))) {
        withoutSolid++;
        continue;
      }
      const kind: FinalShape['kind'] | undefined =
        t === 'PartDesign::Body'
          ? 'body'
          : t.startsWith('PartDesign::')
            ? isLoose(m)
              ? 'chain-tip'
              : undefined
            : holdsSolid(m)
              ? 'shape'
              : undefined;
      if (kind === undefined) {
        withoutSolid++;
        continue;
      }
      const own = containerChain(doc, m);
      if (!own || !sameChain(own.chain, frame.chain))
        return refuse('container', `${cleanName(m.label, m.name)} is in other containers`);
      const look = m.gui?.colour ? m.gui : compound.object.gui;
      members.push({
        kind,
        object: m,
        source: m,
        entry: storedShapeEntry(doc, m),
        format: 'brep',
        name: m.label,
        visible: compound.visible,
        ...(look?.colour ? { colour: look.colour } : {}),
        ...(look?.transparency !== undefined ? { transparency: look.transparency } : {}),
        chain: compound.chain,
      });
      placed.set(m.name, frameOf.place);
    }
    if (members.length === 0) return refuse('empty', 'none of its members holds a solid');
    return { compound, members, placed, withoutSolid, nested };
  }
}

const sameChain = (a: readonly FcPlacement[], b: readonly FcPlacement[]) =>
  isIdentity(compose(invert(flatten(a)), flatten(b)));

/** A chain (outermost first) as one placement. */
export function flatten(chain: readonly FcPlacement[]): FcPlacement {
  let out = IDENTITY;
  for (let i = chain.length - 1; i >= 0; i--) out = compose(chain[i] as FcPlacement, out);
  return out;
}

const relative = (a: number, b: number) => {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale === 0 ? 0 : Math.abs(a - b) / scale;
};

/** Why the members' bodies together aren't the compound's stored shape: solids, volume and box (S5's tolerances). */
export function compoundDisagreement(got: ShapeMeasure, stored: ShapeMeasure): string | undefined {
  if (got.solids !== stored.solids)
    return `${stored.solids} solid${stored.solids === 1 ? '' : 's'} stored, ${got.solids} from the members`;
  const volume = relative(got.volume, stored.volume);
  if (!(volume <= HISTORY_VOLUME_TOLERANCE))
    return `the volume differs by ${(volume * 100).toPrecision(2)} %`;
  const s = stored.box;
  const diagonal = Math.hypot(...s.max.map((v, i) => v - (s.min[i] as number)));
  const corners = [...s.min, ...s.max];
  const after = [...got.box.min, ...got.box.max];
  const moved = Math.max(...corners.map((v, i) => Math.abs(v - (after[i] as number))));
  if (!(moved <= HISTORY_BOX_TOLERANCE * diagonal + 1e-6))
    return `the bounding box differs by ${moved.toPrecision(3)} mm`;
  return undefined;
}

/**
 * Places a compound's members as the compound does (one `move` for each
 * placement beyond their own, about their box centre) and checks all their
 * bodies together against the compound's stored shape, in one transaction.
 */
export async function placeCompound(
  plan: CompoundPlan,
  bodiesOf: ReadonlyMap<string, readonly string[]>,
  design: Design,
  build: StructureBuild,
  budget: KernelBudget,
  storedText: (o: FcObject) => string | undefined,
): Promise<{ moves: string[]; bodies: string[] } | (Stopped & { reason: CompoundReason })> {
  const c = plan.compound;
  const bodies = plan.members.flatMap((m) => bodiesOf.get(m.object.name) ?? []);
  const missing = plan.members.find((m) => (bodiesOf.get(m.object.name) ?? []).length === 0);
  if (missing)
    return {
      stop: 'check',
      reason: 'incomplete',
      detail: `${cleanName(missing.name, missing.object.name)} didn't come in`,
    };
  const text = storedText(c.object);
  if (text === undefined)
    return { stop: 'check', reason: 'incomplete', detail: "its stored shape can't be read" };
  const stored = await budget.call(
    () => (budget.kernel as ImportKernel).measureStoredShape(text, c.chain),
    saneMeasure,
  );
  if (stored.kind !== 'done')
    return {
      stop: stored.kind,
      reason: 'kernel',
      ...('detail' in stored && stored.detail ? { detail: stored.detail } : {}),
    };
  // The members' placements beyond their own, grouped: one move each.
  const frame = flatten(c.chain);
  const groups = new Map<string, { place: FcPlacement; bodies: string[] }>();
  for (const m of plan.members) {
    const extra = plan.placed.get(m.object.name) ?? IDENTITY;
    if (isIdentity(extra)) continue;
    const key = JSON.stringify(extra);
    const g = groups.get(key) ?? { place: extra, bodies: [] };
    append(g.bodies, bodiesOf.get(m.object.name) ?? []);
    groups.set(key, g);
  }
  // Pivots: a free move turns about the box centre of the bodies it moves.
  const live = await build.live();
  if ('stop' in live) return { ...live, reason: 'kernel' };
  const unmeasured = bodies.filter((id) => build.measure(id) === undefined);
  if (unmeasured.length > 0) {
    const again = await build.remeasure(unmeasured);
    if (again) return { ...again, reason: 'kernel' };
  }
  const label = cleanName(c.name, c.object.name);
  const tried = await build.attempt(
    `Place ${label}`,
    () => {
      const moves: string[] = [];
      for (const g of groups.values()) {
        const ms = g.bodies.map((id) => build.measure(id));
        if (ms.some((m) => m === undefined))
          return { stop: 'kernel', detail: "the kernel didn't measure every body" } as Stopped;
        const box = combined(ms as ShapeMeasure[]).box;
        const pivot = [0, 1, 2].map((i) => ((box.min[i] as number) + (box.max[i] as number)) / 2);
        // In the containers' frame the compound's placement acts on its members: F·P·F⁻¹ in world terms.
        const world = compose(compose(frame, g.place), invert(frame));
        const move = design.add(
          'move',
          moveInputs(g.bodies, moveFor(world, pivot as [number, number, number])),
          { name: `Place ${label}` },
        );
        moves.push(move.id);
      }
      return { value: moves };
    },
    () => {
      const ms = bodies.map((id) => build.measure(id));
      if (ms.some((m) => m === undefined)) return "the kernel didn't measure every body";
      return compoundDisagreement(combined(ms as ShapeMeasure[]), stored.value);
    },
    bodies,
  );
  if ('stop' in tried) return { ...tried, reason: tried.stop === 'check' ? 'check' : 'kernel' };
  return { moves: tried.value, bodies };
}
