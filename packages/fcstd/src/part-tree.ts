/**
 * The Part workbench's trees as plain data (ADR-0144 S11): a final shape whose
 * object is a primitive, a boolean, a Part fillet or chamfer is the top of a
 * tree, found through the operand links (`Base`, `Tool`, `Shapes`, a
 * compound's `Links`). Each node is classified from its own properties: a
 * feature kind Extrudo has, a compound that stands for its members, a
 * PartDesign body, or a stored leaf with the reason (an object this slice
 * doesn't rebuild, whose stored shape comes in instead). No kernel: every
 * limit here is the file's own numbers and links.
 *
 * Iterative throughout (no recursion on the file's depth); linear in the
 * nodes and links walked, which `MAX_IMPORT_TREE_NODES` bounds.
 */
import { MAX_FEATURE_LENGTH } from './features';
import { type FinalShape, linkedObjects } from './final-shapes';
import type { FcDocument, FcObject, FcPlacement } from './model';
import { cleanName } from './names';
import { MAX_PART_DRESSUP_EDGES, type PartDressUpEdge, readPartDressUpEdges } from './part-read';

/** The most nodes one tree may have (the library's largest is in ADR-0144's S11 amendment). */
export const MAX_TREE_NODES = 500;
/** The most nodes the trees of one import may have in all. */
export const MAX_IMPORT_TREE_NODES = 2_000;
/** The most shapes one MultiFuse or MultiCommon may list. */
export const MAX_MULTI_OPERANDS = 64;

/** What a node comes in as. */
export type PartNodeKind =
  | 'box'
  | 'cylinder'
  | 'sphere'
  | 'torus'
  | 'cut'
  | 'join'
  | 'intersect'
  | 'fillet'
  | 'chamfer'
  /** A compound standing for its members (a cut's tool, a fuse's member): nothing of its own. */
  | 'compound'
  /** A PartDesign body: the body the walk brought in (S5 to S10). */
  | 'body'
  /** The file's own shape for it (S8's stored-shape step). */
  | 'leaf';

/** Why a node is a stored leaf before anything is built. */
export type LeafReason =
  /** An object this slice doesn't rebuild (a cone, a prism, an extrusion, a mirror …). */
  | 'type'
  /** A part of a primitive (a partial cylinder, a sphere cap, half a torus, a skewed cylinder). */
  | 'partial'
  /** A size that is 0, negative, not finite or past the length limit. */
  | 'value'
  /** A placement that isn't finite, past the length limit, or no rotation. */
  | 'placement'
  /** An operand missing, itself, not a shape, named twice, or too few. */
  | 'operand'
  /** Its operands lead back to it. */
  | 'cycle'
  /** A compound in a place that doesn't stand for its members. */
  | 'compound'
  /** A fillet's or chamfer's edge list that can't be read or mapped. */
  | 'edges'
  /** Past one of the tree's limits. */
  | 'limit';

export interface PlannedNode {
  readonly object: FcObject;
  /** The kind, as far as the file alone decides it. */
  kind: PartNodeKind;
  /** The operands, in order: a boolean's base first, then its tools; a fillet's base; a compound's members. */
  readonly operands: readonly string[];
  /** A stored leaf's reason and what exactly. */
  leaf?: { readonly reason: LeafReason; readonly detail: string };
  /** A fillet's or chamfer's edges, read from its list. */
  readonly edges?: readonly PartDressUpEdge[];
}

/** One tree: its top and its nodes in an order where every operand comes before what uses it. */
export interface PlannedTree {
  readonly top: FinalShape;
  /** Every node below and including the top that something walked uses, the top last. */
  readonly order: readonly string[];
  /** Set when the tree can't come in this way at all: its top comes in as today. */
  readonly asToday?: { readonly reason: LeafReason; readonly detail: string };
}

export interface PartPlan {
  readonly trees: readonly PlannedTree[];
  readonly nodes: ReadonlyMap<string, PlannedNode>;
}

