/**
 * What a FreeCAD document has around its shapes (P6-25 S12b, ADR-0144), once
 * the bodies, the trees and the shapes import are in: meshes as mesh bodies,
 * compounds at the top placed as their members, links as copies of what
 * their targets became. Each step is checked in a transaction of its own
 * (`structure-build.ts`); what doesn't hold is handed back to come in as S3
 * brought it. `bodies` is the one record of which bodies each final shape
 * came in as, kept up to date here and read by the components after it.
 */
import type { Design } from '@extrudo/api';
import { type BodyId, REMOVE_TYPE } from '@extrudo/core';
import { storedText } from './bodies';
import type { KernelBudget } from './budget';
import { combined } from './check';
import { partsAround } from './components';
import {
  type CompoundImport,
  type CompoundPlan,
  type CompoundRefusal,
  placeCompound,
} from './compounds';
import { type FinalShape, placement } from './final-shapes';
import type { ShapeMeasure } from './import-kernel';
import { copyLink, type LinkImport, type LinkPlan, planLink } from './links';
import { type MeshKernel, meshFacts } from './mesh-read';
import { importMeshes, type MeshImport } from './meshes';
import type { FcDocument, FcObject, FcPlacement } from './model';
import { cleanName } from './names';
import { saneMeasure } from './shapes';
import { containerChain } from './sketch-place';
import type { Stopped, StructureBuild } from './structure-build';

export interface StructureOptions {
  readonly maxMeshFacets?: number;
  readonly maxMeshes?: number;
  readonly maxAttachmentsBytes?: number;
  readonly maxArrayElements?: number;
  readonly maxLinkCopies?: number;
  readonly onStep?: () => void;
}

export interface StructureResult {
  readonly meshes: MeshImport[];
  readonly compounds: CompoundImport[];
  readonly links: LinkImport[];
  /** Final shapes to bring in as S3 does, after all: compounds and links that didn't hold. */
  readonly fallback: FinalShape[];
  /** Links left out (a scaled link: S3 brought it in at the wrong size). */
  readonly scaled: LinkImport[];
}

/**
 * Meshes, then compounds, then links, in document order each. `bodies` maps
 * a final shape's (or a compound member's) object to the bodies it came in
 * as, `partial` a body's that stopped part way; both are updated.
 */
