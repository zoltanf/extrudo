/**
 * What a solid feature does with the tool it made (ADR-0028 §5, shared
 * with revolve, ADR-0029): new bodies, or join, cut and intersect with the
 * bodies it touches or the ones it names. Moved from `extrude.ts`
 * unchanged, but for the feature's words in messages and names.
 *
 * A mesh body takes part in all of it (P4-06, ADR-0066 §4): the boolean itself
 * goes to manifold-3d, the result is a mesh body named `mesh:<feature>`, and a
 * body that becomes a mesh here is told so once.
 *
 * `mergeTools` (a pattern's instances) puts two tools in one group whose boxes
 * overlap when either is **heavy** (P4-12, ADR-0067 §H2), so it never asks
 * OCCT for the distance between two long threads; `touchingBodies`, Combine's
 * join order and a Mirror's copy do ask, and a pair with a mesh in it is asked
 * manifold-3d's `minGap` (`bodiesTouch`) instead.
 */
import type { BodyId, BodyOperation } from '@extrudo/core';
import { type Kernel, KernelError, type ShapeHandle, type ShapeScope, type Vec3 } from '../kernel';
import { compareGeometry, deriveNames, type TopoNames } from '../naming/names';
import { type NamedShape, namedBoolean } from '../naming/ops';
import { LostReferenceError } from '../naming/resolve';
import type { BodyAccess, EvalContext, FeatureOutput, PreviewTool } from '../recompute/types';
import { nameMeshBodies, warnIfBecameMesh } from './mesh-bodies';
import { add, corners, dot, length, scale, sub } from './vec';

/**
 * Distances (mm) at or below which shapes touch. The facade's `kTouch` is the
 * same distance: a fuse whose tool it leaves apart within it is built again
 * with it as the fuzzy value, so a join of bodies this test calls touching
 * gives one body (ADR-0051, 2026-11-10). Change both together
 * (`join-gap.test.ts` joins at 0.9 × `TOUCH`).
 */
export const TOUCH = 1e-4;

/**
 * How close two bodies have to be when one of them is a mesh (P4-06,
 * ADR-0066 §4). A mesh body's gap comes from manifold-3d's `minGap`, whose
 * answer is capped at the length it searches, so the search is a little longer
 * than the touch distance; nanometres are close enough, since a mesh cut and
 * the body it cuts meet exactly.
 */
export const MESH_TOUCH = 1e-6;
const MESH_GAP_SEARCH = 1e-3;

/**
 * Whether two bodies touch, overlap or lie inside each other (the question a
 * join asks before it fuses and a Mirror asks before it joins a copy to its
 * original). Two solids are OCCT's `distance` at `TOUCH`; a pair with a mesh in
 * it is manifold-3d's `minGap` at `MESH_TOUCH` (ADR-0066 §4).
 */
export function bodiesTouch(ctx: EvalContext, a: ShapeHandle, b: ShapeHandle): boolean {
  const { kernel } = ctx;
  if (!kernel.isMesh(a) && !kernel.isMesh(b)) return kernel.distance(a, b) <= TOUCH;
  return kernel.minGap(a, b, MESH_GAP_SEARCH) <= MESH_TOUCH;
}

/**
 * More faces than this and a tool is **heavy** (P4-12, ADR-0067 §H2). Asking
 * OCCT for the exact distance between a heavy tool and another shape is slow
 * (between the tools of two modelled threads of 36 and 30 turns it measured
 * 277 s in one call), while merging them is cheap and always correct, so heavy
 * tools don't get the exact test. A thread's tool has about four faces a turn
 * (`thread.test.ts` counts them), so 50 turns is heavy.
 */
export const HEAVY_TOOL_FACES = 200;

/** Whether a tool is heavy (`HEAVY_TOOL_FACES`). */
export const isHeavyTool = (kernel: Kernel, shape: ShapeHandle): boolean =>
  kernel.count(shape, 'face') > HEAVY_TOOL_FACES;

/** How a feature speaks of itself in messages and names its boolean faces. */
export interface OperationWords {
  /** The feature's word in messages and the `op` of names: `extrude`, `revolve`. */
  noun: string;
  /** What to check when a cut or intersection misses: "Check its direction and distance." */
  check: string;
}

export interface OperationSettings {
  operation: BodyOperation;
  /** Explicit participants (body IDs); empty means automatic. */
  bodies: string[];
}

