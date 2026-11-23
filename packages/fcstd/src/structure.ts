/**
 * What a FreeCAD document has around its shapes (P6-25 S12b, ADR-0144), once the bodies, the
 * trees and the shapes import are in: compounds at the top as their members, meshes as mesh
 * bodies, links as copies of what their targets became. The shapes import has already made the
 * STEP of every link and compound tried here (`ShapeImportOptions.defer`), so what doesn't hold
 * comes in as S3 brought it from those bytes, with no kernel call and no budget these attempts
 * used. Each attempt is checked in a transaction of its own (`structure-build.ts`); a compound's
 * members are walked inside one more, which a compound that doesn't hold cancels whole.
 * `bodies` is the one record of which bodies each final shape came in as, kept up to date here
 * and read by the components after it.
 */
import type { Design } from '@extrudo/api';
import type { AttachmentId } from '@extrudo/core';
import { storedText } from './bodies';
import type { KernelBudget } from './budget';
import { combined } from './check';
import { partsAround } from './components';
import {
  type CompoundImport,
  type CompoundPlan,
  type CompoundReason,
  type CompoundRefusal,
  flatten,
  placeCompound,
} from './compounds';
import {
  type FinalShape,
  isLink,
  linkTarget,
  MAX_LINK_HOPS,
  placement,
  rotate,
} from './final-shapes';
import type { BodyImport } from './import';
import type { ShapeMeasure } from './import-kernel';
import {
  copyLink,
  type LinkImport,
  type LinkReason,
  MAX_LINK_COPIES,
  MAX_PART_MEMBERS,
  planLink,
} from './links';
import { type MeshFacts, type MeshKernel, meshFacts } from './mesh-read';
import { importMeshes, type MeshImport } from './meshes';
import { type FcDocument, type FcObject, type FcPlacement, storedShapeEntry } from './model';
import { cleanName } from './names';
import type { TreeImport } from './part-import';
import { MAX_OPERAND_BODIES } from './part-import';
import { type ImportedShape, type LeftOutShape, saneMeasure } from './shapes';
import { containerChain } from './sketch-place';
import type { Stopped, StructureBuild } from './structure-build';

/** The most stored-shape text the links' checks keep decoded at once (each entry decoded once while it fits). */
const MAX_TEXT_CACHE = 64 * 1024 * 1024;

export interface StructureOptions {
  readonly maxMeshFacets?: number;
  readonly maxMeshes?: number;
  readonly maxImportMeshFacets?: number;
  readonly maxAttachmentsBytes?: number;
  readonly maxArrayElements?: number;
  readonly maxLinkCopies?: number;
  /** `MAX_PART_MEMBERS` and the bodies one copy may take (S11's `MAX_OPERAND_BODIES`), for tests. */
  readonly maxPartMembers?: number;
  readonly maxCopySources?: number;
  readonly onStep?: () => void;
}

/** What walking a compound's members brought, each member as a final shape of its own. */
export interface MemberWalk {
  readonly bodies: ReadonlyMap<string, readonly string[]>;
  readonly partial: ReadonlyMap<string, readonly string[]>;
  readonly histories: readonly BodyImport[];
  readonly trees: readonly TreeImport[];
  readonly imported: readonly ImportedShape[];
  readonly leftOut: readonly LeftOutShape[];
  readonly files: ReadonlyMap<AttachmentId, Uint8Array>;
}

export interface StructureHooks {
  /** Walks members as final shapes of their own (bodies, trees, shapes import), in the open transaction. */
  walkMembers(members: readonly FinalShape[]): Promise<MemberWalk>;
  /** Remembers the walks' counters and the binder; what it returns takes back what a cancelled walk counted. */
  mark(): () => void;
}

export interface StructureResult {
  readonly meshes: MeshImport[];
  readonly compounds: CompoundImport[];
  readonly links: LinkImport[];
  /** Final shapes to add as S3 does, from the STEP the shapes import made: compounds and links that didn't hold. */
  readonly fallback: ReadonlySet<string>;
  /** Links left out (a scaled link: S3 brought it in at the wrong size). */
  readonly scaled: LinkImport[];
  /** What the members of the compounds that came in brought. */
  readonly members: readonly MemberWalk[];
}

