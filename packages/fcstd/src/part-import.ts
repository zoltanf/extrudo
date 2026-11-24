/**
 * The Part workbench's trees as timelines (ADR-0144 S11). Each tree
 * (`part-tree.ts`) is built in the order its nodes are planned, every operand
 * before what uses it: a primitive as Extrudo's `box`, `cylinder`, `sphere` or
 * `torus` (and a `move` where its own inputs can't turn it), a boolean as one
 * `combine` (or a chain of them), a Part fillet or chamfer as S6's dress-up,
 * a compound as its members, a PartDesign body as the body the walk brings
 * in, anything else as the file's own shape for that object (S8's
 * stored-shape step: a STEP attachment on an `import`). **Every node is
 * checked against its own stored shape** with S5's check, in its own
 * transaction, before the next is added; a node that doesn't hold becomes
 * the file's shape for it and the tree carries on above it.
 *
 * **Nothing of a node that didn't hold stays behind.** The trees that share
 * nodes are one unit, built inside one outer transaction. When a node that
 * didn't hold had operands built for it (or a top doesn't hold), the unit's
 * transaction is cancelled and the unit is built again from the start with
 * what is now known: the node is a stored leaf from the start (its operands
 * not built), the top comes in as today (S3's final shape). At most
 * `MAX_TREE_PASSES` passes; past them the unit's tops come in as today.
 *
 * A shared operand exists once per use: before each use but its last, the
 * user's transaction first copies it (`move` with `copy`, nothing moved), and
 * the user consumes the original.
 */
import type { Design, SketchHandle } from '@extrudo/api';
import {
  type AttachmentId,
  combineInputs,
  evaluateParameters,
  extrudeInputs,
  type FeatureId,
  importInputs,
  moveInputs,
  type OriginPlaneId,
  originPlane,
  originPlaneRef,
  type PrimitiveType,
  primitiveInputs,
  updateFeatureInputs,
} from '@extrudo/core';
import type { SketchSolver } from '@extrudo/sketch';
import { MAX_ATTACHMENTS_BYTES } from '@extrudo/storage';
import { type Binder, within } from './bind';
import {
  type BodyHistory,
  bodyChain,
  type HistoryStop,
  profileRefs,
  type SaneRebuild,
  saneRebuild,
  storedText,
} from './bodies';
import type { CallOutcome, KernelBudget } from './budget';
import { combined, type Drift, drift, historyDisagreement, saneMeasure } from './check';
import { addDressUp, type ReferenceTally } from './dressups';
import type { DecodedDressUp } from './features';
import { invert, rotate } from './final-shapes';
import type { RebuildResult, ShapeMeasure } from './import-kernel';
import { append, prepend } from './lists';
import type { FcDocument, FcObject, FcPlacement } from './model';
import { cleanName, clip } from './names';
import {
  type ExtrusionPlan,
  effectiveOperands,
  isIdentity,
  type LeafReason,
  type PartNodeKind,
  type PartPlan,
  type PlannedNode,
  type PlannedTree,
  placementValueProblem,
  usesOf,
} from './part-tree';
import { addStepAttachment, attachmentBytes, convertStored } from './shapes';
import { compose, containerChain, forgetRemovedPlanes } from './sketch-place';
import { addSketch } from './sketches';

/** The most passes one unit of trees is built in (a pass learns at least one node that doesn't hold). */
export const MAX_TREE_PASSES = 4;
/** The most features the trees of one import may add in all (copies and moves included). */
export const MAX_TREE_FEATURES = 4_000;

/**
 * The most bodies one operand may bring to the node that uses it (a stored compound, a fuse
 * kept apart). A combine is written per body of a base, so this bounds what one node costs
 * whatever the features' cap is (the library's largest stored shape has 86 solids).
 */
export const MAX_OPERAND_BODIES = 256;

type Vec3 = readonly [number, number, number];

/** Why a node came in as the file's shape, or why a tree's top did: S11's reasons and the walk's. */
export type TreeReason = LeafReason | HistoryStop | 'body' | 'passes' | 'container';

/** What one object of a tree became. */
export interface TreeNodeReport {
  /** The FreeCAD object's internal name, its cleaned label and its type. */
  readonly object: string;
  readonly name: string;
  readonly type: string;
  /**
   * `feature`: rebuilt and checked; `leaf`: the file's own shape for it (an
   * `import`), checked; `members`: a compound standing for its members;
   * `body`: a PartDesign body brought in with its history.
   */
  readonly outcome: 'feature' | 'leaf' | 'members' | 'body';
  /** The Extrudo features it added, in order (the main one first; copies of shared operands, moves). */
  readonly features: readonly string[];
  /** For a leaf: why it isn't a feature. */
  readonly reason?: TreeReason;
  readonly detail?: string;
  /** How far its rebuild was from its stored shape (a feature that held), or the drift that refused it. */
  readonly drift?: Drift;
  /** Moves written for placements: a primitive turned in a way its inputs can't, a boolean's own placement. */
  readonly moves: number;
  /** Copies made of it for its later uses. */
  readonly copies: number;
  /** A fillet's or chamfer's edges, as found. */
  readonly references?: ReferenceTally;
  /** How a primitive was placed: by its own inputs, or with a move after it. */
  readonly placed?: 'inputs' | 'move';
  /** A PartDesign body's walk (S5 to S10). */
  readonly body?: BodyHistory;
  /** Expressions bound on it (S10's rule), by Extrudo input. */
  readonly bound?: readonly string[];
  /** The faces of its stored shape and of its rebuild, where they differ (a refined boolean). */
  readonly faces?: { readonly stored: number; readonly rebuilt: number };
  /** A fuse whose shapes don't touch: they stay apart, as FreeCAD's result holds them. */
  readonly apart?: true;
}

/** What one tree came to. */
export interface TreeImport {
  /** The top's internal name and its name in the design. */
  readonly object: string;
  readonly name: string;
  readonly type: string;
  /**
   * `history`: every node a feature (or members, or a body with its history);
   * `leaves`: with the file's shapes for some nodes and live features above;
   * `shape`: the top came in as today (S3's final shape, `reason` says why);
   * `left-out`: as today, and S3 left it out too.
   */
  readonly outcome: 'history' | 'leaves' | 'shape' | 'left-out';
  readonly reason?: TreeReason;
  readonly detail?: string;
  /** Every object of the tree, in the timeline's order (empty when the top came in as today). */
  readonly nodes: readonly TreeNodeReport[];
  /** The Extrudo bodies of its top. */
  readonly bodies: readonly string[];
  /** How many passes its unit took. */
  readonly passes: number;
  /** A move of the top for its containers' placements. */
  readonly containerMove?: string;
}

export interface TreeWalkOptions {
  readonly budget: KernelBudget;
  readonly binder?: Binder;
  /** The attachments' bytes (the body walk's steps first): the leaves add theirs. */
  readonly files: Map<AttachmentId, Uint8Array>;
  readonly maxAttachmentsBytes?: number;
  /** The design's bodies when the trees start (the body walk's last rebuild). */
  readonly known: string[];
  /** Walks a PartDesign body a tree uses (S5 to S10), from the design's bodies `known`. */
  readonly walkBody: (
    body: FcObject,
    known: string[],
  ) => Promise<{ history: BodyHistory; known: string[] }>;
  /** Remembers the walks' counters; what it returns gives back what a cancelled pass counted. */
  readonly markWalk?: () => () => void;
  readonly maxPasses?: number;
  readonly maxFeatures?: number;
  readonly maxOperandBodies?: number;
  readonly onStep?: () => void;
  /** The sketch solver, for an extrusion's sketch (S13). */
  readonly solver?: SketchSolver;
}

const literal = (v: number) => `${Number(v.toPrecision(15)) || 0}`;
const mm = (v: number) => `${literal(v)} mm`;
const deg = (v: number) => `${literal(v)} deg`;

