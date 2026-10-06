/**
 * The pattern features in the kernel (P3-07, ADR-0047, FR-FT-11): rectangular,
 * circular and on-path patterns of bodies or of features, and the replay of
 * features that Mirror shares.
 *
 * Every instance is a rigid motion of the original (`Placement.matrix`, one
 * `Kernel.transform` each), and the original counts as instance 0. What
 * happens with the copies depends on `objects`:
 *
 * - **bodies**: each copy is a new body (`<feature>:<n>`, `n` from the
 *   instance's slot, so it stays while counts grow), or with `join` all the
 *   copies of a body are fused into it with one boolean.
 * - **features**: the tool the chosen solid feature made (`previewTools`:
 *   extrude, revolve, primitives that join or cut) is copied to every
 *   instance, the copies are merged into one tool, and one boolean joins or
 *   cuts it with the bodies it touches, like the feature did.
 *
 * Names: every face of a copy is `<op>:<feature>:<label>:from:(<name>)`
 * (`label` is the instance's, `2`, `m1`, `1x2`), so a reference to a face
 * of one instance keeps meaning that face when the count changes.
 *
 * Instances that overlap or touch each other can't go into one boolean as a
 * compound (OCCT refuses a compound argument whose solids interfere), so
 * `mergeTools` fuses each group of interfering instances (a tree of
 * booleans) and hands the groups to the boolean as one compound. A **cut** of
 * features does without the fuse (P3-17, `toolSet`): it colours the
 * interference graph and cuts one colour class (a compound of instances that
 * don't meet) at a time.
 *
 * Only `mergeTools` guesses for heavy tools (P4-12, ADR-0067 §H2): a colour
 * class has to be a valid boolean argument, so a wrong "these two meet" costs
 * a pass, and enough of them fall back to the fuse `mergeTools` does.
 */
import {
  type BodyId,
  type CircularPatternInputs,
  circularPatternFeature,
  circularSettings,
  type FeatureId,
  type GeomRef,
  isOriginalLabel,
  type PathPatternInputs,
  type PatternObjectSettings,
  type PatternSeries,
  pairSlots,
  pathPatternFeature,
  pathSettings,
  type RectangularPatternInputs,
  rectangularPatternFeature,
  rectangularSettings,
  seriesStep,
} from '@extrudo/core';
import { unionBox } from '../inspect';
import { KernelError, type ShapeHandle, type ShapeScope, type Vec3 } from '../kernel';
import { deriveNames, type TopoNames } from '../naming/names';
import { type NamedShape, namedBoolean } from '../naming/ops';
import { LostReferenceError } from '../naming/resolve';
import type {
  EvalContext,
  FeatureOutput,
  KernelFeatureDefinition,
  PreviewTool,
} from '../recompute/types';
import { splitSolids } from './bodies';
import { nameMeshBodies, transformedNames, warnIfBecameMesh } from './mesh-bodies';
import {
  type Box,
  bodiesTouch,
  boxesTouch,
  isHeavyTool,
  type OperationWords,
  operate,
  type ToolSet,
} from './operation';
import {
  circularPlacements,
  circularSeries,
  limitInstances,
  type Placement,
  pathPlacements,
  pathSeries,
  patternReport,
  type Row,
  rectangularPlacements,
  rectangularSeries,
  rowStep,
  wholeCount,
} from './pattern-layout';
import { pathFromRefs } from './pattern-path';
import { lineOf } from './references';

const RADIANS = Math.PI / 180;

/** How a pattern speaks of itself in messages (`operate`). */
const WORDS: OperationWords = {
  noun: 'pattern',
  check: "Check the pattern's direction, count and distance.",
};

/** What a pattern feature's settings give an evaluator: what it repeats, and the instances it skips. */
type PatternSettings = PatternObjectSettings & { skip: readonly string[] };

/** A pattern's instances, split into the ones it makes and the ones `skip` leaves out. */
interface Layout {
  /** The instances that are made; the original is not among them. */
  placements: Placement[];
  /** The ones `skip` names: ghosts in the preview, nothing in the result. */
  skipped: Placement[];
}

