import {
  type BodyId,
  type ShellDirection,
  type ShellInputs,
  shellFeature,
  shellSettings,
  shellWallThicknessKey,
} from '@extrudo/core';
import type { HistoryRecord } from '../history';
import {
  KernelError,
  type ShapeHandle,
  ShellError,
  type ShellProblem,
  type ShellWall,
} from '../kernel';
import type { ShapeDescription } from '../naming/description';
import { deriveNames, namesOf, type TopoNames } from '../naming/names';
import { LostReferenceError } from '../naming/resolve';
import { createdName } from '../naming/topo-id';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';

/**
 * The shell feature in the kernel (P3-03, ADR-0046): hollows bodies with
 * walls of a thickness, inside or outside the body's surface. Faces are
 * resolved by name (ADR-0005), so a shell follows its faces through earlier
 * edits and a lost one is a `LostReferenceError` (Fix References). Each body
 * with faces picked is shelled with those faces removed; bodies picked
 * without faces are hollowed closed (a sealed void inside). Faces of several
 * bodies are fine: every body is shelled on its own.
 *
 * A failure becomes a message a person can act on (FR-UX-06): the largest
 * thickness that works ("A 12 mm wall is too thick for this body (max ≈
 * 9.9 mm)"), or plain words for the causes OCCT can't get past (fillets and
 * tangent faces). The kernel finds the number (facade `shell`).
 *
 * A flat face that runs smoothly into a fillet can be removed since P4-12:
 * the facade hollows the body closed and cuts the opening out as a plug
 * (ADR-0046's amendment); its rim is named like any rim.
 *
 * **Wall sets** (P4-12, ADR-0046's amendment) give faces a thickness of
 * their own: each set's faces are resolved like the removed ones, must
 * belong to a shelled body, not be removed and not be in two sets; the
 * facade's `shellFaces` builds those bodies (sharp joins), every other body
 * goes through `shell` as before.
 *
 * The faces of the result are named by `nameShell`.
 */
export const kernelShell: KernelFeatureDefinition<ShellInputs> = {
  ...shellFeature,
  bodyAccess: () => 'write',
  evaluate: evaluateShell,
};

function evaluateShell(ctx: EvalContext<ShellInputs>): FeatureOutput {
  const { kernel } = ctx;
  const settings = shellSettings(ctx.inputs);
  if (settings.faces.length === 0 && settings.bodies.length === 0) {
    throw new KernelError('Pick a face to remove, or a body to hollow out.');
  }
  const thickness = ctx.value('thickness');
  if (!(thickness > 0)) {
    throw new KernelError(
      `The wall thickness is ${formatLength(thickness)}. Enter a thickness greater than 0.`,
    );
  }

  // Faces to remove, by body; bodies named without faces are hollowed closed.
  const removed = new Map<BodyId, number[]>();
  for (const ref of settings.faces) {
    const hit = ctx.resolve(ref, { label: 'a face to remove' });
    const faces = removed.get(hit.body) ?? [];
    if (!faces.includes(hit.index)) faces.push(hit.index);
    removed.set(hit.body, faces);
  }
  for (const id of settings.bodies as BodyId[]) {
    if (!ctx.bodies.has(id)) {
      throw new LostReferenceError(
        'A body to hollow out no longer exists. Edit the shell and pick the body again.',
        { kind: 'body', id },
      );
    }
    if (!removed.has(id)) removed.set(id, []);
  }

  // Wall sets: faces of the shelled bodies with a thickness of their own.
  const walls = new Map<BodyId, ShellWall[]>();
  const wallSetOf = new Map<string, number>();
  for (const set of settings.walls) {
    const key = shellWallThicknessKey(set.n);
    if (ctx.inputs[key] === undefined) {
      throw new KernelError(`Wall set ${set.n} has faces but no thickness. Enter its thickness.`);
    }
    const value = ctx.value(key);
    if (!(value > 0)) {
      throw new KernelError(
        `Wall set ${set.n}'s thickness is ${formatLength(value)}. Enter a thickness greater than 0.`,
      );
    }
    for (const ref of set.faces) {
      const hit = ctx.resolve(ref, { label: `a face of wall set ${set.n}` });
      const faces = removed.get(hit.body);
      if (faces === undefined) {
        throw new KernelError(
          `Wall set ${set.n} has a face of a body this shell doesn't hollow. Pick faces of the shelled body, or add its body to the shell.`,
        );
      }
      if (faces.includes(hit.index)) {
        throw new KernelError(
          `Face ${hit.index + 1} is removed, so it has no wall: take it out of wall set ${set.n}.`,
        );
      }
      const faceKey = `${hit.body}/${hit.index}`;
      const other = wallSetOf.get(faceKey);
      if (other !== undefined && other !== set.n) {
        throw new KernelError(
          `Face ${hit.index + 1} is in wall sets ${other} and ${set.n}. A face takes one thickness: take it out of one set.`,
        );
      }
      if (other !== undefined) continue;
      wallSetOf.set(faceKey, set.n);
      const list = walls.get(hit.body) ?? [];
      list.push({ face: hit.index, thickness: value });
      walls.set(hit.body, list);
    }
  }

  using scope = kernel.scope();
  const shelled = new Map<BodyId, { shape: ShapeHandle; table: TopoNames }>();
  for (const [body, faces] of removed) {
    const shape = ctx.bodies.get(body) as ShapeHandle;
    const own = walls.get(body) ?? [];
    let result: ReturnType<typeof kernel.shell>;
    try {
      result = kernel.shell(shape, faces, thickness, settings.direction, own);
    } catch (error) {
      if (error instanceof ShellError) {
        throw new KernelError(shellMessage(error, thickness, faces, own));
      }
      throw error;
    }
    scope.track(result.shape);
    const table = nameShell({
      feature: ctx.feature.id,
      direction: settings.direction,
      input: ctx.names(body),
      removed: faces,
      history: result.history,
      result: kernel.describe(result.shape),
    });
    shelled.set(body, { shape: result.shape, table });
  }
  // Kept only when every body worked: a failure releases them all with the scope.
  const bodies = new Map(ctx.bodies);
  const names = new Map<BodyId, TopoNames>();
  for (const [body, { shape, table }] of shelled) {
    bodies.set(body, scope.keep(shape));
    names.set(body, table);
  }
  return { bodies, names };
}

