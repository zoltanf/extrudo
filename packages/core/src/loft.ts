/**
 * The loft feature (P4-01, ADR-0055, FR-FT-14): a solid through two or more
 * sections in order, each a sketch profile or a flat face of a body (on
 * different planes), smooth through them all or ruled (straight) between
 * neighbours, optionally closed into a ring. A point (a construction point,
 * a body vertex or a sketch point) can start or end it: a loft to a point
 * is a cone or a pyramid. The kernel adds its evaluator and the web app its
 * dialog, each in its own registry keyed by `LOFT_TYPE` (ADR-0003).
 *
 * Sections may have different numbers of edges (a square to a circle): the
 * kernel lines them up. Sections with holes are refused. Rails and a centre
 * line are not part of this loft (ADR-0055: deferred).
 */
import { BODY_OPERATIONS, type BodyOperation, enumInput, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import { BoolInputSchema, type GeomRef, type GeomRefKind, type RefInput } from './schema';
import { z } from './zod';

export const LOFT_TYPE = 'loft';

/**
 * What a section can be: a sketch profile, a flat face, or at either end a
 * point (`point`: a construction point; `vertex`: a body's; `sketchEntity`:
 * a sketch point).
 */
export const LOFT_SECTION_KINDS: readonly GeomRefKind[] = [
  'profile',
  'face',
  'point',
  'vertex',
  'sketchEntity',
];

export const LoftInputsSchema = z.strictObject({
  /** In order, at least two (three for a closed loft). Missing: the feature fails until some are picked. */
  sections: refsOf(LOFT_SECTION_KINDS).optional(),
  /** Straight between neighbouring sections; default false (smooth through them all). */
  ruled: BoolInputSchema.optional(),
  /** The last section joins the first again: a ring, no end faces. Default false. */
  closed: BoolInputSchema.optional(),
  /** Default `new-body`. */
  operation: enumInput(BODY_OPERATIONS).optional(),
  /**
   * The bodies to join, cut or intersect (`body` references, body IDs).
   * Empty or missing: every body the loft touches (join) or overlaps (cut,
   * intersect).
   */
  bodies: refsOf(['body']).optional(),
});
export type LoftInputs = z.infer<typeof LoftInputsSchema>;

export const loftFeature: FeatureDefinition<LoftInputs> = {
  type: LOFT_TYPE,
  label: 'Loft',
  category: 'create',
  icon: 'loft',
  inputsSchema: LoftInputsSchema,
};

/** A loft's inputs with every default filled in: what the kernel builds. */
export interface LoftSettings {
  sections: GeomRef[];
  ruled: boolean;
  closed: boolean;
  operation: BodyOperation;
  /** Explicit participants (body IDs); empty means automatic. */
  bodies: string[];
}

/** Reads a loft's (valid) inputs with their defaults. */
export function loftSettings(inputs: LoftInputs): LoftSettings {
  return {
    sections: inputs.sections?.refs ?? [],
    ruled: inputs.ruled?.value ?? false,
    closed: inputs.closed?.value ?? false,
    operation: inputs.operation?.value ?? 'new-body',
    bodies: (inputs.bodies?.refs ?? []).map((ref) => ref.id),
  };
}

export interface LoftInputOptions {
  ruled?: boolean;
  closed?: boolean;
  operation?: BodyOperation;
  bodies?: string[];
}

/** A loft's inputs from plain options (tests, scripts; the dialog builds the same shape). */
export function loftInputs(sections: GeomRef[], options: LoftInputOptions = {}): LoftInputs {
  const refs = (list: GeomRef[]): RefInput => ({ kind: 'ref', refs: list });
  const inputs: LoftInputs = { sections: refs(sections) };
  const o = options;
  if (o.ruled !== undefined) inputs.ruled = { kind: 'bool', value: o.ruled };
  if (o.closed !== undefined) inputs.closed = { kind: 'bool', value: o.closed };
  if (o.operation) inputs.operation = { kind: 'enum', value: o.operation };
  if (o.bodies) inputs.bodies = refs(o.bodies.map((id) => ({ kind: 'body', id })));
  return inputs;
}