/**
 * An operation feature's body access (ADR-0024's amendments on `add` access and on operations):
 * `view` for a cut or intersect of picked bodies (they and the bodies its other references name
 * are the view); for a new body, `add` with no picked bodies when its tool reads no body; for a
 * join, cut or intersect of the bodies its tool touches (automatic, or a join of picked bodies),
 * `touch` when its tool reads bodies only through its face, edge or vertex references (rule R: the
 * engine keeps the tool by those bodies' versions); else `write`. `tool`: what each answer needs,
 * `add` (the tool reads no body: every reference upstream or none) and `touch` (it reads none, or
 * only through such references: true wherever `add` is); and whether it sizes its tool from every
 * body other than through `EvalContext.reach` or `farthest` (`everyBody`: `write`; a revolve up to
 * a body, which cuts with that body, or a picked cut up to an object, whose view can't give every
 * body's box).
 */
export function operationAccess(
  settings: { operation: BodyOperation; bodies: readonly string[] },
  tool: { add: boolean; touch: boolean; everyBody?: boolean },
): BodyAccess {
  const picked = settings.bodies.length > 0;
  if (tool.everyBody) return 'write';
  if (picked && (settings.operation === 'cut' || settings.operation === 'intersect')) return 'view';
  if (settings.operation === 'new-body') return tool.add && !picked ? 'add' : 'write';
  // Automatic participants, or picked ones joined (a picked cut or intersect is `view` above).
  return tool.touch ? 'touch' : 'write';
}

/** The bodies named in `bodies`, or undefined for "automatic". */
export function explicitBodies(
  ctx: EvalContext,
  settings: OperationSettings,
  words: OperationWords,
): BodyId[] | undefined {
  if (settings.bodies.length === 0) return undefined;
  const ids = [...new Set(settings.bodies)] as BodyId[];
  const gone = ids.find((id) => !ctx.bodies.has(id));
  if (gone !== undefined) {
    throw new LostReferenceError(
      `One of the bodies to ${verb(settings.operation)} no longer exists. Edit the ${words.noun} and pick the bodies again.`,
      { kind: 'body', id: gone },
    );
  }
  return ids;
}

/**
 * A tool made of many solids that may overlap each other (P3-17: a pattern's
 * instances for a cut). `shape` holds all of them (for drawing and for finding the bodies
 * they touch); `passes` are compounds of solids that don't interfere, each a
 * valid boolean argument, which a join or cut applies one after the other: the
 * result is the same as one boolean with their union, without fusing them
 * first. A tool of one pass is an ordinary tool.
 */
export interface ToolSet extends NamedShape {
  passes: readonly NamedShape[];
  /** More than one pass: `shape` is not a valid boolean argument. */
  interferes: boolean;
}

/** What a solid feature's operation found (its `FeatureOutput.report`): the dialog's smarter Bodies default (ADR-0095). */
export interface OperationReport {
  /**
   * The bodies the tool touches (`touchingBodies`), in creation order: the automatic participants.
   * Empty for a new body, and for picked bodies cut or intersected (not asked).
   */
  touching: BodyId[];
}

export const isOperationReport = (x: unknown): x is OperationReport =>
  Array.isArray((x as { touching?: unknown } | null | undefined)?.touching);