/** The types a tree's top may be. */
const TOPS = new Set([
  'Part::Box',
  'Part::Cylinder',
  'Part::Sphere',
  'Part::Torus',
  'Part::Cut',
  'Part::Fuse',
  'Part::Common',
  'Part::MultiFuse',
  'Part::MultiCommon',
  'Part::Fillet',
  'Part::Chamfer',
]);

/** Whether a final shape starts a tree. */
export const isTreeTop = (s: FinalShape) => s.kind === 'shape' && TOPS.has(s.object.type);

const NOT_A_SHAPE = ['Sketcher::', 'Spreadsheet::', 'App::', 'TechDraw::', 'Fem::'];

const num = (o: FcObject, name: string): number | undefined => {
  const v = o.properties[name]?.value;
  return v?.kind === 'float' || v?.kind === 'integer' ? v.value : undefined;
};
const link = (o: FcObject, name: string): string | undefined | null => {
  const v = o.properties[name]?.value;
  if (!v) return null;
  return v.kind === 'link' || v.kind === 'linkSub' ? (v.object ?? null) : undefined;
};
const close = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) <= 1e-9;

/** A placement this slice builds on: finite (the reader drops one that isn't), within the length limit, a rotation. */
export function placementProblem(o: FcObject, name = 'Placement'): string | undefined {
  if (o.unreadable?.includes(name)) return `its ${name} can't be read`;
  const v = o.properties[name]?.value;
  if (v === undefined) return undefined;
  if (v.kind !== 'placement') return `its ${name} is not a placement`;
  return placementValueProblem(v.value, name);
}

export function placementValueProblem(p: FcPlacement, name = 'Placement'): string | undefined {
  if (p.degenerate) return `its ${name}'s rotation is no rotation`;
  if (!p.position.every((x) => Number.isFinite(x) && Math.abs(x) <= MAX_FEATURE_LENGTH))
    return `its ${name} lies past ${MAX_FEATURE_LENGTH / 1e6} km`;
  if (!p.rotation.every(Number.isFinite)) return `its ${name}'s rotation isn't finite`;
  return undefined;
}

/** A size of a primitive: finite, above 0, at most `MAX_FEATURE_LENGTH`. */
function sizeProblem(o: FcObject, names: readonly string[]): string | undefined {
  for (const n of names) {
    if (o.unreadable?.includes(n)) return `its ${n} can't be read`;
    const v = num(o, n);
    if (v === undefined) return `it has no ${n}`;
    if (!(v > 1e-6 && v <= MAX_FEATURE_LENGTH)) return `its ${n} of ${v} mm is out of range`;
  }
  return undefined;
}

