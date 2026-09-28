/**
 * Reference resolution (ADR-0005): finds the face, edge or vertex a
 * `GeomRef` names among the bodies a feature sees. Every feature that uses
 * faces, edges or vertices resolves them here (through `EvalContext.resolve`).
 */
import type { BodyId, GeomRef } from '@extrudo/core';
import type { SubShapeKind } from '../history';
import { KernelError, type ShapeHandle } from '../kernel';
import type { ShapeDescription } from './description';
import { FINGERPRINT_THRESHOLD, fingerprintOf, fingerprintScore } from './fingerprint';
import { namesOf, type TopoNames } from './names';
import { nameRelation } from './topo-id';

/** A body with its naming table. */
export interface NamedBody {
  id: BodyId;
  shape: ShapeHandle;
  names: TopoNames;
}

export interface ResolvedRef {
  body: BodyId;
  /** The body's shape (not the sub-shape: take it with `Kernel.subShape` if needed). */
  shape: ShapeHandle;
  kind: SubShapeKind;
  /** Sub-shape index in the body. */
  index: number;
  /** The name it has now. */
  id: string;
  /**
   * - `name`: the name matched exactly.
   * - `related`: a piece of it, or the whole it is a piece of, and only one
   *   such (an edge whose face a later cut split: `e[a|b]` → `e[a#1|b]`).
   * - `fingerprint`: the name is gone; the closest geometry was taken.
   */
  via: 'name' | 'related' | 'fingerprint';
  /** Set when the match is a guess: the feature should show it as a warning. */
  warning?: string;
}

export interface ResolveOptions {
  /**
   * How messages name the element, e.g. "the edge to fillet". Default:
   * "its face", "its edge", "its vertex".
   */
  label?: string;
}

interface Candidate {
  body: NamedBody;
  index: number;
  id: string;
}

/**
 * A stored reference that can't be found any more (ADR-0005 step 4,
 * ADR-0033): a lost face, edge or vertex, or a profile, sketch line or
 * plane that went away. The engine reports `ref` in the feature's status
 * (`FeatureStatus.refs`), so the timeline can offer to fix it.
 */
export class LostReferenceError extends KernelError {
  constructor(
    message: string,
    readonly ref: GeomRef,
  ) {
    super(message);
  }
}

const SUB_SHAPE_REF_KINDS: ReadonlySet<string> = new Set(['face', 'edge', 'vertex']);

/**
 * Resolves a face, edge or vertex reference against `bodies`, in order:
 *
 * 1. **Exact name.** One match wins. Several (bodies that share names)
 *    are told apart by the fingerprint, with a warning.
 * 2. **Related name.** Pieces of the named face, or the face it was a piece
 *    of; for edges and vertices, the same with each of their faces. The
 *    closest relation wins (most faces equal); one such match is certain,
 *    several (the face was split since) are told apart by the fingerprint,
 *    with a warning.
 * 3. **Fingerprint.** The best-scoring sub-shape of the kind in any body,
 *    if it scores at least `FINGERPRINT_THRESHOLD`, with a warning.
 *
 * Otherwise throws a `LostReferenceError` with a message for the user.
 */
export function resolveRef(
  ref: GeomRef,
  bodies: readonly NamedBody[],
  describe: (shape: ShapeHandle) => ShapeDescription,
  options: ResolveOptions = {},
): ResolvedRef {
  if (!SUB_SHAPE_REF_KINDS.has(ref.kind)) {
    throw new KernelError(`Can't use a ${ref.kind} here; pick a face, edge or vertex.`);
  }
  const kind = ref.kind as SubShapeKind;
  const label = options.label ?? `its ${kind}`;
  const all: Candidate[] = [];
  for (const body of bodies) {
    namesOf(body.names, kind).forEach((id, index) => {
      all.push({ body, index, id });
    });
  }
  const result = (c: Candidate, via: ResolvedRef['via'], warning?: string): ResolvedRef => ({
    body: c.body.id,
    shape: c.body.shape,
    kind,
    index: c.index,
    id: c.id,
    via,
    ...(warning ? { warning } : {}),
  });
  const guessed = `Lost ${label} after an earlier change and picked the closest match. Check the result, or edit the feature and pick it again.`;

  const exact = all.filter((c) => c.id === ref.id);
  if (exact.length === 1) return result(exact[0] as Candidate, 'name');
  if (exact.length > 1) {
    return result(closest(ref, kind, exact, describe) ?? (exact[0] as Candidate), 'name', guessed);
  }

  let best = 0;
  let related: Candidate[] = [];
  for (const c of all) {
    const score = nameRelation(ref.id, c.id);
    if (score > best) {
      best = score;
      related = [c];
    } else if (score > 0 && score === best) {
      related.push(c);
    }
  }
  if (related.length === 1) return result(related[0] as Candidate, 'related');
  if (related.length > 1) {
    const piece = closest(ref, kind, related, describe) ?? (related[0] as Candidate);
    return result(
      piece,
      'related',
      `${capitalize(label)} was split by an earlier change; picked the closest piece. Check the result, or edit the feature and pick it again.`,
    );
  }

  if (ref.fingerprint) {
    const scored = scoreAll(ref, kind, all, describe);
    if (scored && scored.score >= FINGERPRINT_THRESHOLD) {
      return result(scored.candidate, 'fingerprint', guessed);
    }
  }
  throw new LostReferenceError(
    `Can't find ${label} any more: an earlier change removed it. Edit the feature and pick it again.`,
    ref,
  );
}

/** The candidate whose geometry best matches the reference's fingerprint (no threshold), if it has one. */
function closest(
  ref: GeomRef,
  kind: SubShapeKind,
  candidates: readonly Candidate[],
  describe: (shape: ShapeHandle) => ShapeDescription,
): Candidate | undefined {
  return scoreAll(ref, kind, candidates, describe)?.candidate;
}

function scoreAll(
  ref: GeomRef,
  kind: SubShapeKind,
  candidates: readonly Candidate[],
  describe: (shape: ShapeHandle) => ShapeDescription,
): { candidate: Candidate; score: number } | undefined {
  const stored = ref.fingerprint;
  if (!stored) return undefined;
  let best: { candidate: Candidate; score: number } | undefined;
  for (const candidate of candidates) {
    const d = describe(candidate.body.shape);
    const score = fingerprintScore(
      stored,
      fingerprintOf(d, candidate.body.names, kind, candidate.index),
      kind,
    );
    if (!best || score > best.score) best = { candidate, score };
  }
  return best;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