/** A unit quaternion's matrix, rows. */
function matrixOf(q: FcPlacement['rotation']): [Vec3, Vec3, Vec3] {
  const ex = rotate(q, [1, 0, 0]);
  const ey = rotate(q, [0, 1, 0]);
  const ez = rotate(q, [0, 0, 1]);
  return [
    [ex[0], ey[0], ez[0]],
    [ex[1], ey[1], ez[1]],
    [ex[2], ey[2], ez[2]],
  ];
}

/** The turns about world X, then Y, then Z (degrees) that make `q`: Extrudo's free move. */
export function eulerXYZ(q: FcPlacement['rotation']): Vec3 {
  const R = matrixOf(q);
  const r20 = Math.max(-1, Math.min(1, R[2][0]));
  const b = Math.asin(-r20);
  let a: number;
  let c: number;
  if (Math.abs(r20) < 1 - 1e-12) {
    a = Math.atan2(R[2][1], R[2][2]);
    c = Math.atan2(R[1][0], R[0][0]);
  } else {
    // Gimbal lock: the turn about X folds into the one about Z.
    a = 0;
    c = Math.atan2(-R[0][1], R[1][1]);
  }
  const d = 180 / Math.PI;
  return [a * d, b * d, c * d];
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];

/** A free move's inputs that place bodies whose box centre is `pivot` by `p` (`p · x`). */
export function moveFor(p: FcPlacement, pivot: Vec3): Record<string, string> {
  const [rx, ry, rz] = eulerXYZ(p.rotation);
  // The move turns about the pivot, then moves: d = t + R·c − c.
  const d = sub3(add3(p.position, rotate(p.rotation, pivot)), pivot);
  const out: Record<string, string> = {};
  if (literal(rx) !== '0') out.rx = deg(rx);
  if (literal(ry) !== '0') out.ry = deg(ry);
  if (literal(rz) !== '0') out.rz = deg(rz);
  if (literal(d[0]) !== '0') out.dx = mm(d[0]);
  if (literal(d[1]) !== '0') out.dy = mm(d[1]);
  if (literal(d[2]) !== '0') out.dz = mm(d[2]);
  return out;
}

const turned = (p: FcPlacement) => {
  const [x, y, z] = p.rotation;
  return Math.hypot(x, y, z) > 1e-12;
};

/** The origin plane whose normal is along `axis` (either way), and the sense. */
function planeAlong(axis: Vec3): { id: OriginPlaneId; sense: 1 | -1 } | undefined {
  for (const id of ['origin:xy', 'origin:xz', 'origin:yz'] as const) {
    const n = originPlane(id)?.frame.normal as Vec3;
    const c = dot(axis, n);
    if (Math.abs(Math.abs(c) - 1) <= 1e-12) return { id, sense: c > 0 ? 1 : -1 };
  }
  return undefined;
}

/** The input that holds a world coordinate when the plane frame's axis is a world axis (either way). */
function memberOf(axis: Vec3): string | undefined {
  for (let k = 0; k < 3; k++)
    if (Math.abs(Math.abs(axis[k] as number) - 1) <= 1e-12) return `Placement.Base.${'xyz'[k]}`;
  return undefined;
}

/** A primitive's inputs: by its own inputs where they can place it, else at the origin with a move after it. */
export interface PrimitivePlan {
  readonly type: PrimitiveType;
  readonly plane: OriginPlaneId;
  readonly numbers: Record<string, string>;
  /** Extrudo input → FreeCAD property (S10's binder). */
  readonly sources: Record<string, string>;
  /** The placement a move after it must give it (in the tree's frame), when its inputs can't. */
  readonly move?: FcPlacement;
  /**
   * A box's centre as its corner plus half its sizes: `x` and `y` are `base +
   * l · length / 2 + w · width / 2`, so a bound length or width grows the box
   * from FreeCAD's corner, as the file's model does.
   */
  readonly follows?: Readonly<Record<'x' | 'y', readonly [number, number, number]>>;
}

const sizeOf = (o: FcObject, n: string) => {
  const v = o.properties[n]?.value;
  return v?.kind === 'float' || v?.kind === 'integer' ? v.value : 0;
};

/**
 * Where a primitive goes (S11's placement rule, in order): its own inputs (a
 * position; a box turned about its plane's normal; an axis along a world
 * axis on the origin plane across it), else at the origin and one `move`.
 * `p` is its placement in the tree's frame; `own` whether that is its own
 * `Placement` (only then do placement members bind).
 */
export function primitivePlan(
  o: FcObject,
  kind: 'box' | 'cylinder' | 'sphere' | 'torus',
  p: FcPlacement,
  own: boolean,
): PrimitivePlan {
  const t = p.position;
  const ex = rotate(p.rotation, [1, 0, 0]);
  const ez = rotate(p.rotation, [0, 0, 1]);
  const along =
    kind === 'sphere' ? { id: 'origin:xy' as const, sense: 1 as const } : planeAlong(ez);
  const sizes: Record<string, string> = {};
  const sources: Record<string, string> = {};
  if (kind === 'box') {
    sizes.length = mm(sizeOf(o, 'Length'));
    sizes.width = mm(sizeOf(o, 'Width'));
    Object.assign(sources, { length: 'Length', width: 'Width', height: 'Height' });
  } else if (kind === 'cylinder' || kind === 'sphere') {
    sizes.diameter = mm(2 * sizeOf(o, 'Radius'));
    sources.diameter = 'Radius';
    if (kind === 'cylinder') sources.height = 'Height';
  } else {
    sizes.diameter = mm(2 * sizeOf(o, 'Radius1'));
    sizes.tube = mm(2 * sizeOf(o, 'Radius2'));
    Object.assign(sources, { diameter: 'Radius1', tube: 'Radius2' });
  }
  const height = kind === 'box' || kind === 'cylinder' ? sizeOf(o, 'Height') : 0;
  if (!along) {
    // At the origin as FreeCAD builds it in its own frame, then one move.
    const numbers: Record<string, string> = { ...sizes };
    if (kind === 'box') {
      numbers.x = mm(sizeOf(o, 'Length') / 2);
      numbers.y = mm(sizeOf(o, 'Width') / 2);
    }
    if (height) numbers.height = mm(height);
    return { type: kind, plane: 'origin:xy', numbers, sources, move: p };
  }
  const frame = (originPlane(along.id) as NonNullable<ReturnType<typeof originPlane>>).frame;
  const xP = frame.x as Vec3;
  const yP = frame.y as Vec3;
  const nP = frame.normal as Vec3;
  const numbers: Record<string, string> = { ...sizes };
  // A box's point is its base's centre; the others' their axis's foot (a sphere's, a torus's centre).
  const point =
    kind === 'box'
      ? add3(
          add3(t, scale3(ex, sizeOf(o, 'Length') / 2)),
          scale3(rotate(p.rotation, [0, 1, 0]), sizeOf(o, 'Width') / 2),
        )
      : t;
  numbers.x = mm(dot(point, xP));
  numbers.y = mm(dot(point, yP));
  numbers.offset = mm(dot(t, nP));
  if (own && kind !== 'box') {
    const mx = memberOf(xP);
    const my = memberOf(yP);
    if (mx) sources.x = mx;
    if (my) sources.y = my;
  }
  const mn = memberOf(nP);
  if (own && mn) sources.offset = mn;
  if (height) numbers.height = mm(along.sense * height);
  let follows: PrimitivePlan['follows'];
  if (kind === 'box') {
    const theta = Math.atan2(dot(ex, yP), dot(ex, xP)) * (180 / Math.PI);
    if (literal(theta) !== '0') numbers.rotation = deg(theta);
    const ey = rotate(p.rotation, [0, 1, 0]);
    follows = {
      x: [dot(t, xP), dot(ex, xP), dot(ey, xP)],
      y: [dot(t, yP), dot(ex, yP), dot(ey, yP)],
    };
  }
  for (const [k, v] of Object.entries(numbers))
    if (v === '0 mm' && k !== 'height') delete numbers[k];
  return { type: kind, plane: along.id, numbers, sources, ...(follows ? { follows } : {}) };
}

const LITERAL = /^\s*-?[0-9.]+(?:e-?[0-9]+)?\s*(mm|deg)?\s*$/;