/** Classifies one object from its own properties: what it is, its operands, or why it is a leaf. */
export function classify(doc: FcDocument, o: FcObject): PlannedNode {
  const leaf = (reason: LeafReason, detail: string, operands: string[] = []): PlannedNode => ({
    object: o,
    kind: 'leaf',
    operands,
    leaf: { reason, detail },
  });
  const t = o.type;
  if (t === 'PartDesign::Body') return { object: o, kind: 'body', operands: [] };
  const placed = (kind: PartNodeKind, operands: string[] = []): PlannedNode => {
    const p = placementProblem(o);
    return p ? leaf('placement', p) : { object: o, kind, operands };
  };
  const angles = (expected: readonly (readonly [string, number])[]) => {
    for (const [n, want] of expected) {
      const v = num(o, n);
      // A property the file doesn't have takes FreeCAD's default, the whole primitive.
      if (v !== undefined && !close(v, want)) return `its ${n} is ${v}°`;
      if (o.unreadable?.includes(n)) return `its ${n} can't be read`;
    }
    return undefined;
  };
  switch (t) {
    case 'Part::Box': {
      const s = sizeProblem(o, ['Length', 'Width', 'Height']);
      return s ? leaf('value', s) : placed('box');
    }
    case 'Part::Cylinder': {
      const part = angles([
        ['Angle', 360],
        ['FirstAngle', 0],
        ['SecondAngle', 0],
      ]);
      if (part) return leaf('partial', `it is part of a cylinder or skewed: ${part}`);
      const s = sizeProblem(o, ['Radius', 'Height']);
      return s ? leaf('value', s) : placed('cylinder');
    }
    case 'Part::Sphere': {
      const part = angles([
        ['Angle1', -90],
        ['Angle2', 90],
        ['Angle3', 360],
      ]);
      if (part) return leaf('partial', `it is part of a sphere: ${part}`);
      const s = sizeProblem(o, ['Radius']);
      return s ? leaf('value', s) : placed('sphere');
    }
    case 'Part::Torus': {
      const part = angles([
        ['Angle1', -180],
        ['Angle2', 180],
        ['Angle3', 360],
      ]);
      if (part) return leaf('partial', `it is part of a torus: ${part}`);
      const s = sizeProblem(o, ['Radius1', 'Radius2']);
      if (s) return leaf('value', s);
      if (!((num(o, 'Radius2') as number) < (num(o, 'Radius1') as number) - 1e-6))
        return leaf('value', 'its tube is as thick as the torus');
      return placed('torus');
    }
    case 'Part::Cut':
    case 'Part::Fuse':
    case 'Part::Common': {
      const base = link(o, 'Base');
      const tool = link(o, 'Tool');
      if (!base || !tool)
        return leaf(
          'operand',
          `it has no ${!base ? 'Base' : 'Tool'} to ${t.slice(6).toLowerCase()}`,
        );
      if (base === tool) return leaf('operand', 'it names the same shape as its Base and its Tool');
      return placed(t === 'Part::Cut' ? 'cut' : t === 'Part::Fuse' ? 'join' : 'intersect', [
        base,
        tool,
      ]);
    }
    case 'Part::MultiFuse':
    case 'Part::MultiCommon': {
      const v = o.properties.Shapes?.value;
      const shapes = v ? linkedObjects(v) : [];
      if (shapes.length > MAX_MULTI_OPERANDS)
        return leaf('limit', `it lists ${shapes.length} shapes, more than ${MAX_MULTI_OPERANDS}`);
      if (shapes.length < 2)
        return leaf('operand', `it lists ${shapes.length} shape${shapes.length === 1 ? '' : 's'}`);
      if (new Set(shapes).size !== shapes.length)
        return leaf('operand', 'it lists the same shape twice');
      return placed(t === 'Part::MultiFuse' ? 'join' : 'intersect', shapes);
    }
    case 'Part::Fillet':
    case 'Part::Chamfer': {
      const base = link(o, 'Base');
      if (!base) return leaf('operand', 'it has no Base');
      const read = readPartDressUpEdges(doc, o);
      if ('problem' in read) return leaf('edges', read.problem);
      const { edges } = read;
      if (edges.length === 0) return leaf('edges', 'it lists no edges');
      const bad = edges.find(
        (e) =>
          !(Number.isInteger(e.index) && e.index >= 1) ||
          !(e.first > 1e-6 && e.first <= MAX_FEATURE_LENGTH) ||
          !(e.second > 1e-6 && e.second <= MAX_FEATURE_LENGTH),
      );
      if (bad)
        return leaf('edges', `its edge ${bad.index} has sizes ${bad.first} and ${bad.second} mm`);
      if (new Set(edges.map((e) => e.index)).size !== edges.length)
        return leaf('edges', 'it lists an edge twice');
      const [a] = edges as [PartDressUpEdge];
      const same = edges.every((e) => close(e.first, a.first) && close(e.second, a.second));
      if (t === 'Part::Fillet' && !(same && close(a.second, a.first)))
        return leaf(
          'edges',
          same ? 'its radius changes along the edge' : 'its edges have different radii',
        );
      if (!same) return leaf('edges', 'its edges have different sizes');
      const p = placementProblem(o);
      if (p) return leaf('placement', p);
      return {
        object: o,
        kind: t === 'Part::Fillet' ? 'fillet' : 'chamfer',
        operands: [base],
        edges,
      };
    }
    case 'Part::Compound': {
      const v = o.properties.Links?.value;
      const members = v ? linkedObjects(v) : [];
      if (members.length === 0) return leaf('compound', 'it holds nothing');
      if (new Set(members).size !== members.length)
        return leaf('compound', 'it holds the same shape twice');
      const p = o.properties.Placement?.value;
      if (p?.kind === 'placement' && !isIdentity(p.value))
        return leaf('compound', 'it has a placement of its own');
      return { object: o, kind: 'compound', operands: members };
    }
  }
  if (NOT_A_SHAPE.some((x) => t.startsWith(x))) return leaf('operand', `it is a ${t}, not a shape`);
  return leaf('type', `it is a ${t || 'object of no type'}`);
}