export function operate(
  ctx: EvalContext,
  scope: ShapeScope,
  settings: OperationSettings,
  tool: NamedShape | ToolSet,
  participants: BodyId[] | undefined,
  warnings: string[],
  words: OperationWords,
): Pick<FeatureOutput, 'bodies' | 'names' | 'previewTools' | 'touched'> & {
  report: OperationReport;
} {
  const { kernel } = ctx;
  const operation = settings.operation;
  if (operation === 'new-body') {
    return { ...newBodies(ctx, scope, tool, words), report: { touching: [] } };
  }

  // A cut or intersection of picked bodies doesn't need the question (the exact
  // distance is slow for a thread's heavy tools, ADR-0067 §H2): its report has none.
  const touching =
    participants && operation !== 'join' ? [] : touchingBodies(ctx, scope, tool.shape);
  const report: OperationReport = { touching };
  // Asked of every body (automatic participants, or a join of picked ones): the tool and what it
  // touched, for a `touch` key (ADR-0024).
  const touched =
    participants && operation !== 'join' ? {} : { touched: { tool: tool.shape, bodies: touching } };
  const targets = participants ?? touching;
  const set = 'passes' in tool && tool.interferes ? tool : undefined;
  // Kept only on success: a failure below must release the tool with the scope.
  const preview = (): PreviewTool[] => [
    {
      shape: scope.keep(tool.shape),
      style: operation,
      names: tool.names,
      ...(set && { interferes: true }),
    },
  ];
  const named = (id: BodyId): NamedShape => ({
    shape: ctx.bodies.get(id) as ShapeHandle,
    names: ctx.names(id),
  });
  const options = { feature: ctx.feature.id, op: words.noun };

  if (operation === 'join') {
    // Bodies picked to join that the tool doesn't touch stay as they are: a
    // fuse would only gather them with the tool, and the split after it would
    // make the tool a new body without a word (#87).
    let joining = targets;
    if (participants) {
      const reached = new Set(touching);
      joining = participants.filter((id) => reached.has(id));
      const apart = participants.length - joining.length;
      if (joining.length === 0) {
        const them = participants.length === 1 ? 'the body' : 'any of the bodies';
        warnings.push(`It doesn't touch ${them} it joins, so the ${words.noun} made a new body.`);
        return {
          ...newBodies(ctx, scope, tool, words),
          previewTools: preview(),
          report,
          ...touched,
        };
      }
      if (apart > 0) {
        warnings.push(
          `It doesn't touch ${apart} of the bodies it joins: ${apart === 1 ? 'that one stays' : 'they stay'} separate.`,
        );
      }
    }
    const [first, ...rest] = joining;
    if (first === undefined) {
      warnings.push(`Nothing to join to, so the ${words.noun} made a new body.`);
      return { ...newBodies(ctx, scope, tool, words), previewTools: preview(), report, ...touched };
    }
    // (A tool set of overlapping instances is only made for cuts: joins fuse them first.)
    if (set) throw new KernelError(`Overlapping instances can't be joined in passes.`);
    let joined = namedBoolean(kernel, 'fuse', named(first), tool, { ...options, simplify: true });
    scope.track(joined.shape);
    for (const id of rest) {
      joined = namedBoolean(kernel, 'fuse', joined, named(id), { ...options, simplify: true });
      scope.track(joined.shape);
    }
    const bodies = new Map(ctx.bodies);
    for (const id of rest) bodies.delete(id);
    bodies.set(first, scope.keep(joined.shape));
    return nameMeshBodies(ctx, {
      bodies,
      names: new Map([[first, joined.names]]),
      previewTools: preview(),
      report,
      ...touched,
    });
  }

  const op = operation === 'cut' ? 'cut' : 'common';
  if (set && op === 'common') {
    // The intersection with a union isn't a sequence of intersections.
    throw new KernelError(`Overlapping instances can't be intersected. ${words.check}`);
  }
  const changed = new Map<BodyId, NamedShape | undefined>();
  for (const id of targets) {
    const before = named(id);
    let result = before;
    // One boolean per pass, each on what the last left; a pass that removes the body ends it.
    for (const pass of set?.passes ?? [tool]) {
      // Passes simplify (merge faces the next pass split again): the fused tool they stand
      // in for had its faces merged, so the walls of overlapping instances stay whole.
      result = namedBoolean(
        kernel,
        op,
        result,
        pass,
        set ? { ...options, simplify: true } : options,
      );
      scope.track(result.shape);
      if (set && kernel.measure(result.shape).volume <= 0) break;
    }
    // A solid that a mesh has swallowed is a mesh from here on (ADR-0066 §4).
    warnIfBecameMesh(ctx, before.shape, result.shape);
    const was = kernel.measure(before.shape).volume;
    const now = kernel.measure(result.shape).volume;
    const eps = 1e-6 * Math.max(1, Math.abs(was));
    if (op === 'cut' && Math.abs(was - now) <= eps) continue;
    if (now > eps) {
      changed.set(id, result);
    } else if (op === 'cut') {
      changed.set(id, undefined);
      warnings.push('The cut removed a whole body.');
    } else if (participants) {
      throw new KernelError(
        `Nothing is left of one of its bodies after the intersection. Check the ${words.noun}, or pick other bodies.`,
      );
    }
    // An automatic intersect target it only touches stays as it is.
  }
  if (changed.size === 0) {
    if (op === 'cut') {
      throw new KernelError(
        targets.length === 0
          ? `The cut doesn't touch any body. ${words.check}`
          : `The cut doesn't remove anything. ${words.check}`,
      );
    }
    throw new KernelError(
      `The ${words.noun} doesn't overlap any body, so there's nothing to intersect. ${words.check}`,
    );
  }
  const bodies = new Map(ctx.bodies);
  const names = new Map<BodyId, TopoNames>();
  for (const [id, result] of changed) {
    if (!result) {
      bodies.delete(id);
      continue;
    }
    bodies.set(id, scope.keep(result.shape));
    names.set(id, result.names);
  }
  return nameMeshBodies(ctx, { bodies, names, previewTools: preview(), report, ...touched });
}