/**
 * Splits a layout into what a pattern makes and what it skips (P4-12): the
 * original is never moved and never skipped, a label past the count is
 * ignored (so a skip comes back when the count grows), and listing the
 * original is refused with a message.
 */
function splitSkip(skip: readonly string[], all: readonly Placement[]): Layout {
  const listed = new Set(skip);
  for (const label of listed) {
    if (isOriginalLabel(label)) throw new KernelError("The original can't be skipped.");
  }
  const placements: Placement[] = [];
  const skipped: Placement[] = [];
  for (const placement of all) {
    if (placement.original === true) continue;
    if (listed.has(placement.label)) skipped.push(placement);
    else placements.push(placement);
  }
  return { placements, skipped };
}

/**
 * The middle of what a pattern repeats: the box centre of the bodies it
 * copies, or of the first feature's tool (P4-12: the anchor its report puts
 * the instances' centres on). The bodies of the model are the fallback, so a
 * pattern that can't be made yet still has somewhere to put its report.
 */
function sourceCentre(ctx: EvalContext, settings: PatternObjectSettings): Vec3 {
  const shapes: ShapeHandle[] = [];
  if (settings.objects === 'bodies') {
    for (const ref of settings.bodies) {
      const shape = ctx.bodies.get(ref.id as BodyId);
      if (shape !== undefined) shapes.push(shape);
    }
  }
  const first = settings.features[0];
  if (settings.objects === 'features' && first) {
    try {
      const tool = ctx.output(first.id as FeatureId).previewTools?.[0];
      if (tool) shapes.push(tool.shape);
    } catch {
      // A lost feature: the evaluator says so; the report is only a hint.
    }
  }
  if (shapes.length === 0) shapes.push(...ctx.bodies.values());
  const boxes: { min: Vec3; max: Vec3 }[] = [];
  for (const shape of shapes) {
    try {
      const { min, max } = ctx.kernel.measure(shape).bbox;
      const at = (v: readonly number[], k: number) => v[k] ?? 0;
      boxes.push({
        min: [at(min, 0), at(min, 1), at(min, 2)],
        max: [at(max, 0), at(max, 1), at(max, 2)],
      });
    } catch {
      // A shape OCCT can't measure (a mesh's, if it ever happens): skip it.
    }
  }
  const box = unionBox(boxes);
  const at = (k: number) => (box ? ((box.min[k] ?? 0) + (box.max[k] ?? 0)) / 2 : 0);
  return [at(0), at(1), at(2)];
}

// ---------------------------------------------------------------- copies

/** The role part of a copy's face names: `2:from`, or `from` for a single unlabelled copy. */
const roleOf = (label: string) => (label === '' ? 'from' : `${label}:from`);

/**
 * `source` moved by the placement and named as a copy: its faces
 * `<op>:<feature>:<label>:from:(<name>)`, edges and vertices from those.
 * The new shape belongs to `scope`.
 */
function replicate(
  ctx: EvalContext,
  scope: ShapeScope,
  source: NamedShape,
  placement: Placement,
  op: string,
): NamedShape {
  const { kernel } = ctx;
  const result = kernel.transform(source.shape, placement.matrix);
  // A mesh body's one face follows the same copy rule as a solid's (ADR-0066 §4).
  const names = transformedNames(ctx, result, source.names, {
    op,
    role: roleOf(placement.label),
  });
  scope.track(result.shape);
  return { shape: result.shape, names };
}

/**
 * Copies merged into one shape for a single boolean: instances that touch
 * or overlap are fused (a tree of booleans, so no shape grows more than
 * twice as fast as the tree is deep), and the fused groups, which don't
 * interfere, become one compound. A lone group is returned as it is.
 *
 * Two instances whose boxes meet are put in one group without asking OCCT
 * for the exact distance when either is **heavy** (more than
 * `HEAVY_TOOL_FACES` faces, ADR-0067 §H2) or when the parts are a **pattern's
 * copies** (P4-12, ADR-0047's amendment). Fusing instances that only nearly
 * touch is still correct: a fuse of disjoint solids is a compound, so the
 * boolean after it takes their union. A pattern's copies are a field of one
 * tool, so a pair that needn't have been fused is cheap to fuse anyway, while
 * the exact `distance` measured 6-8 ms a call (100 calls in a 10x10 join). A
 * feature's own tool parts (a thread's bands, a hole's holes, an emboss's
 * letters) keep the exact test, which tells a near miss from a touch: two
 * light thread bands' boxes overlap 5 mm although the bands don't meet.
 */
