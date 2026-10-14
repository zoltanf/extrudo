import {
  type BodyId,
  type OffsetFaceInputs,
  offsetFaceFeature,
  offsetFaceSettings,
} from '@extrudo/core';
import type { HistoryRecord } from '../history';
import {
  KernelError,
  OffsetFaceError,
  type OffsetFaceProblem,
  type OperationResult,
  type ShapeHandle,
} from '../kernel';
import type { ShapeDescription } from '../naming/description';
import type { TopoNames } from '../naming/names';
import { withHistory } from '../naming/ops';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';

/**
 * The Offset Face feature in the kernel (P3-08, ADR-0051, FR-FT-12): moves
 * the picked faces along their outward normals by a distance, the faces
 * next to them extended or trimmed to follow, so a planar face moves like
 * a pad growing or sinking, a cylinder wall changes its radius, a hole's
 * wall widens or narrows the hole. Faces are resolved by name (ADR-0005),
 * so an offset follows its faces through earlier edits and a lost one is a
 * `LostReferenceError` (Fix References). Faces of several bodies are moved
 * body by body.
 *
 * **Every face keeps its name**: the facade's history says each face
 * generated its moved image, and the evaluator reads that as "modified", so
 * a fillet or a hole referring to "the top face" goes on finding it, and
 * the distance can be edited freely. A face the offset swallows is gone
 * (its name with it); a face OCCT splits gets `#n`.
 *
 * **A round keeps its radius** (ADR-0051's amendment, 2026-10-14): a
 * constant-radius round a fillet made (a cylinder or torus face named
 * `fillet:…`) that runs smoothly into a moving face is made again at its
 * radius between the moved face and its other neighbour, which stays where
 * it is, as the f3d files do: a 3 mm round between two walls pushed in by
 * 0.1 mm stays a 3 mm round, its axis moved. It keeps its name. Other
 * smooth neighbours (a slot's round end, an imported body's blends) move
 * with the face as OCCT moves them, and so do the rounds where the re-made
 * round can't be built. Only with `keepRounds` on (ADR-0051's second
 * amendment, 2026-10-14): without it (every offset saved before) the rounds
 * move with the face, their radius changing, as they always did. The app's
 * dialog picks a face's smooth chain up to its rounds (`smoothFaces`).
 *
 * A failure is turned into a message a person can act on (FR-UX-06): the
 * largest distance that works ("Pulling the face out by 25 mm is too far
 * for this body (max ≈ 19 mm)"), or plain words for what OCCT can't get
 * past. The kernel finds the number (facade `offsetFaces`).
 */
export const kernelOffsetFace: KernelFeatureDefinition<OffsetFaceInputs> = {
  ...offsetFaceFeature,
  bodyAccess: () => 'write',
  evaluate: evaluateOffsetFace,
};

function evaluateOffsetFace(ctx: EvalContext<OffsetFaceInputs>): FeatureOutput {
  const { kernel } = ctx;
  const settings = offsetFaceSettings(ctx.inputs);
  if (settings.faces.length === 0) throw new KernelError('Pick a face to offset.');
  const distance = ctx.value('distance');
  if (!Number.isFinite(distance) || Math.abs(distance) < 1e-9) {
    throw new KernelError(
      `The offset distance is ${formatLength(distance)}, so nothing moves. Enter a distance other than 0.`,
    );
  }

  // The faces to move, by body.
  const picked = new Map<BodyId, number[]>();
  for (const ref of settings.faces) {
    const hit = ctx.resolve(ref, { label: 'a face to offset' });
    const faces = picked.get(hit.body) ?? [];
    if (!faces.includes(hit.index)) faces.push(hit.index);
    picked.set(hit.body, faces);
  }

  using scope = kernel.scope();
  const moved = new Map<BodyId, { shape: ShapeHandle; table: TopoNames }>();
  for (const [body, faces] of picked) {
    const shape = ctx.bodies.get(body) as ShapeHandle;
    let result: OperationResult;
    try {
      const blends = settings.keepRounds ? roundsNextTo(ctx, body, faces) : [];
      result = kernel.offsetFaces(shape, faces, distance, blends);
    } catch (error) {
      if (error instanceof OffsetFaceError) {
        throw new KernelError(offsetMessage(error, distance, faces));
      }
      throw error;
    }
    scope.track(result.shape);
    const named = withHistory(
      kernel,
      { ...result, history: facesKeepNames(result.history) },
      [ctx.names(body)],
      { op: 'offsetFace', feature: ctx.feature.id },
    );
    moved.set(body, { shape: named.shape, table: named.names });
  }
  // Kept only when every body worked: a failure releases them all with the scope.
  const bodies = new Map(ctx.bodies);
  const names = new Map<BodyId, TopoNames>();
  for (const [body, { shape, table }] of moved) {
    bodies.set(body, scope.keep(shape));
    names.set(body, table);
  }
  return { bodies, names };
}