/** A coordinate as its base plus half of each size that is an expression, or `undefined` when none is. */
export function followText(
  [base, kl, kw]: readonly [number, number, number],
  length: string,
  width: string,
): string | undefined {
  const live = (e: string) => !LITERAL.test(e);
  if (!live(length) && !live(width)) return undefined;
  const term = (k: number, e: string) => {
    if (Math.abs(k) <= 1e-12) return '';
    const half = `(${e}) / 2`;
    const scaled = Math.abs(Math.abs(k) - 1) <= 1e-12 ? half : `${half} * ${literal(Math.abs(k))}`;
    return `${k < 0 ? ' - ' : ' + '}${scaled}`;
  };
  return `${mm(base)}${term(kl, length)}${term(kw, width)}`;
}

/** One rebuild's answer once checked, and the IDs its features had. */
interface Rebuilt {
  readonly r: SaneRebuild;
}

/** Why one try didn't hold. */
interface Failure {
  readonly reason: TreeReason;
  readonly detail?: string;
  readonly drift?: Drift;
  readonly references?: ReferenceTally;
}

/** What a node's own work added, for the check. */
interface Added {
  /** The Extrudo features, main first. */
  readonly features: string[];
  /** Bodies kept by ID that make the node's result (a combine's targets, a moved body). */
  readonly keeps: string[];
  /** Copies made for later uses: operand → the copy's bodies. */
  readonly copies: Map<string, string[]>;
  readonly moves: number;
  readonly placed?: 'inputs' | 'move';
  readonly references?: ReferenceTally;
  /** The STEP bytes a leaf's import adds, sent with the rebuild. */
  readonly file?: { id: AttachmentId; bytes: Uint8Array };
  /** A leaf's stored shape as read: what its import is checked against. */
  readonly measured?: ShapeMeasure;
  readonly bound?: string[];
}

type Stopped = {
  readonly stop: TreeReason;
  readonly detail?: string;
  readonly references?: ReferenceTally;
};

const callFailure = (o: Exclude<CallOutcome<unknown>, { kind: 'done' }>): Failure => ({
  reason: o.kind,
  ...('detail' in o && o.detail ? { detail: o.detail } : {}),
});

const IDENTITY: FcPlacement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
/** A boolean's own translation, as the inputs of its move. */
const TRANSLATION = { dx: 'Placement.Base.x', dy: 'Placement.Base.y', dz: 'Placement.Base.z' };

/** A unit's fate for a node across passes. */
type Fate =
  | {
      readonly kind: 'leaf';
      readonly reason: TreeReason;
      readonly detail?: string;
      readonly drift?: Drift;
      readonly references?: ReferenceTally;
    }
  | { readonly kind: 'today'; readonly reason: TreeReason; readonly detail?: string };

/**
 * Builds the plan's trees into `design`, unit by unit, in document order.
 * Never throws for anything the file holds.
 */