export function mergeTools(
  ctx: EvalContext,
  scope: ShapeScope,
  parts: readonly NamedShape[],
  op: string,
): NamedShape {
  const { kernel } = ctx;
  if (parts.length === 1) return parts[0] as NamedShape;
  const boxes = parts.map((p) => kernel.measure(p.shape).bbox);
  const heavy = parts.map((p) => isHeavyTool(kernel, p.shape));
  const boxOnly = op === 'pattern' || op === 'mirror';
  // Groups of instances that interfere: boxes that meet, then the exact distance.
  const group = parts.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (group[root] !== root) root = group[root] as number;
    return root;
  };
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      if (find(i) === find(j) || !boxesTouch(boxes[i] as Box, boxes[j] as Box)) continue;
      if (boxOnly || (heavy[i] as boolean) || (heavy[j] as boolean)) {
        group[find(j)] = find(i);
        continue;
      }
      const a = parts[i] as NamedShape;
      const b = parts[j] as NamedShape;
      if (bodiesTouch(ctx, a.shape, b.shape)) group[find(j)] = find(i);
    }
  }
  const groups = new Map<number, NamedShape[]>();
  parts.forEach((part, i) => {
    const members = groups.get(find(i)) ?? [];
    members.push(part);
    groups.set(find(i), members);
  });
  const fused = [...groups.values()].map((members) => fuseTree(ctx, scope, members, op));
  return compoundOf(ctx, scope, fused);
}

/** The most passes a tool set may take; more interference than that is fused instead. */
const MAX_PASSES = 8;

/**
 * Copies for a join or cut (P3-17): instances that touch or overlap would have
 * to be fused into one valid tool (`mergeTools`), which costs about as much as
 * the boolean itself. Instead the **interference graph is coloured** (first fit,
 * in instance order): each colour class is a compound of instances that don't
 * meet, a valid boolean argument, and `operate` applies the classes one after
 * the other: the same result as one boolean with their union. A grid of
 * overlapping holes is two classes. Without interference it is the one compound
 * `mergeTools` makes. With more than `MAX_PASSES` classes (a dense knot of
 * instances) it falls back to fusing.
 *
 * A pattern's copies are coloured on their **boxes alone** (P4-12, ADR-0047's
 * amendment): a box is conservative, so a "meet" may add an edge the exact
 * distance would not, which can only split a class and never lets two
 * interfering instances share one — and it saves a `distance` per box pair
 * (measured: 341 calls of 6-8 ms for a 10x10 grid, where `mergeTools`'
 * union-find needed about 100).
 */
export function toolSet(
  ctx: EvalContext,
  scope: ShapeScope,
  parts: readonly NamedShape[],
  op: string,
): ToolSet {
  const { kernel } = ctx;
  if (parts.length === 1) {
    const only = parts[0] as NamedShape;
    return { ...only, passes: [only], interferes: false };
  }
  const boxes = parts.map((p) => kernel.measure(p.shape).bbox);
  // Who meets whom: boxes that meet (no exact distance, see above).
  const meets: number[][] = parts.map(() => []);
  let interfering = false;
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      if (!boxesTouch(boxes[i] as Box, boxes[j] as Box)) continue;
      (meets[i] as number[]).push(j);
      (meets[j] as number[]).push(i);
      interfering = true;
    }
  }
  if (!interfering) {
    const whole = compoundOf(ctx, scope, parts);
    return { ...whole, passes: [whole], interferes: false };
  }
  // First-fit colouring in instance order (the lowest class no neighbour has).
  const colour: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const taken = new Set((meets[i] as number[]).filter((j) => j < i).map((j) => colour[j]));
    let c = 0;
    while (taken.has(c)) c++;
    colour.push(c);
  }
  const classes = Math.max(...colour) + 1;
  if (classes > MAX_PASSES) {
    const merged = mergeTools(ctx, scope, parts, op);
    return { ...merged, passes: [merged], interferes: false };
  }
  const passes = Array.from({ length: classes }, (_, c) =>
    compoundOf(
      ctx,
      scope,
      parts.filter((_, i) => colour[i] === c),
    ),
  );
  // All instances in one shape, for drawing and for finding what they touch.
  const whole = compoundOf(ctx, scope, parts);
  return { ...whole, passes, interferes: true };
}

