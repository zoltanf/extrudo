/**
 * Fillet and Chamfer by replay and match (ADR-0144 decision 4, S6): the
 * edges a FreeCAD dress-up names are taken on the stored shape of its base
 * (the feature before it), described by the import kernel, looked up on the
 * bodies Extrudo has rebuilt up to there (`match.ts`) and written as
 * persistent references (ADR-0005), never as indices. Then the `fillet` or
 * `chamfer` goes in; the walk rebuilds and checks it as any other feature.
 *
 * FreeCAD's rules, as `FORMAT.md` records them: `EdgeN` / `FaceN` count the
 * base's stored shape in `TopExp::MapShapes` order; a face stands for its
 * edges; an edge is taken only between exactly two faces; OCCT rounds or
 * bevels the whole tangent chain of an edge, in FreeCAD as in Extrudo. A
 * chamfer's first size goes on the first of the edge's two faces in the
 * base's face order, on the second with `FlipDirection`.
 */
import type { Design } from '@extrudo/api';
import { CHAMFER_MAX_SETS, chamferInputs, filletInputs, type GeomRef } from '@extrudo/core';
import type { CallOutcome, KernelBudget } from './budget';
import type { DecodedDressUp, DressUpElement } from './features';
import type { ElementEdge, ElementFace, ShapeElements, SubShapeAt } from './import-kernel';
import {
  cellFor,
  checkReference,
  detailRadius,
  ElementIndex,
  type Located,
  type Lookup,
  saneBodies,
  saneElements,
} from './match';
import type { FcPlacement } from './model';
import { cleanName } from './names';

/** The most edges one dress-up may round or bevel once its faces are counted out. */
export const MAX_DRESSUP_EDGES = 1_000;

/** How the edges a dress-up names were found on the rebuilt body. */
export interface ReferenceTally {
  /** Found exactly once. */
  readonly found: number;
  /** No rebuilt edge or face within the tolerance. */
  readonly none: number;
  /** More than one. */
  readonly several: number;
  /** The largest distance of a match, mm. */
  readonly furthest: number;
  /** The smallest distance of a rebuilt element of the same kind that did not match, mm (in a stored element's neighbourhood). */
  readonly nearestMiss?: number;
}

/** What adding a dress-up came to. */
export type DressUpAdded =
  | {
      readonly stop:
        | 'element'
        | 'edges'
        | 'reference'
        | 'failed'
        | 'limit'
        | Exclude<CallOutcome<unknown>, { kind: 'done' }>['kind'];
      readonly detail: string;
      readonly references?: ReferenceTally;
    }
  | { readonly feature: string; readonly references: ReferenceTally };

const callDetail = (o: Exclude<CallOutcome<unknown>, { kind: 'done' }>) =>
  'detail' in o && o.detail ? o.detail : o.kind;

/** What a cap of the kernel's description says, for a stop's detail. */
function overDetail(d: ShapeElements): string {
  const n = d.over as number;
  switch (d.limit) {
    case 'faces':
      return `has ${n} faces, more than the importer describes`;
    case 'detail':
      return `needs ${n} edges looked at closely, more than the importer does at once`;
    case 'adjacent':
      return `has an edge or face with ${n} neighbours, more than the importer describes`;
    default:
      return `has ${n} edges, more than the importer describes`;
  }
}

const literal = (v: number) => `${Number(v.toPrecision(15))}`;

/** The stored edges a dress-up works on: its edges, and every edge of its faces, each once, between two faces. */
function storedEdges(
  elements: readonly DressUpElement[],
  stored: ShapeElements,
): { edges: ElementEdge[] } | { stop: 'element' | 'edges'; detail: string } {
  const edges = new Map(stored.edges.map((e) => [e.index, e]));
  const faces = new Map(stored.faces.map((f) => [f.index, f]));
  const out: ElementEdge[] = [];
  const taken = new Set<number>();
  const take = (index: number) => {
    const e = edges.get(index);
    // FreeCAD takes an edge only between two faces (a seam or a free edge is skipped).
    if (!e || taken.has(index) || e.faces.length !== 2) return;
    taken.add(index);
    out.push(e);
  };
  for (const el of elements) {
    const count = el.kind === 'edge' ? stored.edgeCount : stored.faceCount;
    if (el.index >= count)
      return {
        stop: 'element',
        detail: `it names ${el.name}, but its base has ${count} ${el.kind}${count === 1 ? '' : 's'}`,
      };
    if (el.kind === 'edge') take(el.index);
    else for (const e of (faces.get(el.index) as ElementFace).edges) take(e);
    if (out.length > MAX_DRESSUP_EDGES)
      return { stop: 'edges', detail: `it works on more than ${MAX_DRESSUP_EDGES} edges` };
  }
  if (out.length === 0)
    return { stop: 'edges', detail: 'none of its edges lies between two faces' };
  return { edges: out };
}