export async function importTrees(
  doc: FcDocument,
  plan: PartPlan,
  design: Design,
  options: TreeWalkOptions,
): Promise<{ trees: TreeImport[]; known: string[] }> {
  const { budget, files } = options;
  const maxPasses = options.maxPasses ?? MAX_TREE_PASSES;
  const maxFeatures = options.maxFeatures ?? MAX_TREE_FEATURES;
  const maxOperandBodies = options.maxOperandBodies ?? MAX_OPERAND_BODIES;
  const maxAttachments = options.maxAttachmentsBytes ?? MAX_ATTACHMENTS_BYTES;
  let known = [...options.known];
  let featuresAdded = 0;
  const reports = new Map<string, TreeImport>();

  // Units: trees that share a node are built together.
  const unitOf = new Map<string, number>();
  const units: PlannedTree[][] = [];
  for (const tree of plan.trees) {
    if (tree.asToday) {
      units.push([tree]);
      continue;
    }
    const joined = new Set<number>();
    for (const n of tree.order) {
      const u = unitOf.get(n);
      if (u !== undefined) joined.add(u);
    }
    let u: number;
    if (joined.size === 0) {
      u = units.length;
      units.push([]);
    } else {
      const [first, ...rest] = [...joined].sort((a, b) => a - b) as [number, ...number[]];
      u = first;
      for (const r of rest) {
        for (const t of units[r] as PlannedTree[]) {
          (units[u] as PlannedTree[]).push(t);
          for (const n of t.order) unitOf.set(n, u);
        }
        units[r] = [];
      }
    }
    (units[u] as PlannedTree[]).push(tree);
    for (const n of tree.order) unitOf.set(n, u);
  }
  const docIndex = new Map(doc.objects.map((o, i) => [o.name, i]));

  for (const unit of units) {
    if (unit.length === 0) continue;
    // Tops in document order within the unit.
    unit.sort(
      (a, b) => (docIndex.get(a.top.object.name) ?? 0) - (docIndex.get(b.top.object.name) ?? 0),
    );
    const today = new Map<string, Fate & { kind: 'today' }>();
    for (const t of unit)
      if (t.asToday) today.set(t.top.object.name, { kind: 'today', ...t.asToday });
    const fates = new Map<string, Fate>();
    // A top the plan already makes a leaf comes in as today.
    for (const t of unit) {
      const n = plan.nodes.get(t.top.object.name);
      if (!t.asToday && n?.kind === 'leaf' && n.leaf)
        today.set(t.top.object.name, {
          kind: 'today',
          reason: n.leaf.reason,
          detail: n.leaf.detail,
        });
    }
    let passes = 0;
    let outcome: Awaited<ReturnType<typeof runPass>> | undefined;
    for (;;) {
      passes++;
      if (budget.broken || budget.left() <= 0) {
        for (const t of unit)
          if (!today.has(t.top.object.name))
            today.set(t.top.object.name, {
              kind: 'today',
              reason: budget.broken ? 'restarts' : 'import-time',
              detail: budget.broken
                ? 'the geometry kernel failed too often'
                : 'the import ran out of time',
            });
        outcome = undefined;
        break;
      }
      const restore = options.binder?.mark();
      const restoreWalk = options.markWalk?.();
      const filesBefore = new Set(files.keys());
      const knownBefore = [...known];
      const featuresBefore = featuresAdded;
      design.state.beginTransaction(
        `Import ${cleanName(unit[0]?.top.name ?? '', unit[0]?.top.object.name ?? 'shapes')}`,
      );
      let pass: Awaited<ReturnType<typeof runPass>> | undefined;
      try {
        pass = await runPass(unit, fates, today);
      } catch (error) {
        pass = undefined;
        for (const t of unit)
          if (!today.has(t.top.object.name))
            today.set(t.top.object.name, {
              kind: 'today',
              reason: 'failed',
              detail: clip(`building it failed: ${(error as Error)?.message ?? String(error)}`),
            });
      }
      const live = unit.filter((t) => !today.has(t.top.object.name));
      if (pass && !pass.waste && live.length > 0) {
        design.state.commitTransaction();
        outcome = pass;
        break;
      }
      // Take the whole unit back: nothing of a pass with waste stays.
      design.state.cancelTransaction();
      restore?.();
      restoreWalk?.();
      // The planes the pass's sketches made went with it: a later sketch makes its own.
      forgetRemovedPlanes(design);
      for (const id of [...files.keys()]) if (!filesBefore.has(id)) files.delete(id);
      known = knownBefore;
      featuresAdded = featuresBefore;
      if (!pass || live.length === 0) {
        outcome = undefined;
        break;
      }
      if (passes >= maxPasses) {
        for (const t of live)
          today.set(t.top.object.name, {
            kind: 'today',
            reason: 'passes',
            detail: `it needed more than ${maxPasses} tries to leave nothing behind`,
          });
        outcome = undefined;
        break;
      }
    }
    for (const t of unit) {
      const name = cleanName(t.top.name, t.top.object.name);
      const gone = today.get(t.top.object.name);
      const r = outcome?.trees.get(t.top.object.name);
      if (gone || !r) {
        const why = gone ?? { reason: 'failed' as TreeReason, detail: 'it could not be built' };
        reports.set(t.top.object.name, {
          object: t.top.object.name,
          name,
          type: t.top.object.type,
          outcome: 'shape',
          reason: why.reason,
          ...(why.detail ? { detail: clip(why.detail) } : {}),
          nodes: [],
          bodies: [],
          passes,
        });
        continue;
      }
      reports.set(t.top.object.name, { ...r, passes });
    }
  }
  return {
    trees: plan.trees.map((t) => reports.get(t.top.object.name) as TreeImport),
    known,
  };

  /**
   * One pass over a unit: every node its live tops reach, in order, each
   * tried in its own transaction. `waste` when something that didn't hold
   * had built operands, or a top didn't hold: the pass is taken back and the
   * unit built again with what it learnt (`fates`, `today`).
   */
  async function runPass(
    unit: readonly PlannedTree[],
    fates: Map<string, Fate>,
    today: Map<string, Fate & { kind: 'today' }>,
  ) {
    let waste = false;
    const live = unit.filter((t) => !today.has(t.top.object.name));
    const isMapped = (name: string) => {
      const n = plan.nodes.get(name) as PlannedNode;
      return !fates.has(name) && n.kind !== 'leaf' && n.kind !== 'body' && n.kind !== 'loose';
    };
    // What the live tops reach through nodes that are built as features.
    /** What the live tops reach through nodes built as features (again whenever a fate changes). */
    const reach = () => {
      const out = new Set<string>();
      for (const t of live) {
        if (today.has(t.top.object.name)) continue;
        out.add(t.top.object.name);
        for (let i = t.order.length - 1; i >= 0; i--) {
          const name = t.order[i] as string;
          if (!out.has(name)) continue;
          if (isMapped(name))
            for (const op of (plan.nodes.get(name) as PlannedNode).operands) out.add(op);
        }
      }
      return out;
    };
    let reached = reach();
    const order: string[] = [];
    const seen = new Set<string>();
    // The file's own shapes first (they need nothing): one that can't come in is known before
    // anything is built on the way to it.
    const isLeaf = (name: string) => !isMapped(name);
    for (const first of [true, false])
      for (const t of live)
        for (const name of t.order)
          if (reached.has(name) && !seen.has(name) && isLeaf(name) === first) {
            seen.add(name);
            order.push(name);
          }
    /** Who uses each object, among what the pass may build. */
    const usersOf = new Map<string, string[]>();
    for (const name of order)
      for (const op of new Set((plan.nodes.get(name) as PlannedNode).operands))
        if (usersOf.has(op)) usersOf.get(op)?.push(name);
        else usersOf.set(op, [name]);
    /** What a node uses up: a compound that stands for its members is those members. */
    const usedBy = (name: string) => effectiveOperands(plan, name, isMapped);
    /** The bodies an operand brings: a compound's are its members' as they are now. */
    const bodiesOf = (op: string): string[] =>
      plan.nodes.get(op)?.kind === 'compound' && isMapped(op)
        ? effectiveOperands(plan, op, isMapped).flatMap((m) => built.get(m) ?? [])
        : (built.get(op) ?? []);
    /** The most features a node can add, known before anything is added for it. */
    const adds = (n: PlannedNode, kind: PartNodeKind): number => {
      if (kind === 'leaf') return 1;
      if (kind === 'compound') return 0;
      if (kind === 'body') {
        const chain = bodyChain(doc, n.object);
        return 'features' in chain ? chain.features.length : 0;
      }
      const copies = usedBy(n.object.name).filter((op) => (uses.get(op) ?? 0) > 1).length;
      const own = n.object.properties.Placement?.value;
      const moved = own?.kind === 'placement' && !isIdentity(own.value) ? 1 : 0;
      const bases = bodiesOf(n.operands[0] ?? '').length;
      const behavior = n.object.properties.Behavior?.value;
      const steps = behavior?.kind === 'enum' && behavior.index === 1 ? 1 : n.operands.length - 1;
      // An extrusion counts as the stored leaf it was before S13 (its own cap bounds the rest).
      if (kind === 'extrude') return 1;
      if (kind === 'cut') return copies + bases + moved;
      if (kind === 'intersect') return copies + steps * bases + moved;
      return copies + 1 + moved;
    };
    /** Operands copied for a later use: a pass ends with waste if a copy was never used. */
    const copied = new Set<string>();
    /** A node that can't come in: what uses it can't be built either, from now on. */
    const lose = (name: string) => {
      lost.add(name);
      for (const user of usersOf.get(name) ?? []) {
        const u = plan.nodes.get(user) as PlannedNode;
        if (!isMapped(user) || today.has(user)) continue;
        const detail = `its operand ${cleanName(plan.nodes.get(name)?.object.label ?? name, name)} can't come in`;
        if (tops.has(user)) today.set(user, { kind: 'today', reason: 'operand', detail });
        else fates.set(user, { kind: 'leaf', reason: 'operand', detail });
        // What was built for it is no longer needed.
        if (u.operands.some((op) => built.has(op))) waste = true;
      }
    };
    const uses = usesOf(plan, live, (n) => reached.has(n) && isMapped(n));
    const tops = new Set(live.map((t) => t.top.object.name));
    const built = new Map<string, string[]>();
    const lost = new Set<string>();
    const records = new Map<string, TreeNodeReport>();
    /** Every feature the unit added this pass: a dress-up's reference must name one. */
    const unitFeatures = new Set<string>();
    let restartsAtRebuild = budget.restarts;
    /** Bodies from before the unit: never measured again (S5's `skip`). */
    const settled = [...known];
    /** The last rebuild's measures, by body. */
    let lastBodies: ReadonlyMap<string, ShapeMeasure> = new Map();

    const topFrame = (name: string) =>
      live.find((t) => t.top.object.name === name)?.top.chain ?? [];
    // The unit's tops share one frame when they share nodes; the first top's is the unit's.
    const frame = topFrame(live[0]?.top.object.name ?? '');
    /** The chain that places a node's stored shape in the unit's frame. */
    const relChain = (o: FcObject): FcPlacement[] | undefined => {
      const c = containerChain(doc, o);
      if (!c) return undefined;
      let k = 0;
      while (
        k < frame.length &&
        k < c.chain.length &&
        JSON.stringify(frame[k]) === JSON.stringify(c.chain[k])
      )
        k++;
      return [...frame.slice(k).reverse().map(invert), ...c.chain.slice(k)];
    };
    const flatten = (chain: readonly FcPlacement[], p: FcPlacement) => {
      let out = p;
      for (let i = chain.length - 1; i >= 0; i--) out = compose(chain[i] as FcPlacement, out);
      return out;
    };

    let fatesSeen = fates.size + today.size;
    for (const name of order) {
      // A node no live top needs any more (a fate learnt this pass) is not built.
      if (fates.size + today.size !== fatesSeen) {
        fatesSeen = fates.size + today.size;
        reached = reach();
      }
      if (!reached.has(name)) continue;
      const n = plan.nodes.get(name) as PlannedNode;
      const o = n.object;
      const label = cleanName(o.label, o.name);
      const fate = fates.get(name);
      options.onStep?.();
      const record = (
        r: Omit<TreeNodeReport, 'object' | 'name' | 'type' | 'moves' | 'copies'> & {
          moves?: number;
          copies?: number;
        },
      ) =>
        records.set(name, { object: name, name: label, type: o.type, moves: 0, copies: 0, ...r });
      /** Past the features' cap: the trees of this node come in as today, nothing more is added. */
      const overCap = () => {
        waste = true;
        for (const t of live)
          if (t.order.includes(name))
            today.set(t.top.object.name, {
              kind: 'today',
              reason: 'limit',
              detail: `the file's trees would add more than ${maxFeatures} features`,
            });
      };
      if (budget.broken || budget.left() <= 0) {
        waste = true;
        for (const t of live)
          today.set(t.top.object.name, {
            kind: 'today',
            reason: budget.broken ? 'restarts' : 'import-time',
            detail: budget.broken
              ? 'the geometry kernel failed too often'
              : 'the import ran out of time',
          });
        break;
      }
      const kind: PartNodeKind = fate ? 'leaf' : n.kind;
      if (featuresAdded + adds(n, kind) > maxFeatures) {
        overCap();
        break;
      }
      /** A node that didn't hold: from the next pass on (or now, if it is a top) the file's shape stands in. */
      const fail = async (f: Failure) => {
        if (tops.has(name)) {
          today.set(name, {
            kind: 'today',
            reason: f.reason,
            ...(f.detail ? { detail: f.detail } : {}),
          });
          waste = true;
          lost.add(name);
          return;
        }
        fates.set(name, {
          kind: 'leaf',
          reason: f.reason,
          ...(f.detail ? { detail: f.detail } : {}),
          ...(f.drift ? { drift: f.drift } : {}),
          ...(f.references ? { references: f.references } : {}),
        });
        // Its operands were built for it: this pass has waste and is taken back.
        if (n.operands.some((op) => built.has(op))) waste = true;
        await asLeaf(f);
      };
      /** The file's own shape for the node, checked; its users can't be built without it. */
      const asLeaf = async (why: {
        reason: TreeReason;
        detail?: string;
        drift?: Drift;
        references?: ReferenceTally;
      }) => {
        if (tops.has(name)) {
          // A top that is the file's shape is S3's final shape: the tree comes in as today.
          today.set(name, {
            kind: 'today',
            reason: why.reason,
            ...(why.detail ? { detail: why.detail } : {}),
          });
          lost.add(name);
          return;
        }
        const out = await leaf(o);
        if ('stop' in out) {
          lose(name);
          record({
            outcome: 'leaf',
            features: [],
            reason: why.reason,
            detail: clip(
              `${why.detail ?? why.reason}; its own shape can't come in either: ${out.detail ?? out.stop}`,
            ),
          });
          return;
        }
        built.set(name, out.bodies);
        record({
          outcome: 'leaf',
          features: out.features,
          reason: why.reason,
          ...(why.detail ? { detail: clip(why.detail) } : {}),
          ...(why.drift ? { drift: why.drift } : {}),
          ...(why.references ? { references: why.references } : {}),
        });
      };

      if (kind === 'leaf') {
        const why = fate ?? { reason: n.leaf?.reason ?? 'type', detail: n.leaf?.detail };
        await asLeaf(why as Fate & { kind: 'leaf' });
        continue;
      }
      if (n.operands.some((op) => lost.has(op))) {
        const op = n.operands.find((x) => lost.has(x)) as string;
        await fail({
          reason: 'operand',
          detail: `its operand ${cleanName(plan.nodes.get(op)?.object.label ?? op, op)} can't come in`,
        });
        continue;
      }
      const wide =
        kind === 'compound'
          ? undefined
          : n.operands.find((op) => bodiesOf(op).length > maxOperandBodies);
      if (wide !== undefined) {
        await fail({
          reason: 'limit',
          detail: `its operand ${cleanName(plan.nodes.get(wide)?.object.label ?? wide, wide)} is more than ${maxOperandBodies} bodies`,
        });
        continue;
      }
      if (kind === 'compound') {
        // Its members are used up by what uses it (`usedBy`), each as it is by then.
        built.set(name, []);
        record({ outcome: 'members', features: [] });
        continue;
      }
      if (kind === 'body' || kind === 'loose') {
        const top = live.find((t) => t.top.object.name === name);
        const chain = containerChain(doc, o);
        if (top || !chain || chain.moved || frame.some((p) => !isIdentity(p))) {
          await fail({
            reason: 'body',
            detail: `its ${kind === 'body' ? 'body' : 'row of features'} is moved by a container`,
          });
          continue;
        }
        const featuresBefore = design.doc.features.length;
        const walked = await options.walkBody(o, known);
        known = walked.known;
        featuresAdded += design.doc.features.length - featuresBefore;
        if (featuresAdded > maxFeatures) {
          overCap();
          break;
        }
        const h = walked.history;
        if (h.stop || h.bodies.length === 0) {
          // Its features came in for nothing: this pass is taken back, and next time it is the file's shape.
          waste = waste || h.mapped.length > 0 || h.steps.length > 0;
          await fail({
            reason: 'body',
            detail: h.stop
              ? `its ${kind === 'body' ? "body's" : "row of features'"} history stops at ${cleanName(h.stop.object, h.stop.object)}`
              : `its ${kind === 'body' ? 'body' : 'row of features'} has nothing in it`,
          });
          continue;
        }
        built.set(name, [...h.bodies]);
        record({ outcome: 'body', features: h.mapped.map((m) => m.feature), body: h });
        continue;
      }
      // A feature: its operands' bodies, copied where they are used again later.
      // A fuse of shapes that don't touch: FreeCAD keeps them apart, Extrudo's join refuses them
      // (S11). Tried first when the stored shape already says so (as many solids as the operands,
      // their volumes added up): Extrudo takes long to find that large shapes don't touch.
      const firstApart = n.kind === 'join' && (await looksApart(n));
      let tried = await feature(n, label, firstApart);
      let apart = firstApart && !('stop' in tried);
      if (
        'stop' in tried &&
        n.kind === 'join' &&
        (firstApart ||
          (tried.stop === 'failed' && /doesn't touch|don't touch/.test(tried.detail ?? '')))
      ) {
        tried = await feature(n, label, !firstApart);
        apart = !firstApart && !('stop' in tried);
      }
      if ('stop' in tried) {
        await fail({
          reason: tried.stop,
          ...(tried.detail ? { detail: tried.detail } : {}),
          ...(tried.drift ? { drift: tried.drift } : {}),
          ...(tried.references ? { references: tried.references } : {}),
        });
        continue;
      }
      built.set(name, tried.bodies);
      record({
        ...(apart ? { apart: true as const } : {}),
        ...(tried.faces ? { faces: tried.faces } : {}),
        outcome: 'feature',
        features: tried.added.features,
        drift: tried.drift,
        moves: tried.added.moves,
        ...(tried.added.placed ? { placed: tried.added.placed } : {}),
        ...(tried.added.references ? { references: tried.added.references } : {}),
        ...(tried.added.bound && tried.added.bound.length > 0 ? { bound: tried.added.bound } : {}),
      });
      // Counted only now: an attempt that didn't hold used nothing up.
      for (const op of usedBy(name)) uses.set(op, (uses.get(op) ?? 0) - 1);
      for (const [op, copy] of tried.added.copies) {
        built.set(op, copy);
        copied.add(op);
        const r = records.get(op);
        if (r) records.set(op, { ...r, copies: r.copies + 1, features: [...r.features] });
      }
    }

    // Anything built that no live top needs now, or a copy nobody used, is waste.
    {
      const needed = reach();
      if ([...built.keys()].some((x) => !needed.has(x))) waste = true;
      if ([...copied].some((x) => (uses.get(x) ?? 0) > 0)) waste = true;
    }
    // The tops: their containers' placements, then the file's name, colour and visibility.
    const trees = new Map<string, TreeImport>();
    for (const t of live) {
      // The unit was built in its first top's frame: without that top, the next pass decides.
      if (today.has(live[0]?.top.object.name ?? '')) {
        waste = true;
        break;
      }
      const top = t.top.object.name;
      if (today.has(top) || !built.has(top)) continue;
      let bodies = built.get(top) as string[];
      let containerMove: string | undefined;
      const whole = flatten(t.top.chain, { position: [0, 0, 0], rotation: [0, 0, 0, 1] });
      // Every top of a unit is built in the first top's frame: one in another container (or in
      // none) would stay in that frame, not where the file has it.
      if (!isIdentity(compose(invert(flatten(frame, IDENTITY)), whole))) {
        // A unit's tops in different containers: only the first top's frame is the unit's.
        today.set(top, {
          kind: 'today',
          reason: 'container',
          detail: 'its tree shares objects across containers',
        });
        waste = true;
        continue;
      }
      if (!isIdentity(whole)) {
        const o = t.top.object;
        const moved = await attempt(o, t.top.chain, async () => {
          const pivot = await pivotOf(bodies);
          if ('stop' in pivot) return pivot;
          const m = design.add('move', moveInputs(bodies, moveFor(whole, pivot.centre)), {
            name: `Place ${cleanName(o.label, o.name)}`,
          });
          return { features: [m.id], keeps: bodies, copies: new Map(), moves: 1 };
        });
        if ('stop' in moved) {
          today.set(top, {
            kind: 'today',
            reason: 'container',
            detail: `placing it as its containers do: ${moved.detail ?? moved.stop}`,
          });
          waste = true;
          continue;
        }
        bodies = moved.bodies;
        containerMove = moved.added.features[0];
      }
      const nodes = t.order
        .filter((x) => records.has(x))
        .map((x) => records.get(x) as TreeNodeReport);
      trees.set(top, {
        object: top,
        name: cleanName(t.top.name, top),
        type: t.top.object.type,
        // A body that took a stored-shape step is part of its history, as at the top of a file.
        outcome: nodes.some(
          (x) => x.outcome === 'leaf' || (x.outcome === 'body' && (x.body?.steps.length ?? 0) > 0),
        )
          ? 'leaves'
          : 'history',
        nodes,
        bodies,
        passes: 0,
        ...(containerMove ? { containerMove } : {}),
      });
    }
    return { waste, trees };

    /** A node's feature, tried and checked: its bodies, or why not. */
    async function feature(n: PlannedNode, label: string, apart = false) {
      const o = n.object;
      const chain = relChain(o);
      if (!chain)
        return { stop: 'chain' as TreeReason, detail: 'its containers hold each other in a loop' };
      const opBodies = n.operands.map(bodiesOf);
      if (opBodies.some((b) => b.length === 0) && n.operands.length > 0)
        return { stop: 'operand' as TreeReason, detail: 'an operand has no body' };
      return attempt(o, chain, async (): Promise<Added | Stopped> => {
        // Copies first: an operand used again later keeps a copy, this node uses the original.
        const copies = new Map<string, string[]>();
        const features: string[] = [];
        for (const op of usedBy(n.object.name)) {
          const left = uses.get(op) ?? 0;
          if (left > 1) {
            const bodies = built.get(op) as string[];
            const c = design.add('move', moveInputs(bodies, { copy: true }), {
              name: `Copy ${cleanName(plan.nodes.get(op)?.object.label ?? op, op)}`,
            });
            copies.set(
              op,
              bodies.map((_, i) => `${c.id}:${i}`),
            );
            features.push(c.id);
          }
        }
        const own = o.properties.Placement?.value;
        const placement: FcPlacement =
          own?.kind === 'placement' ? own.value : { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
        const bad = placementValueProblem(placement);
        if (bad) return { stop: 'placement', detail: bad };
        switch (n.kind) {
          case 'box':
          case 'cylinder':
          case 'sphere':
          case 'torus': {
            const p = primitivePlan(o, n.kind, flatten(chain, placement), chain.length === 0);
            const added = design.add(
              p.type,
              primitiveInputs(p.type, {
                ...(p.plane !== 'origin:xy' ? { plane: originPlaneRef(p.plane) } : {}),
                numbers: p.numbers,
              }),
              { name: label },
            );
            features.unshift(added.id);
            const body = `${added.id}:0`;
            let moves = 0;
            if (p.move) {
              const pivot = await pivotOf([body]);
              if ('stop' in pivot) return pivot;
              const m = design.add('move', moveInputs([body], moveFor(p.move, pivot.centre)), {
                name: `Place ${label}`,
              });
              features.push(m.id);
              moves++;
            }
            const bound = bindPart(o, added.id, p.sources);
            if (p.follows) followSizes(o, added.id, p.follows);
            return {
              features,
              keeps: [],
              copies,
              moves,
              placed: p.move ? 'move' : 'inputs',
              bound,
            };
          }
          case 'extrude': {
            // S13: the sketch as S4 brings one (on the plane its placement gives) and one extrude.
            const e = n.extrusion as ExtrusionPlan;
            // Built in the unit's frame, as every node (S11): the sketch by its own placement, in
            // the same containers as the extrusion; the unit's containers move it once.
            if (chain.length > 0 || !isIdentity(placement))
              return { stop: 'placement', detail: 'it is placed or in a container of its own' };
            const sketchObject = doc.byName.get(e.sketch) as FcObject;
            const mine = containerChain(doc, o)?.chain;
            const its = containerChain(doc, sketchObject)?.chain;
            if (!mine || !its || mine.length !== its.length || !sameChain(mine, its))
              return { stop: 'placement', detail: 'its sketch is in other containers than it' };
            const sketch = addSketch(design, doc, sketchObject, {
              local: true,
              name: cleanName(sketchObject.label, sketchObject.name),
              ...(options.solver ? { solver: options.solver } : {}),
            });
            if (!sketch.imported)
              return { stop: 'sketch', detail: `its sketch was not imported: ${sketch.reason}` };
            features.push(sketch.id);
            const profiles = profileRefs(design.feature(sketch.id) as SketchHandle, true);
            if (typeof profiles === 'string') return { stop: 'sketch', detail: profiles };
            if (profiles.length === 0)
              return { stop: 'sketch', detail: 'its sketch has no closed profile' };
            // Only backwards (`LengthFwd` 0): one side, turned round.
            const backOnly = !e.symmetric && e.forward <= 1e-6;
            const flip = (e.reversed !== (sketch.outcome.mirrored === true)) !== backOnly;
            const added = design.add(
              'extrude',
              extrudeInputs(profiles, {
                ...(e.symmetric
                  ? {
                      direction: 'symmetric' as const,
                      distance: mm(e.forward),
                      // Written out: the whole length, whatever a later default may be.
                      symmetricMeasure: 'whole' as const,
                    }
                  : backOnly
                    ? { distance: mm(e.reverse) }
                    : e.reverse > 0
                      ? {
                          direction: 'two-sides' as const,
                          distance: mm(e.forward),
                          distance2: mm(e.reverse),
                        }
                      : { distance: mm(e.forward) }),
                ...(flip ? { flip: true } : {}),
                operation: 'new-body',
              }),
              { name: label },
            );
            features.push(added.id);
            const bound = bindPart(
              o,
              added.id,
              backOnly
                ? { distance: 'LengthRev' }
                : e.symmetric || e.reverse === 0
                  ? { distance: 'LengthFwd' }
                  : { distance: 'LengthFwd', distance2: 'LengthRev' },
            );
            return { features, keeps: [], copies, moves: 0, placed: 'inputs', bound };
          }
          case 'cut':
          case 'join':
          case 'intersect': {
            const [base, ...tools] = opBodies as [string[], ...string[][]];
            const name = (k: number) => (k > 0 ? `${label} ${k + 1}` : label);
            let made: string[] = [];
            if (n.kind === 'join' && apart) {
              // Shapes that don't touch: FreeCAD's fuse holds them apart, and so does the design.
              made = [...base, ...tools.flat()];
            } else if (n.kind === 'join') {
              const all = [...new Set([...base, ...tools.flat()])];
              const c = design.add(
                'combine',
                combineInputs(all[0] as string, all.slice(1), { operation: 'join' }),
                { name: label },
              );
              features.unshift(c.id);
              made = [all[0] as string];
            } else if (n.kind === 'cut') {
              const t = tools.flat();
              const ids = base.map(
                (b, k) =>
                  design.add(
                    'combine',
                    combineInputs(b, t, {
                      operation: 'cut',
                      ...(k < base.length - 1 ? { keepTools: true } : {}),
                    }),
                    { name: name(k) },
                  ).id,
              );
              prepend(features, ids);
              made = [...base];
            } else {
              // A common of several shapes is the common of each with the next, in order; a
              // newer MultiCommon may ask for the common of the first with all the rest, which is
              // Extrudo's intersect with several tools.
              const behavior = o.properties.Behavior?.value;
              const rest =
                behavior?.kind === 'enum' && behavior.index === 1 ? [tools.flat()] : tools;
              let acc = base;
              const steps: string[] = [];
              for (const t of rest) {
                acc.forEach((b, k) => {
                  steps.push(
                    design.add(
                      'combine',
                      combineInputs(b, t, {
                        operation: 'intersect',
                        ...(k < acc.length - 1 ? { keepTools: true } : {}),
                      }),
                      { name: steps.length === 0 ? label : `${label} ${steps.length + 1}` },
                    ).id,
                  );
                });
                acc = [...acc];
              }
              prepend(features, steps);
              made = [...base];
            }
            let moves = 0;
            const bound: string[] = [];
            if (!isIdentity(placement)) {
              // The boolean's own placement, on what it made (split pieces included).
              const now = await rebuildNow();
              if ('stop' in now) return now;
              const pieces = resultOf(now.r, made, features);
              const pivot = await pivotOf(pieces, now.r);
              if ('stop' in pivot) return pivot;
              const m = design.add('move', moveInputs(pieces, moveFor(placement, pivot.centre)), {
                name: `Place ${label}`,
              });
              features.push(m.id);
              moves++;
              if (!turned(placement)) append(bound, bindPart(o, m.id, TRANSLATION));
              else
                bindPart(o, m.id, {}, 'its own placement turns it, so a member of it is no input');
            } else if (n.kind === 'join' && apart)
              bindPart(o, undefined, {}, 'it has no feature of its own: its shapes stay apart');
            else bindPart(o, features[0], TRANSLATION);
            return { features, keeps: made, copies, moves, bound };
          }
          case 'fillet':
          case 'chamfer': {
            const base = n.operands[0] as string;
            const bodies = built.get(base) as string[];
            const baseObject = plan.nodes.get(base)?.object as FcObject;
            const text = storedText(doc, baseObject);
            if (!('text' in text)) return { stop: 'stored', detail: `its base's ${text.detail}` };
            const baseChain = relChain(baseObject);
            if (!baseChain)
              return { stop: 'chain', detail: 'its containers hold each other in a loop' };
            if (budget.restarts !== restartsAtRebuild) {
              const again = await rebuildNow();
              if ('stop' in again) return again;
            }
            const edges = n.edges ?? [];
            const first = edges[0];
            const decoded: DecodedDressUp =
              n.kind === 'fillet'
                ? {
                    kind: 'fillet',
                    object: o.name,
                    base,
                    elements: edges.map((e) => ({
                      kind: 'edge',
                      index: e.index - 1,
                      name: `Edge${e.index}`,
                    })),
                    radius: first?.first ?? 0,
                    sources: {},
                  }
                : {
                    kind: 'chamfer',
                    object: o.name,
                    base,
                    elements: edges.map((e) => ({
                      kind: 'edge',
                      index: e.index - 1,
                      name: `Edge${e.index}`,
                    })),
                    ...(first && Math.abs(first.first - first.second) <= 1e-9
                      ? { mode: 'equal' as const, size: first.first }
                      : {
                          mode: 'two-distances' as const,
                          size: first?.first ?? 0,
                          size2: first?.second ?? 0,
                        }),
                    flip: false,
                    sources: {},
                  };
            const added = await addDressUp(design, decoded, {
              budget,
              baseText: text.text,
              chain: baseChain,
              mine: bodies,
              own: new Set([...unitFeatures, ...design.doc.features.map((f) => f.id as string)]),
              name: label,
            });
            if ('stop' in added)
              return {
                stop: added.stop,
                ...(added.detail ? { detail: added.detail } : {}),
                ...(added.references ? { references: added.references } : {}),
              };
            features.unshift(added.feature);
            let moves = 0;
            if (!isIdentity(placement)) {
              const now = await rebuildNow();
              if ('stop' in now) return now;
              const pivot = await pivotOf(bodies, now.r);
              if ('stop' in pivot) return pivot;
              const m = design.add('move', moveInputs(bodies, moveFor(placement, pivot.centre)), {
                name: `Place ${label}`,
              });
              features.push(m.id);
              moves++;
            }
            return { features, keeps: bodies, copies, moves, references: added.references };
          }
        }
        return { stop: 'type', detail: `it is a ${o.type}` };
      });
    }

    /** Whether a fuse's stored shape is its operands' bodies side by side: their solids and volumes added up. */
    async function looksApart(n: PlannedNode): Promise<boolean> {
      const bodies = n.operands.flatMap(bodiesOf);
      const ms = bodies.map((b) => lastBodies.get(b));
      if (bodies.length < 2 || ms.some((m) => m === undefined)) return false;
      const stored = storedText(doc, n.object);
      const chain = relChain(n.object);
      if (!('text' in stored) || !chain) return false;
      const m = await budget.call(
        () => budget.kernel.measureStoredShape(stored.text, chain),
        saneMeasure,
      );
      if (m.kind !== 'done') return false;
      const sum = combined(ms as ShapeMeasure[]);
      return (
        m.value.solids === sum.solids &&
        Math.abs(m.value.volume - sum.volume) <= 1e-6 * Math.max(1, Math.abs(m.value.volume))
      );
    }

    /**
     * A bound length or width: the box's centre follows it, so the box grows from its corner.
     * Kept only where Extrudo's own evaluation gives the centre the file's numbers give (S10's
     * rule): twice a long expression can pass core's limits, and the coordinate stays a number.
     */
    function followSizes(
      o: FcObject,
      id: string,
      follows: NonNullable<PrimitivePlan['follows']>,
    ): void {
      const feature = id as FeatureId;
      const inputs = design.doc.features.find((x) => x.id === id)?.inputs as
        | Record<string, { expr?: string }>
        | undefined;
      const length = inputs?.length?.expr ?? '0 mm';
      const width = inputs?.width?.expr ?? '0 mm';
      const write = (axis: 'x' | 'y', expr: string) =>
        design.state.dispatch(
          updateFeatureInputs({
            id: feature,
            inputs: { [axis]: { kind: 'expr', expr, unit: 'length' } } as never,
          }),
        );
      const written = (['x', 'y'] as const).flatMap((axis) => {
        const text = followText(follows[axis], length, width);
        if (!text) return [];
        write(axis, text);
        return [axis];
      });
      if (written.length === 0) return;
      const values = evaluateParameters(design.doc).inputs.get(feature);
      for (const axis of written) {
        const [base, kl, kw] = follows[axis];
        const want = base + (kl * sizeOf(o, 'Length')) / 2 + (kw * sizeOf(o, 'Width')) / 2;
        const got = values?.get(axis);
        if (!got?.ok || !within(got.value, want)) write(axis, mm(want));
      }
    }

    /** S10's binder on a Part object's feature; the inputs bound (kept). */
    function bindPart(
      o: FcObject,
      featureId: string | undefined,
      sources: Record<string, string>,
      because?: string,
    ): string[] {
      const b = options.binder;
      if (!b) return [];
      b.bindPart(o, featureId, sources, because);
      const f = design.doc.features.find((x) => x.id === featureId);
      if (!f) return [];
      return Object.keys(sources).filter((input) => {
        const v = (f.inputs as Record<string, { kind?: string; expr?: string }>)[input];
        return (
          v?.kind === 'expr' && !/^\s*-?[0-9.]+(?:e-?[0-9]+)?\s*(mm|deg)?\s*$/.test(v.expr ?? '')
        );
      });
    }

    /** The file's own shape for a node, as an `import`, checked (S8's step, for trees). */
    async function leaf(o: FcObject): Promise<{ bodies: string[]; features: string[] } | Stopped> {
      const stored = storedText(doc, o);
      if (!('text' in stored)) return { stop: 'stored', detail: stored.detail };
      const chain = relChain(o);
      if (!chain) return { stop: 'chain', detail: 'its containers hold each other in a loop' };
      const conv = await convertStored(budget, stored.text, chain);
      if (conv.kind === 'out') return { stop: 'stored', detail: conv.detail ?? conv.reason };
      const existing = Object.entries(design.doc.attachments ?? {}).find(
        ([, a]) => a.sha256 === conv.sha256,
      )?.[0] as AttachmentId | undefined;
      if (existing === undefined && attachmentBytes(design) + conv.bytes.length > maxAttachments)
        return { stop: 'stored', detail: "the design's attachments are full" };
      const label = cleanName(o.label, o.name);
      let id: AttachmentId | undefined;
      const r = await attempt(o, chain, async () => {
        id = existing ?? addStepAttachment(design, label, conv.sha256, conv.bytes.length);
        const f = design.add('import', importInputs({ file: id, up: 'z' }), {
          name: `Import ${label}`,
        });
        return {
          features: [f.id],
          keeps: [],
          copies: new Map(),
          moves: 0,
          ...(existing === undefined ? { file: { id, bytes: conv.bytes } } : {}),
          measured: conv.read,
        };
      });
      if ('stop' in r) return { stop: r.stop, ...(r.detail ? { detail: r.detail } : {}) };
      if (existing === undefined && id !== undefined) files.set(id, conv.bytes);
      return { bodies: r.bodies, features: r.added.features };
    }

    /** A rebuild inside the open transaction, unchecked: what the bodies are now. */
    async function rebuildNow(): Promise<Rebuilt | Stopped> {
      let sent = new Set<string>();
      const out = await budget.call(
        () => {
          const json = design.toJSON();
          sent = new Set(json.features.map((x) => x.id));
          return budget.kernel.rebuild(json, files, settled);
        },
        (reply: unknown): reply is RebuildResult => saneRebuild(reply, sent) !== undefined,
      );
      if (out.kind !== 'done') {
        const f = callFailure(out);
        return { stop: f.reason, ...(f.detail ? { detail: f.detail } : {}) };
      }
      restartsAtRebuild = budget.restarts;
      const r = saneRebuild(out.value, sent) as SaneRebuild;
      lastBodies = r.bodies;
      return { r };
    }

    /** The box centre of some bodies (a move turns about it), from a rebuild. */
    async function pivotOf(
      bodies: readonly string[],
      r?: SaneRebuild,
    ): Promise<{ centre: Vec3 } | Stopped> {
      let rr = r;
      if (!rr) {
        const now = await rebuildNow();
        if ('stop' in now) return now;
        rr = now.r;
      }
      const ms = bodies.map((b) => rr.bodies.get(b));
      if (ms.some((m) => m === undefined))
        return { stop: 'kernel', detail: "the kernel didn't measure every body" };
      const box = combined(ms as ShapeMeasure[]).box;
      return { centre: scale3(add3(box.min, box.max), 0.5) };
    }

    /** What a node made: new bodies of its features (not copies) and the bodies it kept. */
    function resultOf(
      r: SaneRebuild,
      keeps: readonly string[],
      features: readonly string[],
    ): string[] {
      const before = new Set(known);
      const kept = new Set(keeps);
      const copyOf = (id: string) => copyPrefixes.some((p) => id.startsWith(p));
      const copyPrefixes: string[] = [];
      for (const f of features) {
        const x = design.doc.features.find((y) => y.id === f);
        if (x?.type === 'move' && (x.inputs as { copy?: { value?: boolean } }).copy?.value)
          copyPrefixes.push(`${f}:`);
      }
      return r.ids.filter((id) => (kept.has(id) || !before.has(id)) && !copyOf(id));
    }

    /**
     * Adds what `add` adds in one transaction, rebuilds, and keeps it only
     * when the node's bodies measure as its stored shape (placed in the unit's
     * frame by `chain`). Returns the node's bodies, or why it didn't hold.
     */
    async function attempt(
      o: FcObject,
      chain: readonly FcPlacement[],
      add: () => Promise<Added | Stopped>,
    ): Promise<
      | {
          bodies: string[];
          added: Added;
          drift: Drift;
          faces?: { stored: number; rebuilt: number };
        }
      | (Stopped & { drift?: Drift })
    > {
      const before = new Set(design.doc.features.map((x) => x.id));
      design.state.beginTransaction(`Import ${cleanName(o.label, o.name)}`);
      options.binder?.begin();
      let committed = false;
      try {
        const added = await add();
        if ('stop' in added) return added;
        let expected: ShapeMeasure;
        if (added.measured) expected = added.measured;
        else {
          const stored = storedText(doc, o);
          if (!('text' in stored)) return { stop: 'stored', detail: stored.detail };
          const m = await budget.call(
            () => budget.kernel.measureStoredShape(stored.text, chain),
            saneMeasure,
          );
          if (m.kind !== 'done') {
            const f = callFailure(m);
            return { stop: f.reason, ...(f.detail ? { detail: f.detail } : {}) };
          }
          expected = m.value;
        }
        let sent = new Set<string>();
        const rebuilt = await budget.call(
          () => {
            const json = design.toJSON();
            sent = new Set(json.features.map((x) => x.id));
            const sending = new Map(files);
            if (added.file) sending.set(added.file.id, added.file.bytes);
            return budget.kernel.rebuild(json, sending, settled);
          },
          (reply: unknown): reply is RebuildResult => saneRebuild(reply, sent) !== undefined,
        );
        if (rebuilt.kind !== 'done') {
          const f = callFailure(rebuilt);
          return { stop: f.reason, ...(f.detail ? { detail: f.detail } : {}) };
        }
        restartsAtRebuild = budget.restarts;
        const r = saneRebuild(rebuilt.value, sent) as SaneRebuild;
        lastBodies = r.bodies;
        const fresh = new Set(design.doc.features.map((x) => x.id).filter((id) => !before.has(id)));
        const failure = r.failed.find((x) => fresh.has(x.feature as FeatureId));
        if (failure) return { stop: 'failed', detail: failure.message };
        const bodies = resultOf(r, added.keeps, added.features);
        const measures = bodies.map((id) => r.bodies.get(id));
        if (bodies.length === 0 || measures.some((m) => m === undefined))
          return { stop: 'kernel', detail: "the kernel didn't measure every body" };
        const got = combined(measures as ShapeMeasure[]);
        const wrong = historyDisagreement(got, expected);
        if (wrong) return { stop: 'differs', detail: wrong, drift: drift(got, expected) };
        options.binder?.commit();
        design.state.commitTransaction();
        committed = true;
        known = [...r.ids];
        // An extrusion counts as the one feature its stored leaf did (S13, `MAX_TREE_EXTRUSIONS`).
        featuresAdded += o.type === 'Part::Extrusion' ? 1 : fresh.size;
        for (const f of fresh) unitFeatures.add(f);
        const counted = (measures as ShapeMeasure[]).every((m) => m.faces !== undefined)
          ? (measures as ShapeMeasure[]).reduce((t, m) => t + (m.faces as number), 0)
          : undefined;
        const faces =
          counted !== undefined && expected.faces !== undefined && counted !== expected.faces
            ? { stored: expected.faces, rebuilt: counted }
            : undefined;
        return { bodies, added, drift: drift(got, expected), ...(faces ? { faces } : {}) };
      } catch (error) {
        // Nothing a node's own work throws ends the tree: the node doesn't hold.
        return {
          stop: 'failed',
          detail: clip(`importing it failed: ${(error as Error)?.message ?? String(error)}`),
        };
      } finally {
        if (!committed) {
          options.binder?.discard();
          design.state.cancelTransaction();
          // An offset plane the node's sketch made went with it (S13: an extrusion node).
          forgetRemovedPlanes(design);
        }
      }
    }
  }
}

export type { PlannedTree };

/** S13: whether two container chains place alike (each placement equal to rounding). */
function sameChain(a: readonly FcPlacement[], b: readonly FcPlacement[]): boolean {
  const near = (x: readonly number[], y: readonly number[]) =>
    x.every((v, i) => Math.abs(v - (y[i] as number)) <= 1e-9);
  return a.every(
    (p, i) =>
      near(p.position, (b[i] as FcPlacement).position) &&
      near(p.rotation, (b[i] as FcPlacement).rotation),
  );
}
