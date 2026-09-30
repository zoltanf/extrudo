/**
 * The Combine feature (P3-06, ADR-0044, FR-FT-09): joins, cuts or
 * intersects bodies with each other. A **target** body and one or more
 * **tool** bodies; the result keeps the target's ID (and name, colour,
 * references to it), the tools are consumed unless `keepTools` is on.
 *
 * - `join`: the target fused with every tool. A tool must touch the target
 *   (or another tool that does).
 * - `cut`: the target minus every tool.
 * - `intersect`: what the target shares with the tools (with all of them
 *   taken together).
 *
 * The kernel adds its evaluator and the web app its dialog, each in its own
 * registry keyed by `COMBINE_TYPE` (ADR-0003).
 */
import { z } from 'zod';
import { enumInput, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import { BoolInputSchema, type GeomRef } from './schema';

export const COMBINE_TYPE = 'combine';

export const COMBINE_OPERATIONS = ['join', 'cut', 'intersect'] as const;
export type CombineOperation = (typeof COMBINE_OPERATIONS)[number];

export const CombineInputsSchema = z.strictObject({
  /** The body that stays (one `body` reference). Empty: the feature fails until one is picked. */
  target: refsOf(['body'], 1),
  /** The bodies combined into it (`body` references). Empty: the feature fails until some are picked. */
  tools: refsOf(['body']),
  /** Default `join`. */
  operation: enumInput(COMBINE_OPERATIONS).optional(),
  /** Keep the tool bodies instead of consuming them. Default false. */
  keepTools: BoolInputSchema.optional(),
});
export type CombineInputs = z.infer<typeof CombineInputsSchema>;

export const combineFeature: FeatureDefinition<CombineInputs> = {
  type: COMBINE_TYPE,
  label: 'Combine',
  category: 'modify',
  icon: 'combine',
  inputsSchema: CombineInputsSchema,
};

/** A combine's inputs with every default filled in: what the kernel builds. */
export interface CombineSettings {
  target: GeomRef | undefined;
  /** Body references, each once. */
  tools: GeomRef[];
  operation: CombineOperation;
  keepTools: boolean;
}

/** Reads a combine's (valid) inputs with their defaults. */
export function combineSettings(inputs: CombineInputs): CombineSettings {
  const seen = new Set<string>();
  const tools = inputs.tools.refs.filter((ref) => !seen.has(ref.id) && seen.add(ref.id));
  return {
    target: inputs.target.refs[0],
    tools,
    operation: inputs.operation?.value ?? 'join',
    keepTools: inputs.keepTools?.value ?? false,
  };
}

export interface CombineInputOptions {
  operation?: CombineOperation;
  keepTools?: boolean;
}

/** A combine's inputs from body IDs (tests, scripts; the dialog builds the same shape). */
export function combineInputs(
  target: string,
  tools: readonly string[],
  options: CombineInputOptions = {},
): CombineInputs {
  const body = (id: string): GeomRef => ({ kind: 'body', id });
  const inputs: CombineInputs = {
    target: { kind: 'ref', refs: [body(target)] },
    tools: { kind: 'ref', refs: tools.map(body) },
  };
  if (options.operation) inputs.operation = { kind: 'enum', value: options.operation };
  if (options.keepTools !== undefined) {
    inputs.keepTools = { kind: 'bool', value: options.keepTools };
  }
  return inputs;
}