export interface StructureContext {
  readonly doc: FcDocument;
  readonly shapes: readonly FinalShape[];
  readonly compounds: readonly (CompoundPlan | CompoundRefusal)[];
  readonly design: Design;
  readonly build: StructureBuild;
  readonly budget: KernelBudget;
  /** Final shape (or member) → the bodies it came in as; updated. */
  readonly bodies: Map<string, string[]>;
  /** A body's that stopped part way; updated. */
  readonly partial: Map<string, string[]>;
  readonly hooks: StructureHooks;
  /** The links' and compounds' STEP the shapes import made and holds (`DeferredShapes`). */
  readonly held: { held(): number; release(objects: Iterable<string>): void };
  readonly options?: StructureOptions;
}

const budgetGone = (budget: KernelBudget) =>
  budget.broken
    ? 'the geometry kernel failed too often'
    : budget.left() <= 0
      ? 'the import ran out of time'
      : undefined;

/** Compounds, then meshes, then links, each in document order (links to parts after the links inside them). */
export async function placeStructure(ctx: StructureContext): Promise<StructureResult> {
  const { doc, shapes, design, build, budget, bodies, partial, hooks } = ctx;
  const options = ctx.options ?? {};
  const fallback = new Set<string>();

  // Stored shapes' text, each entry decoded once while the cache has room.
  const texts = new Map<string, string>();
  let textBytes = 0;
  const textOf = (o: FcObject): string | undefined => {
    const entry = storedShapeEntry(doc, o);
    if (entry === undefined) return undefined;
    const known = texts.get(entry);
    if (known !== undefined) return known;
    const t = storedText(doc, o);
    if (!('text' in t)) return undefined;
    if (t.text.length <= MAX_TEXT_CACHE) {
      while (textBytes + t.text.length > MAX_TEXT_CACHE && texts.size > 0) {
        const [oldest, text] = texts.entries().next().value as [string, string];
        texts.delete(oldest);
        textBytes -= text.length;
      }
      texts.set(entry, t.text);
      textBytes += t.text.length;
    }
    return t.text;
  };

  // --- Compounds: the members walked and placed in one transaction, cancelled whole if they don't hold.
  const compoundOut: CompoundImport[] = [];
  const memberWalks: MemberWalk[] = [];
  for (const plan of ctx.compounds) {
    const c = plan.compound;
    const name = cleanName(c.name, c.object.name);
    const record = (rest: Partial<CompoundImport> & Pick<CompoundImport, 'outcome'>) =>
      compoundOut.push({
        object: c.object.name,
        name,
        members: 'members' in plan ? plan.members.map((m) => m.object.name) : [],
        bodies: [],
        moves: [],
        withoutSolid: 'members' in plan ? plan.withoutSolid : 0,
        nested: 'members' in plan ? plan.nested : 0,
        ...rest,
      });
    // Refused from the file alone: it came in through the shapes import already.
    if ('reason' in plan) {
      record({ outcome: 'today', reason: plan.reason, detail: plan.detail });
      continue;
    }
    const gone = budgetGone(budget);
    if (gone) {
      fallback.add(c.object.name);
      record({ outcome: 'today', reason: 'kernel', detail: gone });
      continue;
    }
    const restore = hooks.mark();
    design.state.beginTransaction(`Import ${name}`);
    let kept: { walk: MemberWalk; moves: string[]; bodies: string[] } | undefined;
    let failure: { reason: CompoundReason; detail?: string } = { reason: 'kernel' };
    try {
      const walk = await hooks.walkMembers(plan.members);
      build.forget();
      const merged = new Map<string, readonly string[]>(bodies);
      for (const [k, v] of walk.bodies) merged.set(k, v);
      const placed = await placeCompound(plan, merged, design, build, budget, textOf);
      if ('moves' in placed) kept = { walk, ...placed };
      else failure = { reason: placed.reason, ...(placed.detail ? { detail: placed.detail } : {}) };
    } catch (error) {
      failure = { reason: 'kernel', detail: (error as Error)?.message ?? String(error) };
    } finally {
      if (kept) design.state.commitTransaction();
      else {
        // Nothing of the attempt stays: features, sketches, planes, attachments, bindings.
        design.state.cancelTransaction();
        restore();
        build.forget();
      }
    }
    if (!kept) {
      fallback.add(c.object.name);
      record({ outcome: 'today', ...failure });
      continue;
    }
    for (const [k, v] of kept.walk.bodies) bodies.set(k, [...v]);
    for (const [k, v] of kept.walk.partial) partial.set(k, [...v]);
    for (const [id, b] of kept.walk.files) build.files.set(id, b);
    bodies.set(c.object.name, kept.bodies);
    // It came in as its members: its own STEP isn't held for it any more.
    ctx.held.release([c.object.name]);
    memberWalks.push(kept.walk);
    record({ outcome: 'members', bodies: kept.bodies, moves: kept.moves });
  }

  // --- Meshes: what never came in before, so nothing falls back on them.
  const kernels = new Map<string, MeshKernel>();
  const meshes = await importMeshes(doc, shapes, design, build, budget, {
    ...(options.maxMeshFacets !== undefined ? { maxFacets: options.maxMeshFacets } : {}),
    ...(options.maxMeshes !== undefined ? { maxMeshes: options.maxMeshes } : {}),
    ...(options.maxImportMeshFacets !== undefined
      ? { maxImportFacets: options.maxImportMeshFacets }
      : {}),
    ...(options.maxAttachmentsBytes !== undefined
      ? { maxAttachmentsBytes: options.maxAttachmentsBytes }
      : {}),
    ...(options.onStep ? { onStep: options.onStep } : {}),
    reserved: () => ctx.held.held(),
    keep: (object, mesh) => kernels.set(object, mesh),
  });
  for (const m of meshes) if (m.outcome === 'in') bodies.set(m.object, [...m.bodies]);

  // --- Links, settled in dependency order: a link to a part waits for the links inside it.
  const links: LinkImport[] = [];
  const scaled: LinkImport[] = [];
  const linkShapes = shapes.filter((s) => s.kind === 'link');
  const partsOf = new Map<string, readonly FcObject[]>();
  const inPart = new Map<string, FinalShape[]>();
  for (const f of shapes) {
    const parts = partsAround(doc, f.object) ?? [];
    partsOf.set(f.object.name, parts);
    for (const p of parts) {
      const list = inPart.get(p.name) ?? [];
      list.push(f);
      inPart.set(p.name, list);
    }
  }
  /** The part a link shows, through further links, without expanding anything. */
  const partShown = (s: FinalShape): string | undefined => {
    let at: FcObject | undefined = s.object;
    const seen = new Set<string>();
    for (let hop = 0; at && isLink(at) && hop <= MAX_LINK_HOPS && !seen.has(at.name); hop++) {
      seen.add(at.name);
      const { target } = linkTarget(at);
      at = target === undefined ? undefined : doc.byName.get(target);
    }
    return at?.type === 'App::Part' ? at.name : undefined;
  };
  // How many links inside each part are not settled yet, and who waits on that part.
  const unsettled = new Map<string, number>();
  for (const l of linkShapes)
    for (const p of partsOf.get(l.object.name) ?? [])
      unsettled.set(p.name, (unsettled.get(p.name) ?? 0) + 1);
  const waiting = new Map<string, FinalShape[]>();
  const queue: FinalShape[] = [];
  for (const l of linkShapes) {
    const p = partShown(l);
    if (p !== undefined && (unsettled.get(p) ?? 0) > 0) {
      const list = waiting.get(p) ?? [];
      list.push(l);
      waiting.set(p, list);
    } else queue.push(l);
  }
  const settled = new Set<string>();
  const settle = (l: FinalShape) => {
    settled.add(l.object.name);
    for (const p of partsOf.get(l.object.name) ?? []) {
      const n = (unsettled.get(p.name) ?? 1) - 1;
      unsettled.set(p.name, n);
      if (n === 0) {
        queue.push(...(waiting.get(p.name) ?? []));
        waiting.delete(p.name);
      }
    }
  };
  const record = (s: FinalShape, rest: Partial<LinkImport> & Pick<LinkImport, 'outcome'>) => {
    const entry: LinkImport = {
      object: s.object.name,
      name: cleanName(s.name, s.object.name),
      moves: [],
      bodies: [],
      ...rest,
    };
    if (entry.outcome === 'left-out') scaled.push(entry);
    if (entry.outcome === 'today') fallback.add(s.object.name);
    links.push(entry);
  };
  const maxCopies = options.maxLinkCopies ?? MAX_LINK_COPIES;
  let planned = 0;
  const maxPartMembers = options.maxPartMembers ?? MAX_PART_MEMBERS;
  let partMembers = 0;
  const maxSources = options.maxCopySources ?? MAX_OPERAND_BODIES;
  for (let at = 0; at < queue.length; at++) {
    const s = queue[at] as FinalShape;
    await linkTurn(s);
    settle(s);
  }
  // What is left waits on itself: a part that holds a link back to it.
  for (const s of linkShapes)
    if (!settled.has(s.object.name)) {
      record(s, {
        outcome: 'today',
        reason: 'cycle',
        detail: 'a part that holds a link back to itself',
      });
      settle(s);
    }
  return { meshes, compounds: compoundOut, links, fallback, scaled, members: memberWalks };

  async function linkTurn(s: FinalShape): Promise<void> {
    const gone = budgetGone(budget);
    if (gone) return record(s, { outcome: 'today', reason: 'kernel', detail: gone });
    // The import's copies counted before this plan is expanded: past them it comes in as before.
    const plan = planLink(doc, s, options.maxArrayElements, Math.max(0, maxCopies - planned));
    const array = plan.array ? { array: { elements: plan.array.elements, expanded: false } } : {};
    if ('reason' in plan)
      return record(s, {
        outcome: plan.reason === 'scaled' ? 'left-out' : 'today',
        reason: plan.reason,
        detail: plan.detail,
        ...array,
      });
    planned += plan.instances.length;
    const target = plan.target;
    const isPart = target.type === 'App::Part';
    const members = isPart ? (inPart.get(target.name) ?? []).filter((f) => f !== s) : [];
    const sources = isPart
      ? members.flatMap((f) => bodies.get(f.object.name) ?? [])
      : (bodies.get(target.name) ?? []);
    const missing = isPart
      ? members.find((f) => !bodies.has(f.object.name))?.object
      : bodies.has(target.name)
        ? undefined
        : target;
    // One move copies every source body: as many as a Part tree's operand may bring (S11).
    if (sources.length > maxSources)
      return record(s, {
        outcome: 'today',
        target: target.name,
        reason: 'limit',
        detail: `${sources.length} bodies to copy; at most ${maxSources} come in one copy`,
        ...array,
      });
    if (missing || sources.length === 0)
      return record(s, {
        outcome: 'today',
        target: target.name,
        reason: 'target',
        detail: `${cleanName(missing?.label ?? target.label, missing?.name ?? target.name)} didn't come into the design as bodies`,
        ...array,
      });
    const frame = containerChain(doc, target)?.chain;
    const outer = frame?.length ?? 0;
    const copied = await copyLink(
      plan,
      sources,
      {
        design,
        build,
        frameOf: () => frame,
        expected: (t, chain) =>
          isPart ? partExpected(members, outer, chain, target.name) : expectedOf(t, chain),
      },
      isPart,
    );
    if ('stop' in copied)
      return record(s, {
        outcome: 'today',
        target: target.name,
        reason: copied.reason as LinkReason,
        ...(copied.detail ? { detail: copied.detail } : {}),
        ...array,
      });
    bodies.set(s.object.name, copied.bodies);
    ctx.held.release([s.object.name]);
    record(s, {
      outcome: 'copy',
      target: target.name,
      sources: isPart ? members.map((f) => f.object.name) : [target.name],
      moves: copied.moves,
      bodies: copied.bodies,
      ...(plan.array ? { array: { elements: plan.array.elements, expanded: true } } : {}),
      ...(isPart ? { part: true as const } : {}),
    });
  }

  /** What an object's stored shape (or mesh) measures, placed by `chain`. */
  async function expectedOf(
    o: FcObject,
    chain: readonly FcPlacement[],
  ): Promise<ShapeMeasure | Stopped> {
    const gone = budgetGone(budget);
    if (gone) return { stop: budget.broken ? 'restarts' : 'import-time', detail: gone };
    const mesh = kernels.get(o.name);
    if (mesh) {
      const own = placement(o);
      return placedMesh(mesh, flatten(own ? [...chain, own] : chain));
    }
    const text = textOf(o);
    if (text === undefined) return { stop: 'check', detail: "its stored shape can't be read" };
    const m = await budget.call(() => budget.kernel.measureStoredShape(text, chain), saneMeasure);
    if (m.kind !== 'done')
      return { stop: m.kind, ...('detail' in m && m.detail ? { detail: m.detail } : {}) };
    return m.value;
  }

  /**
   * A part's final shapes together, each placed by the link's chain and its own inside the part;
   * a link inside it to a further part stands for that part's shapes. Expanded first with a work
   * list (never recursion on the file's depth) and no kernel call: a part already on the way from
   * this link is a cycle, and every shape visited counts toward the import's `MAX_PART_MEMBERS`
   * (a part reached along two ways is visited twice: two wheels of one kind on one car). Only
   * then is each shape measured.
   */
  async function partExpected(
    members: readonly FinalShape[],
    outer: number,
    chain: readonly FcPlacement[],
    root: string,
  ): Promise<ShapeMeasure | (Stopped & { reason?: LinkReason })> {
    const leaves: { o: FcObject; chain: readonly FcPlacement[] }[] = [];
    const work: {
      members: readonly FinalShape[];
      outer: number;
      chain: readonly FcPlacement[];
      path: ReadonlySet<string>;
    }[] = [{ members, outer, chain, path: new Set([root]) }];
    while (work.length > 0) {
      const w = work.pop() as (typeof work)[number];
      for (const f of w.members) {
        if (++partMembers > maxPartMembers)
          return {
            stop: 'check',
            reason: 'limit',
            detail: `its parts hold more than ${maxPartMembers} shapes, counted along every way`,
          };
        const placed = [...w.chain, ...f.chain.slice(w.outer)];
        if (f.kind === 'link' && f.source.type === 'App::Part') {
          if (w.path.has(f.source.name))
            return {
              stop: 'check',
              reason: 'cycle',
              detail: 'a part that holds a link back to itself',
            };
          work.push({
            members: (inPart.get(f.source.name) ?? []).filter((x) => x !== f),
            outer: containerChain(doc, f.source)?.chain.length ?? 0,
            chain: placed,
            path: new Set([...w.path, f.source.name]),
          });
        } else leaves.push({ o: f.source, chain: placed });
      }
    }
    const ms: ShapeMeasure[] = [];
    for (const leaf of leaves) {
      const m = await expectedOf(leaf.o, leaf.chain);
      if ('stop' in m) return m;
      ms.push(m);
    }
    return combined(ms);
  }
}