/** A tool that is one valid shape, as a tool set of one pass. */
const fused = (tool: NamedShape): ToolSet => ({ ...tool, passes: [tool], interferes: false });

/** Shapes as one compound with their names (a lone shape is returned as it is). */
function compoundOf(ctx: EvalContext, scope: ShapeScope, parts: readonly NamedShape[]): NamedShape {
  const { kernel } = ctx;
  if (parts.length === 1) return parts[0] as NamedShape;
  const compound = kernel.compound(parts.map((f) => f.shape));
  scope.track(compound);
  const faces: string[] = new Array(kernel.count(compound, 'face')).fill('');
  for (const part of parts) {
    kernel.locate(part.shape, compound, 'face').forEach((at, k) => {
      if (at >= 0) faces[at] = part.names.faces[k] ?? '';
    });
  }
  return { shape: compound, names: deriveNames(faces, kernel.describe(compound)) };
}

/** Members fused pairwise, halves first. */
function fuseTree(
  ctx: EvalContext,
  scope: ShapeScope,
  members: readonly NamedShape[],
  op: string,
): NamedShape {
  if (members.length === 1) return members[0] as NamedShape;
  const mid = members.length >> 1;
  const a = fuseTree(ctx, scope, members.slice(0, mid), op);
  const b = fuseTree(ctx, scope, members.slice(mid), op);
  const joined = namedBoolean(ctx.kernel, 'fuse', a, b, {
    feature: ctx.feature.id,
    op,
    simplify: true,
  });
  scope.track(joined.shape);
  return joined;
}

// ---------------------------------------------------------------- bodies

/** The bodies a pattern or mirror works on, by ID; a body that is gone is a lost reference. */
export function existingBodies(ctx: EvalContext, refs: readonly GeomRef[], what: string): BodyId[] {
  if (refs.length === 0) throw new KernelError(`Pick the bodies to ${what}.`);
  return refs.map((ref) => {
    if (!ctx.bodies.has(ref.id as BodyId)) {
      throw new LostReferenceError(
        `One of the bodies to ${what} no longer exists. Edit ${ctx.feature.name} and pick the bodies again.`,
        ref,
      );
    }
    return ref.id as BodyId;
  });
}