/** A face name a fillet made, or a copy of one: `fillet:…`, `pattern:P:1:from:(fillet:…)`. */
const ROUND_NAME = /^(?:[A-Za-z]+:[^:()]+:(?:[^:()]+:)?from:\()*fillet:/;

/**
 * Whether a face is a round that keeps its radius when a face next to it
 * moves: named by a fillet (or a copy of one), on a cylinder or a torus.
 */
export function isKeptRound(name: string | undefined, type: string): boolean {
  return ROUND_NAME.test(name ?? '') && (type === 'cylinder' || type === 'torus');
}

/**
 * The rounds next to the picked faces that keep their radius: faces of the
 * smooth chains through the picked ones, not picked themselves, that are
 * kept rounds (`isKeptRound`). Each face is looked at once.
 */
function roundsNextTo(
  ctx: EvalContext<OffsetFaceInputs>,
  body: BodyId,
  faces: readonly number[],
): number[] {
  const { kernel } = ctx;
  const shape = ctx.bodies.get(body) as ShapeHandle;
  const names = ctx.names(body).faces;
  const seen = new Set(faces);
  const rounds: number[] = [];
  for (const face of faces) {
    for (const next of kernel.tangentFaces(shape, face)) {
      if (seen.has(next)) continue;
      seen.add(next);
      if (!ROUND_NAME.test(names[next] ?? '')) continue;
      if (isKeptRound(names[next], kernel.surfaceGeometry(shape, next).type)) rounds.push(next);
    }
  }
  return rounds;
}

/** The faces an offset of some faces moves, and the rounds next to them it keeps. */
export interface SmoothFaces {
  /** The faces, the starting ones included. */
  faces: number[];
  /** The kept rounds next to them (none of `faces`). */
  rounds: number[];
}

/**
 * The faces the app's dialog picks for a click on each of `starts` (ADR-0051's
 * second amendment, 2026-10-14): the face's smooth chain (`tangentChain`,
 * what OCCT moves together). With `keepRounds`, the chain stops at the kept
 * rounds (`isKeptRound`): the walk goes from the face across the edges it
 * shares with faces of its chain, but not into a round, which is listed in
 * `rounds` instead; faces that run smoothly into it without a round between
 * (a slot's ends) still come along. A click on a round itself takes its whole
 * chain, as without the flag. `chain` and `describe` are the kernel's (the
 * engine passes its cached description).
 */
export function smoothFaces(
  starts: readonly number[],
  names: readonly (string | undefined)[],
  chain: (face: number) => number[],
  describe: () => ShapeDescription,
  keepRounds: boolean,
): SmoothFaces {
  const faces = new Set<number>();
  const rounds = new Set<number>();
  let around: Map<number, number[]> | undefined;
  const neighbours = (face: number): number[] => {
    if (!around) {
      const description = describe();
      around = new Map();
      for (const edge of description.edges) {
        for (const a of edge.faces) {
          const list = around.get(a) ?? [];
          for (const b of edge.faces) if (b !== a && !list.includes(b)) list.push(b);
          around.set(a, list);
        }
      }
    }
    return around.get(face) ?? [];
  };
  let types: ShapeDescription['faces'] | undefined;
  const isRound = (face: number) => {
    if (!ROUND_NAME.test(names[face] ?? '')) return false;
    types ??= describe().faces;
    return isKeptRound(names[face], types[face]?.type ?? 'other');
  };
  for (const start of starts) {
    const members = chain(start);
    if (!keepRounds || members.length < 2 || isRound(start)) {
      for (const face of members) faces.add(face);
      continue;
    }
    const inChain = new Set(members);
    const reached = new Set([start]);
    const queue = [start];
    for (let face = queue.pop(); face !== undefined; face = queue.pop()) {
      for (const next of neighbours(face)) {
        if (!inChain.has(next) || reached.has(next)) continue;
        if (isRound(next)) {
          rounds.add(next);
          continue;
        }
        reached.add(next);
        queue.push(next);
      }
    }
    for (const face of reached) faces.add(face);
  }
  return { faces: [...faces], rounds: [...rounds].filter((face) => !faces.has(face)) };
}

/**
 * The facade's history says a face generated its offset image; for naming
 * that image is the face itself, moved, so a face-to-face `generated` is
 * read as `modified` and the name carries over. Edges and vertices keep their
 * `generated` records (they are named from the faces around them anyway).
 */
export function facesKeepNames(history: readonly HistoryRecord[]): HistoryRecord[] {
  return history.map((record) =>
    record.relation === 'generated' && record.from.kind === 'face'
      ? {
          ...record,
          relation: 'modified' as const,
          to: record.to.filter((to) => to.kind === 'face'),
        }
      : record,
  );
}

// ----------------------------------------------------------------- messages

/**
 * An offset failure as a message (FR-UX-06): plain words, faces counted
 * from 1 as the app's selection lists them ("Face 3"), lengths in mm.
 */
export function offsetMessage(
  error: OffsetFaceError,
  distance: number,
  faces: readonly number[],
): string {
  const sentences = error.problems.map((problem) => problemMessage(problem, distance, faces));
  return [...new Set(sentences)].join(' ');
}

function problemMessage(
  problem: OffsetFaceProblem,
  distance: number,
  faces: readonly number[],
): string {
  const what = faces.length === 1 ? `Face ${(faces[0] ?? 0) + 1}` : 'The faces';
  const way = distance < 0 ? 'in' : 'out';
  switch (problem.kind) {
    case 'too-far':
      return problem.max > 0
        ? `${what} can't move ${way} by ${formatLength(Math.abs(distance))}: that is too far for this body (max ≈ ${formatLength(floorTo2(problem.max))}). Try a smaller distance.`
        : `${what} can't move ${way} by ${formatLength(Math.abs(distance))}, or by any smaller distance. Check the faces around it.`;
    case 'unoffsettable':
      return `${what} can't be offset, at any distance. Faces that run into fillets or other curved faces often stop this: try moving a flat face, or offset before rounding the edges.`;
    case 'not-solid':
      return 'Offset Face needs a solid body.';
    case 'void':
      return "This body has a sealed cavity inside, which Offset Face can't handle yet. Offset the faces before hollowing the body closed, or open the cavity with a shell.";
    case 'sharp-chain':
      return "This body has rounded edges that meet at a sharp corner (two fillets meeting where the third edge isn't rounded), and OCCT can't offset a body like that without corrupting its memory. Offset the faces before rounding the edges, or round all the edges at the corner so they blend.";
    case 'other':
      return "The faces couldn't be offset. Try a smaller distance or other faces.";
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