// ------------------------------------------------------------------- naming

export interface ShellNaming {
  feature: string;
  direction: ShellDirection;
  /** The naming table of the shelled body. */
  input: TopoNames;
  /** Indices of the removed faces. */
  removed: readonly number[];
  /** `Kernel.shell`'s history. */
  history: readonly HistoryRecord[];
  /** The result's description. */
  result: ShapeDescription;
}

/**
 * Names the faces of a shell (ADR-0046, on ADR-0005's rules). The shell of a
 * body is its **outer skin** and an **inner skin**, and the outer skin keeps
 * the original names: shelling inwards, the original faces stay where they
 * are (`kept`) and the cavity's faces are new; shelling outwards, the
 * offset faces are the new outer skin and the original faces turn into the
 * cavity. Either way a later feature that refers to "the top face" keeps
 * finding the outside of the part, and a switch of direction renames
 * nothing on the outside.
 *
 * - the outer face of a face F keeps F's name;
 * - the inner face is `shell:<id>:inner:(<F>)`;
 * - the rim around an opening, which OCCT reports as the removed face R
 *   modified, is `shell:<id>:rim:(<R>)`;
 * - a rounded join at an edge or vertex E (the offset of a concave or
 *   convex edge) is `shell:<id>:round:(<E>)`;
 * - anything else `shell:<id>:new`.
 *
 * Edges and vertices are named from the faces around them, as everywhere.
 */
export function nameShell(naming: ShellNaming): TopoNames {
  const { feature, direction, input, removed, history, result } = naming;
  const outside = direction === 'outside';
  // Candidate names per result face, best first after sorting.
  const candidates: string[][] = result.faces.map(() => []);
  const add = (to: HistoryRecord['to'], name: string) => {
    for (const t of to) if (t.kind === 'face') candidates[t.index]?.push(name);
  };
  for (const record of history) {
    if (record.input !== 0) continue;
    const source = namesOf(input, record.from.kind)[record.from.index];
    if (source === undefined) continue;
    if (record.from.kind === 'face') {
      const gone = removed.includes(record.from.index);
      if (gone) {
        if (record.relation === 'modified' || record.relation === 'generated') {
          add(record.to, createdName('shell', feature, 'rim', source));
        }
      } else if (record.relation === 'kept' || record.relation === 'modified') {
        add(record.to, outside ? createdName('shell', feature, 'inner', source) : source);
      } else if (record.relation === 'generated') {
        add(record.to, outside ? source : createdName('shell', feature, 'inner', source));
      }
    } else if (record.relation === 'generated') {
      add(record.to, createdName('shell', feature, 'round', source));
    }
  }
  const raw = candidates.map(
    (names) => [...names].sort()[0] ?? createdName('shell', feature, 'new'),
  );
  return deriveNames(raw, result);
}