function patternBodies(
  ctx: EvalContext,
  scope: ShapeScope,
  settings: PatternSettings,
  layout: Layout,
  op: string,
): FeatureOutput {
  const { kernel } = ctx;
  const ids = existingBodies(ctx, settings.bodies, 'pattern');
  const bodies = new Map(ctx.bodies);
  const names = new Map<BodyId, TopoNames>();
  const previewTools: PreviewTool[] = [];
  const warnings: string[] = [];
  // Kept only when every body worked: a failure releases them all with the scope.
  const kept: ShapeHandle[] = [];
  ids.forEach((id, bodyIndex) => {
    const original: NamedShape = { shape: ctx.bodies.get(id) as ShapeHandle, names: ctx.names(id) };
    const copies = layout.placements.map((placement) => ({
      placement,
      named: replicate(ctx, scope, original, placement, op),
    }));
    // What a skipped instance would have been, drawn faint (P4-12).
    for (const placement of layout.skipped) {
      const ghost = replicate(ctx, scope, original, placement, op);
      previewTools.push({ shape: ghost.shape, style: 'skip' });
      kept.push(ghost.shape);
    }
    if (!settings.join) {
      for (const { placement, named } of copies) {
        // The instance's slot and the body's position make the ID, so it stays when counts grow.
        const copyId = ctx.bodyId(pairSlots(placement.slot, bodyIndex));
        bodies.set(copyId, named.shape);
        kept.push(named.shape);
        names.set(copyId, named.names);
      }
      return;
    }
    if (layout.placements.length === 0) {
      // Every instance is skipped: the ghosts above are the whole preview.
      for (const shape of new Set(kept)) scope.keep(shape);
      return;
    }
    // Joined copies are fused (a tree) first: measured faster than one fuse per colour class.
    const tool = mergeTools(
      ctx,
      scope,
      copies.map((c) => c.named),
      op,
    );
    const joined = namedBoolean(kernel, 'fuse', original, tool, {
      feature: ctx.feature.id,
      op,
      simplify: true,
    });
    scope.track(joined.shape);
    warnIfBecameMesh(ctx, original.shape, joined.shape);
    bodies.set(id, joined.shape);
    kept.push(joined.shape);
    names.set(id, joined.names);
    previewTools.push({ shape: tool.shape, style: 'join', names: tool.names });
    kept.push(tool.shape);
  });
  for (const shape of new Set(kept)) scope.keep(shape);
  const result = nameMeshBodies(
    ctx,
    settings.join
      ? splitSolids(ctx, scope, { bodies, names, previewTools })
      : { bodies, names, previewTools },
  );
  if (settings.join && result.bodies.size > ctx.bodies.size) {
    warnings.push(
      "Some instances don't touch their body, so they are separate bodies. Bring them closer, or turn Join off.",
    );
  }
  return { ...result, ...(warnings.length ? { warnings } : {}) };
}

// -------------------------------------------------------------- features

/**
 * Replays the tools of features at each placement and applies each feature's
 * operation (join or cut) to the bodies its instances touch. The features
 * are taken in the order given, each working on what the last left. The
 * placements `skip` names (P4-12) make no cut or join, only the faint ghost
 * of what they would have done.
 * Shared with Mirror (`op` `mirror`, one placement, nothing skipped).
 */