/** Whether a placement is the identity (to rounding). */
export function isIdentity(p: FcPlacement): boolean {
  const [x, y, z, w] = p.rotation;
  return (
    p.position.every((v) => Math.abs(v) <= 1e-12) &&
    Math.abs(x) <= 1e-12 &&
    Math.abs(y) <= 1e-12 &&
    Math.abs(z) <= 1e-12 &&
    Math.abs(Math.abs(w) - 1) <= 1e-12
  );
}

/** Where an operand stands in its user: a compound stands for its members only as a cut's tool or a fuse's member. */
function membersAllowed(user: PlannedNode, position: number): boolean {
  if (user.kind === 'join') return true;
  return user.kind === 'cut' && position > 0;
}

/**
 * The file's trees, in document order of their tops, each node classified and
 * ordered. Nothing is built; each limit and refusal is a reason on a node or a
 * tree.
 */
export function partTrees(
  doc: FcDocument,
  shapes: readonly FinalShape[],
  limits: { maxTreeNodes?: number; maxImportNodes?: number } = {},
): PartPlan {
  const maxTree = limits.maxTreeNodes ?? MAX_TREE_NODES;
  const maxImport = limits.maxImportNodes ?? MAX_IMPORT_TREE_NODES;
  const nodes = new Map<string, PlannedNode>();
  const tops = shapes.filter(isTreeTop);
  const trees: PlannedTree[] = [];
  let total = 0;

  /** A node, classified once; an operand that isn't in the file makes its user a leaf. */
  const nodeOf = (name: string): PlannedNode => {
    let n = nodes.get(name);
    if (n) return n;
    n = classify(doc, doc.byName.get(name) as FcObject);
    nodes.set(name, n);
    return n;
  };
  /** Turns a mapped node into a leaf (its operands are no longer walked). */
  const toLeaf = (n: PlannedNode, reason: LeafReason, detail: string) => {
    n.kind = 'leaf';
    n.leaf = { reason, detail };
  };
  /** The operands of a node that are walked: none for a leaf or a body. */
  const walked = (n: PlannedNode) => (n.kind === 'leaf' || n.kind === 'body' ? [] : n.operands);

  // Operands that can't be operands make their user a leaf, before anything is ordered.
  const checkOperands = (n: PlannedNode) => {
    for (const name of walked(n)) {
      const o = doc.byName.get(name);
      const what = `its ${n.kind === 'compound' ? 'member' : 'operand'} ${cleanName(name, name)}`;
      if (!o) return toLeaf(n, 'operand', `${what} isn't in the file`);
      if (o.name === n.object.name) return toLeaf(n, 'operand', `${what} is itself`);
      if (NOT_A_SHAPE.some((x) => o.type.startsWith(x)))
        return toLeaf(n, 'operand', `${what} is a ${o.type}, not a shape`);
    }
    return undefined;
  };

  for (const top of tops) {
    // Iterative depth-first walk: a node is finished once every operand is.
    const order: string[] = [];
    const state = new Map<string, 'open' | 'done'>();
    const stack: { name: string; next: number }[] = [{ name: top.object.name, next: 0 }];
    let over = false;
    while (stack.length > 0) {
      const frame = stack[stack.length - 1] as { name: string; next: number };
      const n = nodeOf(frame.name);
      if (frame.next === 0 && !state.has(frame.name)) {
        state.set(frame.name, 'open');
        if (++total > maxImport || state.size > maxTree) {
          over = true;
          break;
        }
        checkOperands(n);
      }
      const ops = walked(n);
      if (frame.next < ops.length) {
        const name = ops[frame.next++] as string;
        const s = state.get(name);
        if (s === 'open') {
          // A link back to a node on the way here: this node can't be rebuilt.
          toLeaf(n, 'cycle', `its operand ${cleanName(name, name)} is built from it`);
          continue;
        }
        if (s === 'done') continue;
        stack.push({ name, next: 0 });
        continue;
      }
      state.set(frame.name, 'done');
      order.push(frame.name);
      stack.pop();
    }
    if (over) {
      trees.push({
        top,
        order: [],
        asToday: {
          reason: 'limit',
          detail:
            total > maxImport
              ? `the file's trees have more than ${maxImport} objects`
              : `it is built from more than ${maxTree} objects`,
        },
      });
      // What this tree counted stays counted: the import's cap holds for the whole file.
      continue;
    }
    trees.push({ top, order });
  }

  // Compounds stand for their members only where every user takes members.
  for (const tree of trees)
    for (const name of tree.order) {
      const n = nodes.get(name) as PlannedNode;
      walked(n).forEach((op, position) => {
        const m = nodes.get(op);
        if (m?.kind === 'compound' && !membersAllowed(n, position))
          toLeaf(m, 'compound', 'it is used where its shape counts as one, not as its members');
      });
    }

  // A node turned into a leaf no longer reaches its operands: each tree keeps what its top reaches.
  const out = trees.map((tree): PlannedTree => {
    if (tree.asToday) return tree;
    const reached = new Set<string>([tree.top.object.name]);
    for (let i = tree.order.length - 1; i >= 0; i--) {
      const name = tree.order[i] as string;
      if (!reached.has(name)) continue;
      for (const op of walked(nodes.get(name) as PlannedNode)) reached.add(op);
    }
    return { top: tree.top, order: tree.order.filter((n) => reached.has(n)) };
  });
  return { trees: out, nodes };
}