// ----------------------------------------------------------------- messages

/**
 * A shell failure as a message (FR-UX-06): plain words, faces counted from 1
 * as the app's selection lists them ("Face 3"), lengths in mm.
 */
export function shellMessage(
  error: ShellError,
  thickness: number,
  removed: readonly number[],
  walls: readonly ShellWall[] = [],
): string {
  const sentences = error.problems.map((problem) =>
    problemMessage(problem, thickness, removed, walls),
  );
  return [...new Set(sentences)].join(' ');
}

function problemMessage(
  problem: ShellProblem,
  thickness: number,
  removed: readonly number[],
  walls: readonly ShellWall[],
): string {
  switch (problem.kind) {
    case 'too-thick':
      return problem.max > 0
        ? `A ${formatLength(thickness)} wall is too thick for this body (max ≈ ${formatLength(floorTo2(problem.max))}). Try a thinner wall.`
        : `A ${formatLength(thickness)} wall is too thick for this body. Try a thinner wall.`;
    case 'unshellable':
      return removed.length > 0
        ? "The walls can't be built with those faces removed, at any thickness. Fillets and curved faces that run into each other often stop this: try removing a flat face, or shell before rounding the edges."
        : "The walls can't be built for this body, at any thickness. Fillets and curved faces that run into each other often stop this: try shelling before rounding the edges.";
    case 'all-faces':
      return 'Every face of the body is picked for removal, so no walls would be left. Pick fewer faces.';
    case 'not-solid':
      return 'A shell needs a solid body.';
    case 'tangent':
      return `Face ${problem.face + 1} can't be removed: it runs smoothly into the faces next to it (a fillet or another tangent face), and an opening there needs a flat face whose other edges meet their neighbours square, apart from the other removed faces. Pick a face like that, or shell before rounding the edges.`;
    case 'walls-too-thick': {
      // Every thickness scaled together: say what each would have to be.
      const asked = [...new Set([thickness, ...walls.map((wall) => wall.thickness)])];
      const list = asked.map((t) => formatLength(t)).join(', ');
      const max = asked.map((t) => `${formatLength(floorTo2(t * problem.factor))}`).join(', ');
      return problem.factor > 0
        ? `Walls of ${list} are too thick for this body (max ≈ ${max}, all scaled together). Try thinner walls.`
        : `Walls of ${list} are too thick for this body. Try thinner walls.`;
    }
    case 'sharp-chain':
      return "This body has rounded edges that meet at a sharp corner (two fillets meeting where the third edge isn't rounded), and walls of their own thickness can't be built on such a body without corrupting OCCT's memory. Give every wall the same thickness, shell before rounding the edges, or round all the edges at the corner so they blend.";
    case 'wall-removed':
      return `Face ${problem.face + 1} is removed, so it has no wall: take it out of its wall set.`;
    case 'wall-twice':
      return `Face ${problem.face + 1} is given two wall thicknesses. A face takes one thickness: take it out of one set.`;
    case 'wall-chain':
      return `Face ${problem.face + 1} runs smoothly into a face with another wall thickness (through a fillet or a tangent face), and faces that run into each other take one thickness. Give them the same thickness, or put them in one set.`;
    case 'other':
      return "The shell couldn't be built. Try a thinner wall or other faces.";
  }
}

/** Rounds down to two significant digits, so the number given still works. */
function floorTo2(value: number): number {
  if (!(value > 0)) return 0;
  const step = 10 ** (Math.floor(Math.log10(value)) - 1);
  return Math.floor(value / step + 1e-9) * step;
}

/** "2.4 mm", "10 mm", "0.35 mm": at most three decimals, no trailing zeros. */
function formatLength(value: number): string {
  const text = Number.parseFloat(value.toFixed(3)).toString();
  return `${text} mm`;
}