/** A mesh's facts in its own frame, once per mesh object; a placement then moves the nodes it uses. */
const localFacts = new WeakMap<MeshKernel, { facts: MeshFacts; used: Uint32Array }>();

/**
 * A mesh's measures placed by `p`: its facts are measured once (rigid placements keep the
 * volume, area and pieces), and only the box and the centre are placed: the box over the nodes
 * the triangles use.
 */
function placedMesh(mesh: MeshKernel, p: FcPlacement): ShapeMeasure {
  let local = localFacts.get(mesh);
  if (!local) {
    const facts = meshFacts(mesh, []);
    const seen = new Uint8Array(facts.triangles.positions.length / 3);
    for (const i of facts.triangles.indices) seen[i] = 1;
    const used: number[] = [];
    seen.forEach((v, i) => {
      if (v) used.push(i);
    });
    local = { facts, used: Uint32Array.from(used) };
    localFacts.set(mesh, local);
  }
  const { facts, used } = local;
  const pos = facts.triangles.positions;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const i of used) {
    const v = rotate(p.rotation, [
      pos[3 * i] as number,
      pos[3 * i + 1] as number,
      pos[3 * i + 2] as number,
    ]);
    for (let k = 0; k < 3; k++) {
      const x = (v[k] as number) + (p.position[k] as number);
      if (x < (min[k] as number)) min[k] = x;
      if (x > (max[k] as number)) max[k] = x;
    }
  }
  const c = rotate(p.rotation, facts.centre);
  return {
    solids: facts.pieces,
    volume: Math.abs(facts.volume),
    area: facts.area,
    box: { min, max },
    centre: [c[0] + p.position[0], c[1] + p.position[1], c[2] + p.position[2]],
  };
}