/**
 * Describes, finds and adds one dress-up to `design` (inside the walk's
 * transaction). `mine` are the FreeCAD body's Extrudo bodies of the last
 * rebuild, `own` the Extrudo features that made them. Every kernel call goes
 * through `budget`; every reply is checked before it is used.
 */
export async function addDressUp(
  design: Design,
  feature: DecodedDressUp,
  options: {
    readonly budget: KernelBudget;
    readonly baseText: string;
    readonly chain: readonly FcPlacement[];
    readonly mine: readonly string[];
    readonly own: ReadonlySet<string>;
    readonly name: string;
  },
): Promise<DressUpAdded> {
  const { budget, mine } = options;
  const ask = {
    edges: feature.elements.filter((e) => e.kind === 'edge').map((e) => e.index),
    faces: feature.elements.filter((e) => e.kind === 'face').map((e) => e.index),
  };
  // The named elements of the base's stored shape, with the faces round each edge and the edges of each face.
  let stored: ShapeElements | undefined;
  const described = await budget.call(
    () => budget.kernel.describeStoredShape(options.baseText, options.chain, ask),
    (reply: unknown): reply is ShapeElements => {
      stored = saneElements(reply, ask);
      return stored !== undefined;
    },
  );
  if (described.kind !== 'done') return { stop: described.kind, detail: callDetail(described) };
  const s = stored as ShapeElements;
  if (s.over !== undefined) return { stop: 'edges', detail: `its base ${overDetail(s)}` };
  const picked = storedEdges(feature.elements, s);
  if ('stop' in picked) return picked;

  // Every edge and face of the bodies the FreeCAD body has made so far, as last rebuilt; in
  // detail the edges near the stored ones (the rest are no candidates).
  const points = picked.edges.map((e) => e.midpoint);
  const cell = cellFor([...points, ...s.faces.map((f) => f.centroid)]);
  const near = { points, radius: detailRadius(cell) };
  let bodies: Map<string, ShapeElements> | undefined;
  const rebuilt = await budget.call(
    () => budget.kernel.describeBodies(mine, near),
    (reply: unknown): reply is Record<string, ShapeElements> => {
      bodies = saneBodies(reply, mine);
      return bodies !== undefined;
    },
  );
  if (rebuilt.kind !== 'done') return { stop: rebuilt.kind, detail: callDetail(rebuilt) };
  for (const [, d] of bodies as Map<string, ShapeElements>)
    if (d.over !== undefined) return { stop: 'limit', detail: `its body ${overDetail(d)}` };
  const index = new ElementIndex(bodies as Map<string, ShapeElements>, cell);

  // Each stored edge found exactly once; a chamfer's face too, where its sizes differ.
  const storedFaces = new Map(s.faces.map((f) => [f.index, f]));
  const wantsFace = feature.kind === 'chamfer' && feature.mode !== 'equal';
  let found = 0;
  let none = 0;
  let several = 0;
  let furthest = 0;
  let nearestMiss: number | undefined;
  let first: string | undefined;
  const note = (l: Lookup, what: string) => {
    if ('miss' in l && l.miss !== undefined)
      nearestMiss = Math.min(nearestMiss ?? Infinity, l.miss);
    if (l.kind === 'one') {
      found++;
      furthest = Math.max(furthest, l.distance);
      return l.at;
    }
    if (l.kind === 'none') none++;
    else several++;
    first ??=
      l.kind === 'none'
        ? `${what} has no counterpart on the rebuilt body`
        : `${what} has ${l.count} counterparts on the rebuilt body`;
    return undefined;
  };
  const matches: { edge: Located; face?: Located }[] = [];
  for (const e of picked.edges) {
    const at = note(
      index.edge(e),
      `its edge ${e.index + 1} of ${cleanName(feature.base, feature.base)}`,
    );
    let face: Located | undefined;
    if (wantsFace && at) {
      // FreeCAD's first face round the edge is the lower in the base's face order.
      const [a, b] = [...e.faces].sort((x, y) => x - y) as [number, number];
      const want = storedFaces.get(feature.flip ? b : a);
      const l = want ? index.face(want) : ({ kind: 'none' } as const);
      face = note(l, `the face beside its edge ${e.index + 1}`);
      if (face && (face.body !== at.body || !index.facesOf(at).includes(face.index))) {
        face = undefined;
        found--;
        none++;
        first ??= `the face beside its edge ${e.index + 1} is not beside it on the rebuilt body`;
      }
    }
    if (at) matches.push({ edge: at, ...(face ? { face } : {}) });
  }
  const references: ReferenceTally = {
    found,
    none,
    several,
    furthest,
    ...(nearestMiss !== undefined ? { nearestMiss } : {}),
  };
  if (first !== undefined) return { stop: 'reference', detail: first, references };

  // The references the app would store for those picks.
  const items: SubShapeAt[] = matches.flatMap((m) => [
    { body: m.edge.body, kind: 'edge' as const, index: m.edge.index },
    ...(m.face ? [{ body: m.face.body, kind: 'face' as const, index: m.face.index }] : []),
  ]);
  const sent = new Set(design.doc.features.map((f) => f.id as string));
  let refs: GeomRef[] | undefined;
  let tooLarge: string | undefined;
  const named = await budget.call(
    () => budget.kernel.references(items),
    (reply: unknown): reply is (GeomRef | undefined)[] => {
      if (!Array.isArray(reply) || reply.length !== items.length) return false;
      const out: GeomRef[] = [];
      for (let i = 0; i < items.length; i++) {
        if (reply[i] === undefined) return false;
        const r = checkReference(reply[i], (items[i] as SubShapeAt).kind, sent, options.own);
        if (r.ok) out.push(r.ref);
        // A reference of ours too large to keep: the body stops cleanly, the reply is no nonsense.
        else if (r.limit !== undefined) tooLarge ??= r.limit;
        else return false;
      }
      refs = out;
      return true;
    },
  );
  if (named.kind !== 'done') return { stop: named.kind, detail: callDetail(named), references };
  if (tooLarge !== undefined)
    return {
      stop: 'reference',
      detail: `a reference to one of its edges: ${tooLarge}`,
      references,
    };
  const all = refs as GeomRef[];
  let k = 0;
  const pairs = matches.map((m) => {
    const edge = all[k++] as GeomRef;
    const face = m.face ? (all[k++] as GeomRef) : undefined;
    return { edge, ...(face ? { face } : {}) };
  });

  try {
    if (feature.kind === 'fillet') {
      const inputs = filletInputs([
        { edges: pairs.map((p) => p.edge), radius: `${literal(feature.radius)} mm` },
      ]);
      return { feature: design.add('fillet', inputs, { name: options.name }).id, references };
    }
    const distance = `${literal(feature.size)} mm`;
    if (feature.mode === 'equal') {
      const inputs = chamferInputs([{ edges: pairs.map((p) => p.edge), mode: 'equal', distance }]);
      return { feature: design.add('chamfer', inputs, { name: options.name }).id, references };
    }
    // One set per face that takes the first size (Extrudo's face must touch every edge of its set).
    const byFace = new Map<string, { face: GeomRef; edges: GeomRef[] }>();
    for (const p of pairs) {
      const face = p.face as GeomRef;
      const set = byFace.get(face.id);
      if (set) set.edges.push(p.edge);
      else byFace.set(face.id, { face, edges: [p.edge] });
    }
    if (byFace.size > CHAMFER_MAX_SETS)
      return {
        stop: 'edges',
        detail: `its edges need ${byFace.size} sets, more than Extrudo's chamfer takes (${CHAMFER_MAX_SETS})`,
        references,
      };
    const inputs = chamferInputs(
      [...byFace.values()].map((set) => ({
        edges: set.edges,
        mode: feature.mode,
        distance,
        ...(feature.mode === 'two-distances'
          ? { distanceB: `${literal(feature.size2 as number)} mm` }
          : { angle: `${literal(feature.angle as number)} deg` }),
        face: set.face,
      })),
    );
    return { feature: design.add('chamfer', inputs, { name: options.name }).id, references };
  } catch (error) {
    return {
      stop: 'failed',
      detail: `Extrudo refused it: ${(error as Error).message}`,
      references,
    };
  }
}
