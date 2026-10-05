/**
 * The shell feature (P3-03, ADR-0046, FR-FT-06): hollows bodies, leaving
 * walls of a given thickness. The kernel adds its evaluator and the web app
 * its dialog, each in its own registry keyed by `SHELL_TYPE` (ADR-0003).
 *
 * Inputs:
 *
 * - `faces`: the faces to remove, the openings. They may lie on several
 *   bodies; each of those bodies is shelled with its own faces removed.
 * - `bodies`: bodies to hollow closed, with no opening, a solid with a void
 *   inside. Bodies of the picked faces are shelled anyway; this adds more
 *   (or the only one, when no face is picked). Body IDs.
 * - `thickness`: the wall thickness (a length, greater than 0).
 * - `direction`: `inside` (default) keeps the outside of the body where it
 *   is and cuts the cavity into it; `outside` keeps the body's surface as
 *   the cavity and grows the walls outwards, so the part gets bigger.
 *
 * At least one face or body is needed. The inputs are plain `ref`, `expr`
 * and `enum` inputs, so the document schema doesn't change.
 */
import { enumInput, exprOf, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import type { ExprInput, GeomRef, RefInput } from './schema';
import { z } from './zod';

export const SHELL_TYPE = 'shell';

/** Which side of the body's surface the walls are built on. */
export const SHELL_DIRECTIONS = ['inside', 'outside'] as const;
export type ShellDirection = (typeof SHELL_DIRECTIONS)[number];

/** What a shell takes: faces of bodies to remove. */
export const SHELL_FACE_KINDS = ['face'] as const;

export const ShellInputsSchema = z.strictObject({
  /** Faces to remove (openings). Optional: with none the bodies are hollowed closed. */
  faces: refsOf(SHELL_FACE_KINDS)
    .optional()
    .describe('The faces to remove (openings). Without any, the bodies are hollowed closed.'),
  /** Bodies to hollow closed, besides the bodies of the faces. */
  bodies: refsOf(['body'])
    .optional()
    .describe('The bodies to hollow closed, besides the bodies of the faces.'),
  /** The wall thickness; required. */
  thickness: exprOf('length').describe('The wall thickness; a length. Required.'),
  /** Default `inside`. */
  direction: enumInput(SHELL_DIRECTIONS)
    .optional()
    .describe('Hollow inside the bodies or outside them. Default inside.'),
});
export type ShellInputs = z.infer<typeof ShellInputsSchema>;

export const shellFeature: FeatureDefinition<ShellInputs> = {
  type: SHELL_TYPE,
  label: 'Shell',
  category: 'modify',
  icon: 'shell',
  inputsSchema: ShellInputsSchema,
  // ADR-0068 §4, from the kernel's `nameShell` (P3-03): the faces that aren't
  // the original skin keep the original names, these are the new ones.
  faceRoles: [
    {
      pattern: 'inner:<face>',
      description:
        'The face of the wall itself, on the side away from the outer skin (an inside shell hollows in).',
    },
    {
      pattern: 'rim:<face>',
      description: 'The rim round an opening, between the removed face and the inner face.',
    },
    {
      pattern: 'round:<face>',
      description: 'The round on a face that meets the one removed at an angle.',
    },
    {
      pattern: 'new',
      description: 'A face with no face of its own before, which nothing else names.',
    },
  ],
};

/** A shell's inputs with the defaults filled in: what the kernel builds. */
export interface ShellSettings {
  faces: GeomRef[];
  /** Body IDs to hollow without an opening. */
  bodies: string[];
  direction: ShellDirection;
}

/** Reads a shell's (valid) inputs with their defaults. */
export function shellSettings(inputs: ShellInputs): ShellSettings {
  return {
    faces: inputs.faces?.refs ?? [],
    bodies: (inputs.bodies?.refs ?? []).map((ref) => ref.id),
    direction: inputs.direction?.value ?? 'inside',
  };
}

export interface ShellInputOptions {
  /** Body IDs to hollow closed. */
  bodies?: string[];
  /** Default `inside`. */
  direction?: ShellDirection;
}

/**
 * A shell's inputs from plain values (tests, scripts; the dialog builds the
 * same shape). `thickness` is an expression: `'2 mm'`, `'wall / 2'`;
 * `paramName`s are left to the caller.
 */
export function shellInputs(
  faces: GeomRef[],
  thickness: string,
  options: ShellInputOptions = {},
): ShellInputs {
  const refs = (list: GeomRef[]): RefInput => ({ kind: 'ref', refs: list });
  const expr: ExprInput = { kind: 'expr', expr: thickness, unit: 'length' };
  const inputs: ShellInputs = { thickness: expr };
  if (faces.length > 0) inputs.faces = refs(faces);
  if (options.bodies && options.bodies.length > 0) {
    inputs.bodies = refs(options.bodies.map((id) => ({ kind: 'body', id })));
  }
  if (options.direction) inputs.direction = { kind: 'enum', value: options.direction };
  return inputs;
}