/** A box as `Kernel.measure` gives it (loose: it never cuts into the shape). */
export interface Box {
  min: readonly number[];
  max: readonly number[];
}

/** A length below which a reach or a side is none (mm). */
export const LENGTH_EPS = 1e-6;

/**
 * How far boxes reach past `point` along the unit `along`: the farthest corner's distance,
 * negative when every box lies behind `point` (unclamped), undefined for no boxes. A caller that
 * needs at least 0 clamps itself (`throughMargin` for an extrude through all, the hole's
 * `Math.max` in `throughLength`); `bodiesBox` reads the boxes' extent along each axis from it.
 * What those tools take from the bodies, and what the engine keys such a tool by (ADR-0024's rule
 * B, `EvalContext.reach`): one function, so the two can't differ.
 */
export function reachAlong(
  boxes: readonly Box[],
  point: readonly number[],
  along: readonly number[],
): number | undefined {
  return reachOver(
    boxes.map((box) => corners(box.min as Vec3, box.max as Vec3)),
    point,
    along,
  );
}

/** `reachAlong` over each box's eight corners (`corners`), as the engine keeps them by version. */
export function reachOver(
  cornerSets: readonly (readonly Vec3[])[],
  point: readonly number[],
  along: readonly number[],
): number | undefined {
  if (cornerSets.length === 0) return undefined;
  // Unclamped: negative when every box lies behind `point` (its callers clamp at 0 themselves),
  // so the reach along an axis from the origin is the boxes' extent that way (`bodiesBox`).
  let far = Number.NEGATIVE_INFINITY;
  for (const set of cornerSets) {
    for (const c of set) far = Math.max(far, dot(sub(c, point as Vec3), along as Vec3));
  }
  return far;
}

/**
 * How far from `point` the boxes' lowest and highest corners (`corners`' first and last) lie at
 * most, undefined for no boxes: what a revolve up to an object sizes its target by
 * (`sweepToObject`), and what the engine keys it by (`EvalContext.farthest`, rule B).
 */
export function farOver(
  cornerSets: readonly (readonly Vec3[])[],
  point: readonly number[],
): number | undefined {
  if (cornerSets.length === 0) return undefined;
  let far = Number.NEGATIVE_INFINITY;
  for (const set of cornerSets) {
    const lo = length(sub(set[0] as Vec3, point as Vec3));
    far = Math.max(far, length(sub(set[set.length - 1] as Vec3, point as Vec3)), lo);
  }
  return far;
}

/**
 * Every body's box, for an evaluator that sizes a tool from them without the engine's questions.
 * It reads `size` first: a `view` evaluator can't see every body, and that read is noticed there,
 * so it runs as `write`.
 */
export function everyBodyBox(ctx: EvalContext): Box[] {
  // Not only a shortcut: this `size` read is what a view notices (a picked cut up to a curved face
  // falls back to `write` here), where iterating the bodies would go unnoticed.
  if (ctx.bodies.size === 0) return [];
  return [...ctx.bodies.values()].map((shape) => ctx.kernel.measureBox(shape));
}

/** An extrude's through-all length from `reachAlong`'s: 0 for none, else 5% more (≥ 1 mm). */
export const throughMargin = (far: number): number =>
  far <= LENGTH_EPS ? 0 : far + Math.max(1, 0.05 * far);

/** Whether two boxes meet or lie within `TOUCH` of each other. */
export const boxesTouch = (a: Box, b: Box): boolean =>
  [0, 1, 2].every(
    (k) =>
      (a.min[k] as number) <= (b.max[k] as number) + TOUCH &&
      (b.min[k] as number) <= (a.max[k] as number) + TOUCH,
  );

