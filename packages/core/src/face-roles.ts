/**
 * Face roles: what the faces a feature makes are called (ADR-0068 §4).
 *
 * A feature names the faces of its result, and the name is what a later feature
 * refers to (ADR-0005): `extrude:F1:cap:end`, `box:B2:side:front`,
 * `fillet:F3:from:(extrude:F1:side:l3)`. The role is the part after
 * `<operation>:<feature>:`, and every body-making feature definition lists the
 * roles it makes with a line each, so `@extrudo/api` can build
 * `handle.face('cap:end')` and the generated reference can document them.
 *
 * Three things use the list:
 *
 * - the API's `handle.face(role)` (a wrong role is a lost reference, a visible
 *   error, not a silent guess);
 * - the generator, which writes the roles into the methods' doc comments;
 * - a kernel test (`face-roles.test.ts`) that builds one of every body-making
 *   feature and checks every face name it produces is one of its definition's
 *   patterns, so a role string that changes is caught here.
 *
 * A pattern is the role with `<…>` for what varies: `side:<sketch curve>`.
 * `#n` (a face an operation split in two) and `@n` are not part of a role.
 */

/**
 * One face role: the pattern of the role part of a name, and what it is.
 */
export interface FaceRole {
  /**
   * The role, with `<…>` for the part that varies: `cap:start`,
   * `side:<sketch curve>`, `from:(<edge>)`.
   */
  pattern: string;
  /** One line on what the face is, for the reference. */
  description: string;
}

/**
 * The roles every swept solid carries, in the kernel's own words
 * (`naming/names.ts`'s `nameSweep`): a cap where the sweep starts and where it
 * ends, and one wall per edge of the profile it sweeps.
 */
export const SWEEP_FACE_ROLES: readonly FaceRole[] = [
  {
    pattern: 'cap:start',
    description: 'The face the sweep starts at: the profile in its own place.',
  },
  {
    pattern: 'cap:end',
    description: 'The face the sweep ends at.',
  },
  {
    pattern: 'side:<curve>',
    description:
      'A wall, one per edge of the profile: the sketch curve it came from, or the body edge it was swept from.',
  },
];

/**
 * The roles a solid that came from another body's faces carries: it keeps the
 * names of the faces it is made of, and adds a face per edge an operation
 * generated (`from:(<edge>)`, ADR-0005).
 */
export const KEEPS_FACE_ROLES: readonly FaceRole[] = [
  {
    pattern: 'from:(<edge>)',
    description:
      'A face the operation generated from an edge: a round, a chamfer, or the seam a boolean leaves.',
  },
  {
    pattern: 'new',
    description: 'A face with no face of its own before, which nothing else names.',
  },
];

/**
 * The role part of a face's name when `feature` made it, or `undefined` when
 * the name is another feature's (a face a boolean or a fillet kept). A name is
 * `<operation>:<feature>:<role>[:<source>]` (ADR-0005), and the role never
 * carries the `#n` of a face an operation split in two.
 */
export function ownFaceRole(feature: string, name: string): string | undefined {
  // An edge or a vertex is `e[face|face]` or `v[face|face]` (ADR-0005).
  if (name.startsWith('e[') || name.startsWith('v[')) return undefined;
  const parts = /^([^:]+):([^:]+):(.+)$/.exec(name);
  if (!parts || parts[2] !== feature) return undefined;
  return (parts[3] as string).replace(/[#@]\d+$/, '');
}

/** A pattern as a matcher: `<…>` is any run of characters. */
export function faceRolePattern(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/<[^>]*>/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/** Whether a role (a name's part after `<op>:<feature>:`) is one of `roles`. */
export function matchesFaceRole(roles: readonly FaceRole[] | undefined, role: string): boolean {
  return (roles ?? []).some((role0) => faceRolePattern(role0.pattern).test(role));
}

/**
 * The face names of `names` that `feature` made itself but gave a role its
 * definition doesn't list. Faces that kept an earlier feature's name are not
 * this feature's business, so they are left out; a feature with no roles at all
 * (one that names no face of its own) has none of its own either.
 */
export function faceRoleIssues(
  roles: readonly FaceRole[] | undefined,
  feature: string,
  names: readonly string[],
): string[] {
  if (!roles) return [];
  return names
    .map((name) => ownFaceRole(feature, name))
    .filter((role): role is string => role !== undefined && !matchesFaceRole(roles, role))
    .map((role) => `"${role}"`);
}
