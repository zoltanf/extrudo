/**
 * Persistent names of faces, edges and vertices (ADR-0005), the strings the
 * API needs to build a face, edge or vertex reference without a kernel
 * (ADR-0068 §4). These are the kernel's formats, kept here as plain string
 * functions so `@extrudo/api` needs no OCCT: `topo-id.ts` in
 * `packages/kernel/src/naming/`, whose tests cover the same grammar.
 *
 * ```
 * face     = op ":" feature ":" role (":" source)?     extrude:f1:cap:end
 * source   = token | "(" name ")"                      a sketch curve ID, or a nested name
 * split    = "#" n                                     pieces of one face, n ≥ 1
 * edge     = "e[" face ("|" face)* "]" ("@" n)?        the distinct faces it bounds, sorted
 * vertex   = "v[" face ("|" face)* "]" ("@" n)?        the distinct faces around it, sorted
 * ```
 *
 * `op` is the feature's own type, so a box's faces are `box:f1:face` and an
 * extrude's are `extrude:f1:cap:start`, `extrude:f1:cap:end` and
 * `extrude:f1:side:<sketch curve>` — exactly what the kernel writes into the
 * body (`positionalNames`, `nameSweep`). A name the kernel can't resolve is a
 * lost reference, so a wrong role shows up as an error rather than a silent
 * guess.
 */

/** A face name made by a feature: `op:feature:role` or `op:feature:role:source`. */
export function createdName(op: string, feature: string, role: string, source?: string): string {
  const base = `${op}:${feature}:${role}`;
  return source === undefined ? base : `${base}:${sourceToken(source)}`;
}

/** A source as it goes into a name: plain tokens as they are, anything else in parentheses. */
export function sourceToken(source: string): string {
  return TOKEN.test(source) ? source : `(${source})`;
}

/** `name#n`: the `n`th (1-based) piece of a face. */
export function splitName(name: string, n: number): string {
  return `${name}#${n}`;
}

/** An edge's name from the names of the faces it bounds. */
export function edgeName(faces: readonly string[]): string {
  return `e[${distinctSorted(faces).join('|')}]`;
}

/** A vertex's name from the names of the faces around it. */
export function vertexName(faces: readonly string[]): string {
  return `v[${distinctSorted(faces).join('|')}]`;
}

/** `name@n`: the `n`th (1-based) of several edges or vertices between the same faces. */
export function indexedName(name: string, n: number): string {
  return `${name}@${n}`;
}

const TOKEN = /^[A-Za-z0-9_.~-]+$/;

function distinctSorted(names: readonly string[]): string[] {
  return [...new Set(names)].sort();
}