export async function placeStructure(
  doc: FcDocument,
  shapes: readonly FinalShape[],
  compounds: readonly (CompoundPlan | CompoundRefusal)[],
  design: Design,
  build: StructureBuild,
  budget: KernelBudget,
  bodies: Map<string, string[]>,
  partial: ReadonlyMap<string, readonly string[]>,
  options: StructureOptions = {},
): Promise<StructureResult> {
  const kernels = new Map<string, MeshKernel>();
  const meshes = await importMeshes(doc, shapes, design, build, budget, {
    ...options,
    keep: (object, mesh) => kernels.set(object, mesh),
  });
  for (const m of meshes) if (m.outcome === 'in') bodies.set(m.object, [...m.bodies]);

  const textOf = (o: FcObject) => {
    const t = storedText(doc, o);
    return 'text' in t ? t.text : undefined;
  };
  const fallback: FinalShape[] = [];
  const compoundOut: CompoundImport[] = [];
  for (const plan of compounds) {
    const c = plan.compound;
    const name = cleanName(c.name, c.object.name);
    if ('reason' in plan) {
      compoundOut.push({
        object: c.object.name,
        name,
        outcome: 'today',
        reason: plan.reason,
        detail: plan.detail,
        members: [],
        bodies: [],
        moves: [],
        withoutSolid: 0,
        nested: 0,
      });
      continue;
    }
    const members = plan.members.map((m) => m.object.name);
    const placed = await placeCompound(plan, bodies, design, build, budget, textOf);
    if ('moves' in placed) {
      bodies.set(c.object.name, placed.bodies);
      compoundOut.push({
        object: c.object.name,
        name,
        outcome: 'members',
        members,
        bodies: placed.bodies,
        moves: placed.moves,
        withoutSolid: plan.withoutSolid,
        nested: plan.nested,
      });
      continue;
    }
    // As today: what the members brought goes, and the compound's own shape comes in after.
    const out = members.flatMap((m) => [...(bodies.get(m) ?? []), ...(partial.get(m) ?? [])]);
    for (const m of members) bodies.delete(m);
    if (out.length > 0)
      design.transaction(`Take out ${name}'s members`, () => {
        design.add(
          REMOVE_TYPE,
          { bodies: { kind: 'ref', refs: out.map((id) => ({ kind: 'body', id: id as BodyId })) } },
          { name: `Remove ${name}'s members` },
        );
      });
    fallback.push(c);
    compoundOut.push({
      object: c.object.name,
      name,
      outcome: 'today',
      reason: placed.reason,
      ...(placed.detail ? { detail: placed.detail } : {}),
      members,
      bodies: [],
      moves: [],
      withoutSolid: plan.withoutSolid,
      nested: plan.nested,
    });
  }

  // Links: in document order, a link to a part after the links inside it.
  const links: LinkImport[] = [];
  const scaled: LinkImport[] = [];
  const linkShapes = shapes.filter((s) => s.kind === 'link');
  const pending = new Set(linkShapes.map((s) => s.object.name));
  const plans = new Map<string, ReturnType<typeof planLink>>();
  for (const s of linkShapes)
    plans.set(s.object.name, planLink(doc, s, options.maxArrayElements, options.maxLinkCopies));
  /** A part's final shapes, or the link inside it that isn't settled yet. */
  const partMembers = (part: FcObject): FinalShape[] | { waits: string } => {
    const out: FinalShape[] = [];
    for (const f of shapes) {
      if (f.object.name === part.name) continue;
      if (!(partsAround(doc, f.object) ?? []).some((p) => p.name === part.name)) continue;
      if (pending.has(f.object.name)) return { waits: f.object.name };
      out.push(f);
    }
    return out;
  };
  const record = (s: FinalShape, plan: ReturnType<typeof planLink>, rest: Partial<LinkImport>) => {
    const entry: LinkImport = {
      object: s.object.name,
      name: cleanName(s.name, s.object.name),
      outcome: 'today',
      moves: [],
      bodies: [],
      ...('target' in plan ? { target: plan.target.name } : {}),
      ...(plan.array ? { array: { elements: plan.array.elements, expanded: false } } : {}),
      ...rest,
    };
    pending.delete(s.object.name);
    options.onStep?.();
    if (entry.outcome === 'left-out') scaled.push(entry);
    links.push(entry);
    if (entry.outcome === 'today') fallback.push(s);
  };
  let progress = true;
  let copies = 0;
  while (pending.size > 0 && progress) {
    progress = false;
    for (const s of linkShapes) {
      if (!pending.has(s.object.name)) continue;
      const plan = plans.get(s.object.name) as ReturnType<typeof planLink>;
      if ('reason' in plan) {
        progress = true;
        record(s, plan, {
          outcome: plan.reason === 'scaled' ? 'left-out' : 'today',
          reason: plan.reason,
          detail: plan.detail,
        });
        continue;
      }
      const target = plan.target;
      const isPart = target.type === 'App::Part';
      const members = isPart ? partMembers(target) : undefined;
      if (members && 'waits' in members) continue;
      progress = true;
      const sources = isPart
        ? (members as FinalShape[]).flatMap((f) => bodies.get(f.object.name) ?? [])
        : (bodies.get(target.name) ?? []);
      const missing = isPart
        ? (members as FinalShape[]).find((f) => !bodies.has(f.object.name))?.object
        : bodies.has(target.name)
          ? undefined
          : target;
      if (missing || sources.length === 0) {
        record(s, plan, {
          reason: 'target',
          detail: `${cleanName(missing?.label ?? target.label, missing?.name ?? target.name)} didn't come into the design as bodies`,
        });
        continue;
      }
      if (copies + plan.instances.length > (options.maxLinkCopies ?? Number.POSITIVE_INFINITY)) {
        record(s, plan, { reason: 'limit', detail: 'past the copies one import makes' });
        continue;
      }
      const frame = containerChain(doc, target)?.chain;
      const copied = await copyLink(plan, sources, {
        design,
        build,
        frameOf: () => frame,
        expected: (t, chain) =>
          isPart
            ? partExpected(members as FinalShape[], frame?.length ?? 0, chain)
            : expectedOf(t, chain),
      });
      if ('stop' in copied) {
        record(s, plan, {
          reason: copied.reason,
          ...(copied.detail ? { detail: copied.detail } : {}),
        });
        continue;
      }
      copies += plan.instances.length;
      bodies.set(s.object.name, copied.bodies);
      record(s, plan, {
        outcome: 'copy',
        moves: copied.moves,
        bodies: copied.bodies,
        ...(plan.array ? { array: { elements: plan.array.elements, expanded: true } } : {}),
        ...(isPart ? { part: true } : {}),
      });
    }
  }
  // What is left waits on itself: a part that holds a link back to it.
  for (const s of linkShapes)
    if (pending.has(s.object.name))
      record(s, plans.get(s.object.name) as LinkPlan, {
        reason: 'cycle',
        detail: 'a part that holds a link back to itself',
      });
  return { meshes, compounds: compoundOut, links, fallback, scaled };

  /** What an object's stored shape (or mesh) measures, placed by `chain`. */
  async function expectedOf(
    o: FcObject,
    chain: readonly FcPlacement[],
  ): Promise<ShapeMeasure | Stopped> {
    const mesh = kernels.get(o.name);
    if (mesh) {
      const own = placement(o);
      const f = meshFacts(mesh, own ? [...chain, own] : chain);
      return {
        solids: f.pieces,
        volume: Math.abs(f.volume),
        area: f.area,
        box: f.box,
        centre: f.centre,
      };
    }
    const text = textOf(o);
    if (text === undefined) return { stop: 'check', detail: "its stored shape can't be read" };
    const m = await budget.call(() => budget.kernel.measureStoredShape(text, chain), saneMeasure);
    if (m.kind !== 'done')
      return { stop: m.kind, ...('detail' in m && m.detail ? { detail: m.detail } : {}) };
    return m.value;
  }

  /** A part's final shapes together, each placed by the link's chain and its own inside the part. */
  async function partExpected(
    members: readonly FinalShape[],
    outer: number,
    chain: readonly FcPlacement[],
  ): Promise<ShapeMeasure | Stopped> {
    const ms: ShapeMeasure[] = [];
    for (const f of members) {
      const m = await expectedOf(f.source, [...chain, ...f.chain.slice(outer)]);
      if ('stop' in m) return m;
      ms.push(m);
    }
    return combined(ms);
  }
}
