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
 * - `wallFaces` + `wallThickness`, `wallFaces2` + `wallThickness2` … up to
 *   `SHELL_MAX_WALLS` (P4-12, ADR-0046's amendment): **wall sets**, faces of
 *   the shelled bodies whose walls get their own thickness instead of
 *   `thickness` (a thicker floor, a thinner lid). A set with no faces does
 *   nothing; a face can't be in two sets or among the removed faces. OCCT
 *   gives the faces that run smoothly into a set's face the same thickness.
 *
 * At least one face or body is needed. The inputs are plain `ref`, `expr`
 * and `enum` inputs, so the document schema doesn't change; a shell without
 * wall sets reads and computes exactly as before.
 */
import { enumInput, exprOf, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import type { ExprInput, GeomRef, Input, RefInput } from './schema';
import { z } from './zod';

export const SHELL_TYPE = 'shell';

/** Which side of the body's surface the walls are built on. */
export const SHELL_DIRECTIONS = ['inside', 'outside'] as const;
export type ShellDirection = (typeof SHELL_DIRECTIONS)[number];

/** What a shell takes: faces of bodies to remove. */
export const SHELL_FACE_KINDS = ['face'] as const;

/** How many wall sets (faces with a thickness of their own) a shell can have (P4-12). */
export const SHELL_MAX_WALLS = 8;

/** The input holding wall set `n`'s (1-based) faces: `wallFaces`, `wallFaces2`, … */
export const shellWallFacesKey = (n: number) => (n === 1 ? 'wallFaces' : `wallFaces${n}`);
/** The input holding wall set `n`'s thickness: `wallThickness`, `wallThickness2`, … */
export const shellWallThicknessKey = (n: number) =>
  n === 1 ? 'wallThickness' : `wallThickness${n}`;

const wallShape: Record<string, z.ZodType> = {};
for (let n = 1; n <= SHELL_MAX_WALLS; n++) {
  const set = `Wall set ${n}`;
  wallShape[shellWallFacesKey(n)] = refsOf(SHELL_FACE_KINDS)
    .optional()
    .describe(
      `${set}'s faces: their walls get the set's thickness instead of the shell's. A set with no faces does nothing.`,
    );
  wallShape[shellWallThicknessKey(n)] = exprOf('length')
    .optional()
    .describe(`${set}'s wall thickness; a length, needed once the set has faces.`);
}

const ShellBaseSchema = z.strictObject({
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

/** A shell's inputs: the base ones and the optional wall sets (`wallFaces`, `wallThickness` …). */
export type ShellInputs = z.infer<typeof ShellBaseSchema> & Record<string, Input>;

export const ShellInputsSchema = ShellBaseSchema.extend(
  wallShape,
) as unknown as z.ZodType<ShellInputs>;

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

/** One wall set with faces (P4-12): its number and its faces. */
export interface ShellWallSet {
  /** 1-based; its thickness is the input `shellWallThicknessKey(n)`. */
  n: number;
  faces: GeomRef[];
}

/** A shell's inputs with the defaults filled in: what the kernel builds. */
export interface ShellSettings {
  faces: GeomRef[];
  /** Body IDs to hollow without an opening. */
  bodies: string[];
  direction: ShellDirection;
  /** The wall sets that have faces, in order (P4-12). */
  walls: ShellWallSet[];
}

/** The wall sets of a shell's inputs that have faces, in order. */
export function shellWallSets(inputs: ShellInputs): ShellWallSet[] {
  const sets: ShellWallSet[] = [];
  for (let n = 1; n <= SHELL_MAX_WALLS; n++) {
    const input = inputs[shellWallFacesKey(n)];
    if (input?.kind === 'ref' && input.refs.length > 0) sets.push({ n, faces: input.refs });
  }
  return sets;
}

/** Reads a shell's (valid) inputs with their defaults. */
export function shellSettings(inputs: ShellInputs): ShellSettings {
  return {
    faces: inputs.faces?.refs ?? [],
    bodies: (inputs.bodies?.refs ?? []).map((ref) => ref.id),
    direction: inputs.direction?.value ?? 'inside',
    walls: shellWallSets(inputs),
  };
}

export interface ShellInputOptions {
  /** Body IDs to hollow closed. */
  bodies?: string[];
  /** Default `inside`. */
  direction?: ShellDirection;
  /** Wall sets in order (set 1 first): faces with a thickness expression of their own. */
  walls?: { faces: GeomRef[]; thickness: string }[];
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
  (options.walls ?? []).forEach((wall, i) => {
    inputs[shellWallFacesKey(i + 1)] = refs(wall.faces);
    inputs[shellWallThicknessKey(i + 1)] = { kind: 'expr', expr: wall.thickness, unit: 'length' };
  });
  return inputs;
}
