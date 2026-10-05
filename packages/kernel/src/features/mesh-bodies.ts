/**
 * What the features do with a mesh body once a boolean or a transform has
 * touched one (P4-06, ADR-0066 §4). A mesh body has **one face** and no
 * history to carry names through, so three rules live here instead of in each
 * evaluator:
 *
 * - a boolean's result (a mesh, whatever the operands were) has its face named
 *   after the feature, `mesh:<feature>`, numbered `#n` for the further mesh
 *   bodies the same feature makes — as an import's pieces are numbered (§3);
 * - a body that becomes a mesh where it was a solid tells the user once, since
 *   a fillet and a face pick no longer work on it;
 * - a transform keeps the names of a move and gives a copy its own, exactly as
 *   ADR-0044 says for a B-rep body.
 */
import type { OperationResult, ShapeHandle } from '../kernel';
import { deriveNames, type TopoNames } from '../naming/names';
import { withHistory } from '../naming/ops';
import { createdName, splitName } from '../naming/topo-id';
import type { EvalContext, FeatureOutput } from '../recompute/types';

/**
 * What a body that turned from a solid into a mesh is told, once per feature
 * (ADR-0066 §4). The engine collects a feature's warnings into one status and
 * drops the repeats, so this is said once however many bodies it happens to.
 */
export const MESH_WARNING =
  'A solid body was combined with a mesh and is a mesh from here on: fillets and face picks no longer work on it.';

/**
 * The name `propagateNames` gives a face with no history at all
 * (`<op>:<feature>:new`), which is what a boolean through a mesh leaves
 * behind: it is how `nameMeshBodies` recognises a name of its own making.
 */
const NO_HISTORY = ':new';

/** `mesh:<feature>`, and the same name numbered `#n` for the bodies after the first. */
export function meshFaceName(feature: string, index = 0): string {
  const name = `mesh:${feature}`;
  return index <= 0 ? name : splitName(name, index + 1);
}

/** The naming table of a mesh body: its one face, and no edges or vertices. */
export function meshNames(
  ctx: EvalContext,
  shape: ShapeHandle,
  feature: string,
  index = 0,
): TopoNames {
  return deriveNames([meshFaceName(feature, index)], ctx.describe(shape));
}

/**
 * Names every mesh body a **boolean** left `mesh:<feature>` (numbered in the
 * order the output holds them). Such a result has no history, so
 * `propagateNames` calls its single face `<op>:<feature>:new`, and two mesh
 * bodies made by one feature would answer to one name.
 *
 * A body a *transform* made keeps the name that gave it: a move keeps the name
 * it had and a copy has ADR-0044's or ADR-0047's copy rule, both of which say
 * more than `mesh:<feature>` — and neither ends in `:new`, which is how this
 * pass tells them apart. Bodies that passed on unchanged aren't in `names` at
 * all. Call it on an evaluator's result before `splitSolids` and before
 * returning.
 */
export function nameMeshBodies<T extends Pick<FeatureOutput, 'bodies' | 'names'>>(
  ctx: EvalContext,
  output: T,
): T {
  const { bodies, names } = output;
  if (!bodies || !names) return output;
  let mesh = 0;
  let any = false;
  const renamed = new Map(names);
  for (const [id, table] of renamed) {
    const shape = bodies.get(id);
    if (shape === undefined || !ctx.kernel.isMesh(shape)) continue;
    if (table.faces.some((name) => !name.endsWith(NO_HISTORY))) continue;
    renamed.set(id, meshNames(ctx, shape, ctx.feature.id, mesh));
    mesh++;
    any = true;
  }
  return any ? ({ ...output, names: renamed } as T) : output;
}

/** Warns when a body that was a solid is a mesh after a boolean. */
export function warnIfBecameMesh(
  ctx: EvalContext,
  before: ShapeHandle | undefined,
  after: ShapeHandle,
): void {
  if (before === undefined || ctx.kernel.isMesh(before) || !ctx.kernel.isMesh(after)) return;
  ctx.warn(MESH_WARNING);
}

/**
 * The names of a body after `transform`:
 *
 * - a solid's come from the transform's history, which has every sub-shape as
 *   an image of the one before;
 * - a mesh body's one face has no history, so a **move** keeps the name it
 *   had (a reference to its face still resolves, ADR-0005);
 * - a **copy** (a `role` in the naming) takes the copy rule ADR-0044 gives a
 *   B-rep body — `move:<feature>:from:(<name>)`, and a pattern's instance its
 *   own — numbered by `deriveNames` where two copies would share a name.
 */
export function transformedNames(
  ctx: EvalContext,
  result: OperationResult,
  source: TopoNames,
  naming: { op: string; role?: string },
): TopoNames {
  const base = ctx.kernel.isMesh(result.shape)
    ? source
    : withHistory(ctx.kernel, result, [source], {
        op: naming.op,
        feature: ctx.feature.id,
      }).names;
  const role = naming.role;
  if (role === undefined) return base;
  const faces = base.faces.map((name) => createdName(naming.op, ctx.feature.id, role, name));
  return deriveNames(faces, ctx.describe(result.shape));
}