export function replayFeatures(
  ctx: EvalContext,
  scope: ShapeScope,
  refs: readonly GeomRef[],
  layout: Layout,
  op: string,
): FeatureOutput {
  if (refs.length === 0) throw new KernelError('Pick the features to repeat.');
  let bodies: ReadonlyMap<BodyId, ShapeHandle> = ctx.bodies;
  const names = new Map<BodyId, TopoNames>();
  const previewTools: PreviewTool[] = [];
  const warnings: string[] = [];
  const original = new Set(ctx.bodies.values());
  // What the rounds so far made and `operate` kept, tracked again until the last round has
  // worked: a round that fails releases them all with the scope.
  const held = new Set<ShapeHandle>();
  const adopt = (shape: ShapeHandle) => {
    if (original.has(shape) || held.has(shape)) return;
    held.add(shape);
    scope.track(shape);
  };
  // The ghosts of the skipped instances (`replicate` tracked them once already).
  const ghosts: ShapeHandle[] = [];

  refs.forEach((ref, k) => {
    const id = ref.id as FeatureId;
    const label = ctx.featureName(id) ?? 'A feature';
    let tool: PreviewTool | undefined;
    try {
      tool = ctx.output(id).previewTools?.[0];
    } catch {
      throw new LostReferenceError(
        `One of the features to repeat no longer exists. Edit ${ctx.feature.name} and pick the features again.`,
        ref,
      );
    }
    if (!tool?.names || (tool.style !== 'join' && tool.style !== 'cut')) {
      throw new KernelError(
        `${label} doesn't join or cut anything, so there is nothing to repeat. Pattern or mirror its body instead.`,
      );
    }
    if (tool.interferes) {
      throw new KernelError(
        `${label} repeats a tool whose instances overlap, which can't be repeated again. Repeat the feature it repeats, or pattern its body instead.`,
      );
    }
    const source: NamedShape = { shape: tool.shape, names: tool.names };
    const copies = layout.placements.map((placement) =>
      replicate(ctx, scope, source, placement, op),
    );
    // What a skipped instance would have cut or joined, drawn faint (P4-12).
    for (const placement of layout.skipped) {
      const ghost = replicate(ctx, scope, source, placement, op);
      previewTools.push({ shape: ghost.shape, style: 'skip' });
      ghosts.push(ghost.shape);
    }
    // Every instance is skipped: only the ghosts above.
    if (layout.placements.length === 0) return;
    // Cuts go one colour class at a time (half the time of fusing the holes first, in the
    // overlapping 10 × 10 case); joins fuse the copies first, which was measured faster.
    const merged =
      tool.style === 'cut'
        ? toolSet(ctx, scope, copies, op)
        : fused(mergeTools(ctx, scope, copies, op));

    // The bodies as the last feature left them; new bodies get IDs of their own.
    const before = bodies;
    const step: EvalContext = {
      ...ctx,
      bodies: before,
      names: (body) => names.get(body) ?? ctx.names(body),
      bodyId: (n = 0) => ctx.bodyId(n + k * 1000),
    };
    const result = splitSolids(
      step,
      scope,
      operate(
        step,
        scope,
        { operation: tool.style, bodies: [] },
        merged,
        undefined,
        warnings,
        WORDS,
      ),
    );
    bodies = result.bodies ?? before;
    for (const shape of bodies.values()) adopt(shape);
    for (const tool of result.previewTools ?? []) adopt(tool.shape);
    for (const [body, table] of result.names ?? []) names.set(body, table);
    previewTools.push(...(result.previewTools ?? []));
    if (tool.style === 'join' && bodies.size > before.size) {
      warnings.push(`Some instances of ${label} don't touch a body, so they are separate bodies.`);
    }
  });
  for (const body of [...names.keys()]) if (!bodies.has(body)) names.delete(body);
  // A body an earlier round made and a later one replaced is no longer output: it goes with the scope.
  const output = new Set([...bodies.values(), ...previewTools.map((tool) => tool.shape)]);
  for (const shape of held) if (output.has(shape)) scope.keep(shape);
  for (const shape of ghosts) scope.keep(shape);
  return {
    bodies,
    names,
    previewTools,
    ...(warnings.length ? { warnings: [...new Set(warnings)] } : {}),
  };
}

// --------------------------------------------------------------- features

/**
 * Runs a pattern over its whole layout (every instance, the original
 * included), with the series its report carries. `skip` (P4-12) takes the
 * listed instances out before any boolean, and they come back as the faint
 * ghosts of what they would have been.
 */
function run(
  ctx: EvalContext,
  settings: PatternSettings,
  all: readonly Placement[],
  series: readonly PatternSeries[],
  centre: Vec3,
): FeatureOutput {
  if (settings.objects === 'bodies' && settings.bodies.length === 0) {
    throw new KernelError('Pick the bodies to pattern.');
  }
  if (settings.objects === 'features' && settings.features.length === 0) {
    throw new KernelError('Pick the features to pattern.');
  }
  const layout = splitSkip(settings.skip, all);
  const report = patternReport(all, series, centre, new Set(settings.skip));
  const made = layout.placements;
  if (all.every((placement) => placement.original === true)) {
    ctx.warn(
      'The pattern has one instance, the original, so it makes nothing new. Raise the count.',
    );
    return { bodies: ctx.bodies, report };
  }
  if (made.length === 0) {
    ctx.warn('Every instance is skipped, so the pattern makes nothing new.');
  }
  if (settings.objects === 'features') {
    // A repeat on top of the original (a distance or angle of 0) changes nothing, and OCCT
    // can take most of a minute to cut a tool into faces it already cut (a coil's, P4-01).
    const apart = distinctPlacements(made);
    if (made.length > 0 && apart.length === 0) {
      ctx.warn(
        'Every instance lies on the original, so the pattern repeats nothing. Change the distance or the angle.',
      );
      return { bodies: ctx.bodies, report };
    }
    using scope = ctx.kernel.scope();
    const result = replayFeatures(
      ctx,
      scope,
      settings.features,
      { placements: apart, skipped: layout.skipped },
      'pattern',
    );
    return { ...result, report };
  }
  using scope = ctx.kernel.scope();
  return { ...patternBodies(ctx, scope, settings, layout, 'pattern'), report };
}