/**
 * What a node uses up: its operands, a compound that stands for its members
 * (`isBuilt`) read as those members, each object once. Iterative: compounds
 * may nest as deep as the file's links.
 */
export function effectiveOperands(
  plan: PartPlan,
  name: string,
  isBuilt: (name: string) => boolean,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [...((plan.nodes.get(name) as PlannedNode).operands as string[])].reverse();
  while (stack.length > 0) {
    const op = stack.pop() as string;
    if (seen.has(op)) continue;
    seen.add(op);
    const m = plan.nodes.get(op);
    if (m?.kind === 'compound' && isBuilt(op)) stack.push(...[...m.operands].reverse());
    else out.push(op);
  }
  return out;
}

/**
 * How many times each node is used up by the features of the given trees: a
 * shared operand needs a copy for every use but its last. A compound uses
 * nothing up itself: whatever uses the compound uses its members.
 */
export function usesOf(
  plan: PartPlan,
  trees: readonly PlannedTree[],
  isBuilt: (name: string) => boolean,
): Map<string, number> {
  const uses = new Map<string, number>();
  const counted = new Set<string>();
  for (const tree of trees)
    for (const name of tree.order) {
      if (counted.has(name) || !isBuilt(name)) continue;
      counted.add(name);
      const n = plan.nodes.get(name) as PlannedNode;
      if (n.kind === 'leaf' || n.kind === 'body' || n.kind === 'compound') continue;
      for (const op of effectiveOperands(plan, name, isBuilt))
        uses.set(op, (uses.get(op) ?? 0) + 1);
    }
  return uses;
}

export { MAX_PART_DRESSUP_EDGES };