/**
 * The bodies a tool touches (within `TOUCH`), for an operation with automatic
 * participants. One exact `distance` between a body and the whole tool is slow
 * when the tool is many solids (a pattern's 40 holes: seconds per body), and
 * most pairs are far apart, so: a body whose box doesn't meet the tool's box
 * is out, and the others are asked solid by solid of the tool, boxes first
 * (P3-17). The exact answer is the same.
 *
 * A mesh body has no B-rep distance, so a pair with a mesh in it is asked
 * manifold-3d's `minGap` instead (ADR-0066 §4), within `MESH_TOUCH`.
 */
export function touchingBodies(ctx: EvalContext, scope: ShapeScope, tool: ShapeHandle): BodyId[] {
  const { kernel } = ctx;
  const toolBox = kernel.measureBox(tool);
  // What the engine already asked this tool of a body (`ctx.touched`, a `touch` feature): the same
  // answer, not asked again.
  const known = new Map<BodyId, boolean>();
  const near: { id: BodyId; shape: ShapeHandle; box: Box }[] = [];
  for (const [id, shape] of ctx.bodies) {
    const answer = ctx.touched?.(id);
    if (answer !== undefined) {
      known.set(id, answer);
      continue;
    }
    const box = kernel.measureBox(shape);
    if (boxesTouch(box, toolBox)) near.push({ id, shape, box });
  }
  const asked = new Set(near.length === 0 ? [] : askNear(ctx, scope, tool, near));
  return [...ctx.bodies.keys()].filter((id) => known.get(id) ?? asked.has(id));
}

/** Which of the bodies whose box meets the tool's the tool touches (`touchingBodies`). */
function askNear(
  ctx: EvalContext,
  scope: ShapeScope,
  tool: ShapeHandle,
  near: readonly { id: BodyId; shape: ShapeHandle; box: Box }[],
): BodyId[] {
  const { kernel } = ctx;
  const touches = (a: ShapeHandle, b: ShapeHandle): boolean => bodiesTouch(ctx, a, b);
  const solids = kernel.solids(tool);
  for (const solid of solids) scope.track(solid);
  // One solid (or something that has none): the exact distance to the whole tool.
  if (solids.length < 2) {
    return near.filter(({ shape }) => touches(shape, tool)).map(({ id }) => id);
  }
  const parts = solids.map((shape) => ({ shape, box: kernel.measureBox(shape) }));
  return near
    .filter(({ shape, box }) =>
      parts.some((part) => boxesTouch(box, part.box) && touches(shape, part.shape)),
    )
    .map(({ id }) => id);
}

/** The tool as new bodies: one per separate solid, in geometric order. */
export function newBodies(
  ctx: EvalContext,
  scope: ShapeScope,
  tool: NamedShape,
  words: OperationWords,
): Pick<FeatureOutput, 'bodies' | 'names'> {
  const { kernel } = ctx;
  const bodies = new Map(ctx.bodies);
  const names = new Map<BodyId, TopoNames>();
  const solids = kernel.solids(tool.shape);
  for (const solid of solids) scope.track(solid);
  if (solids.length === 0) {
    throw new KernelError(`The ${words.noun} made no solid. Check its profiles.`);
  }
  if (solids.length === 1) {
    const id = ctx.bodyId(0);
    bodies.set(id, scope.keep(tool.shape));
    names.set(id, tool.names);
    return { bodies, names };
  }
  const placed = solids.map((solid) => {
    const { min, max } = kernel.measureBox(solid);
    return { solid, center: scale(add(min, max), 0.5) };
  });
  placed.sort((a, b) => compareGeometry(a.center, b.center));
  const named = placed.map(({ solid }) => {
    const faces = kernel.locate(solid, tool.shape, 'face').map((at) => tool.names.faces[at] ?? '');
    return { solid, names: deriveNames(faces, kernel.describe(solid)) };
  });
  named.forEach(({ solid, names: table }, i) => {
    const id = ctx.bodyId(i);
    names.set(id, table);
    bodies.set(id, scope.keep(solid));
  });
  return { bodies, names };
}

function verb(operation: BodyOperation): string {
  return operation === 'new-body' ? 'use' : operation;
}