const IDENTITY: readonly number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/** The placements that neither stay on the original nor repeat an earlier one (within 1 µm). */
export function distinctPlacements(placements: readonly Placement[]): Placement[] {
  const same = (a: readonly number[], b: readonly number[]) =>
    a.every((v, i) => Math.abs(v - (b[i] as number)) <= 1e-6);
  const out: Placement[] = [];
  for (const placement of placements) {
    const m = placement.matrix as readonly number[];
    if (same(m, IDENTITY) || out.some((p) => same(p.matrix as readonly number[], m))) continue;
    out.push(placement);
  }
  return out;
}

/** An expression input's value, or `fallback` when the input isn't there. */
const valueOr = (ctx: EvalContext, name: string, fallback: number): number =>
  (ctx.inputs as Record<string, unknown>)[name] ? ctx.value(name) : fallback;

// ------------------------------------------------------------ rectangular

export const kernelRectangularPattern: KernelFeatureDefinition<RectangularPatternInputs> = {
  ...rectangularPatternFeature,
  bodyAccess: () => 'write',
  evaluate(ctx) {
    const settings = rectangularSettings(ctx.inputs);
    if (!settings.direction1) throw new KernelError('Pick the direction to repeat along.');
    const count1 = wholeCount(valueOr(ctx, 'count1', 2), 'Count');
    const first: Row = {
      line: lineOf(ctx, settings.direction1, 'the first direction'),
      count: count1,
      step: rowStep(count1, valueOr(ctx, 'distance1', 20), settings.measure1),
      symmetric: settings.symmetric1,
    };
    let second: Row | undefined;
    if (settings.direction2) {
      const count2 = wholeCount(valueOr(ctx, 'count2', 2), 'Count 2');
      second = {
        line: lineOf(ctx, settings.direction2, 'the second direction'),
        count: count2,
        step: rowStep(count2, valueOr(ctx, 'distance2', 20), settings.measure2),
        symmetric: settings.symmetric2,
      };
    }
    limitInstances(count1 * (second?.count ?? 1));
    const centre = sourceCentre(ctx, settings);
    return run(
      ctx,
      settings,
      rectangularPlacements(first, second, true),
      rectangularSeries(first, second, centre),
      centre,
    );
  },
};

// --------------------------------------------------------------- circular

export const kernelCircularPattern: KernelFeatureDefinition<CircularPatternInputs> = {
  ...circularPatternFeature,
  bodyAccess: () => 'write',
  evaluate(ctx) {
    const settings = circularSettings(ctx.inputs);
    if (!settings.axis) throw new KernelError('Pick the axis to turn about.');
    const count = wholeCount(valueOr(ctx, 'count', 3), 'Count');
    limitInstances(count);
    const axis = lineOf(ctx, settings.axis, 'the axis to turn about');
    const angle = valueOr(ctx, 'angle', 360) * RADIANS;
    const centre = sourceCentre(ctx, settings);
    return run(
      ctx,
      settings,
      circularPlacements(axis, count, angle, settings.measure, settings.symmetric, true),
      [circularSeries(axis, count, angle, settings.measure, settings.symmetric, centre)],
      centre,
    );
  },
};

// ------------------------------------------------------------------- path

export const kernelPathPattern: KernelFeatureDefinition<PathPatternInputs> = {
  ...pathPatternFeature,
  bodyAccess: () => 'write',
  evaluate(ctx) {
    const settings = pathSettings(ctx.inputs);
    const count = wholeCount(valueOr(ctx, 'count', 3), 'Count');
    limitInstances(count);
    const path = pathFromRefs(ctx, settings.path, settings.flip);
    const step = seriesStep(count, valueOr(ctx, 'distance', 20), settings.measure);
    const centre = sourceCentre(ctx, settings);
    return run(
      ctx,
      settings,
      pathPlacements(path, count, step, settings.aligned, true),
      [pathSeries(path, count, step, settings.aligned, centre)],
      centre,
    );
  },
};
