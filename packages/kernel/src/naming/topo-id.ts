/**
 * Persistent names of faces, edges and vertices (TopoIds, ADR-0005).
 *
 * ```
 * face     = created split*
 * created  = op ":" feature ":" role (":" source)?     extrude:F1:cap:end, extrude:F1:side:l3
 * source   = token | "(" name ")"                      a sketch curve ID, or a nested name
 * split    = "#" n                                     pieces of one face, n ≥ 1
 * edge     = "e[" face ("|" face)* "]" ("@" n)?        the distinct faces it bounds, sorted
 * vertex   = "v[" face ("|" face)* "]" ("@" n)?        the distinct faces around it, sorted
 * ```
 *
 * `#n` numbers the pieces of a face that an operation split (or faces that
 * would otherwise share a name); `@n` numbers edges or vertices between the
 * same faces. Both follow a geometric order (`compareGeometry` in names.ts).
 * A token is a plain ID (letters, digits, `_ . ~ -`); anything else is
 * wrapped in parentheses, so names nest without ambiguity. Names never
 * contain `/`, which references use to name a feature's output
 * (`<sketch>/<region>`, ADR-0024).
 */

const TOKEN = /^[A-Za-z0-9_.~-]+$/;

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

function distinctSorted(names: readonly string[]): string[] {
  return [...new Set(names)].sort();
}

export interface ParsedFace {
  /** The name without its split suffixes. */
  stem: string;
  /** The split numbers, outermost last: `a#2#1` → [2, 1]. */
  splits: number[];
}

/** Splits a face name into its stem and split numbers. */
export function parseFace(name: string): ParsedFace {
  // Split suffixes can only follow the last closing parenthesis.
  const tail = name.slice(name.lastIndexOf(')') + 1);
  const match = /(#\d+)+$/.exec(tail);
  if (!match) return { stem: name, splits: [] };
  const suffix = match[0];
  return {
    stem: name.slice(0, name.length - suffix.length),
    splits: suffix
      .slice(1)
      .split('#')
      .map((n) => Number(n)),
  };
}

export interface ParsedCompound {
  kind: 'edge' | 'vertex';
  /** The face names, sorted and distinct. */
  faces: string[];
  /** The `@n` number, if any. */
  index?: number;
}

/** Parses an edge or vertex name; undefined for a face name. */
export function parseCompound(name: string): ParsedCompound | undefined {
  const kind = name.startsWith('e[') ? 'edge' : name.startsWith('v[') ? 'vertex' : undefined;
  if (!kind) return undefined;
  const close = matchingBracket(name, 1);
  if (close < 0) return undefined;
  const inner = name.slice(2, close);
  const rest = name.slice(close + 1);
  const index = /^@(\d+)$/.exec(rest);
  if (rest !== '' && !index) return undefined;
  const faces = inner === '' ? [] : splitTopLevel(inner);
  return index ? { kind, faces, index: Number(index[1]) } : { kind, faces };
}

/** The index of the bracket closing the one at `open`, or -1. */
function matchingBracket(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Splits at `|` outside parentheses and brackets. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === '|' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/**
 * How closely two face names relate: 2 if equal, 1 if one is a piece of
 * the other (same stem, one split chain a prefix of the other: `a` and
 * `a#2`, `a#2` and `a#2#1`), else 0.
 */
export function faceRelation(a: string, b: string): number {
  if (a === b) return 2;
  const pa = parseFace(a);
  const pb = parseFace(b);
  if (pa.stem !== pb.stem) return 0;
  const n = Math.min(pa.splits.length, pb.splits.length);
  for (let i = 0; i < n; i++) if (pa.splits[i] !== pb.splits[i]) return 0;
  return 1;
}

/**
 * How closely two names of the same kind relate, or 0 if they don't:
 * - faces: see `faceRelation`;
 * - edges and vertices: their faces pair up one to one, each pair related;
 *   the score is the number of equal pairs plus 1, plus 1 more if the `@n`
 *   numbers agree. An exact match scores highest.
 */
export function nameRelation(a: string, b: string): number {
  if (a === b) return Number.POSITIVE_INFINITY;
  const ca = parseCompound(a);
  const cb = parseCompound(b);
  if (!ca || !cb) return ca || cb ? 0 : faceRelation(a, b);
  if (ca.kind !== cb.kind || ca.faces.length !== cb.faces.length) return 0;
  const equal = bestPairing(ca.faces, cb.faces);
  if (equal < 0) return 0;
  return 1 + equal + (ca.index === cb.index ? 1 : 0);
}

/**
 * Pairs `a`'s faces with `b`'s one to one so every pair is related,
 * maximising the equal pairs. Returns their number, or -1 if no pairing
 * exists. Equal names pair first; the rest is paired by brute force, which
 * is cheap for the handful of faces an edge or vertex has.
 */
function bestPairing(a: readonly string[], b: readonly string[]): number {
  const inA = new Set(a);
  const inB = new Set(b);
  const restA = a.filter((name) => !inB.has(name));
  const restB = b.filter((name) => !inA.has(name));
  const equal = a.length - restA.length;
  if (restA.length === 0) return equal;
  if (restA.length <= 7 && anyPairing(restA, restB) >= 0) return equal;
  // Pairing equal names first can leave the rest unpairable; try all ways.
  return a.length <= 7 ? anyPairing(a, b) : -1;
}

function anyPairing(a: readonly string[], b: readonly string[]): number {
  const used = new Array<boolean>(b.length).fill(false);
  let best = -1;
  const visit = (i: number, equal: number) => {
    if (i === a.length) {
      best = Math.max(best, equal);
      return;
    }
    for (let j = 0; j < b.length; j++) {
      if (used[j]) continue;
      const relation = faceRelation(a[i] as string, b[j] as string);
      if (relation === 0) continue;
      used[j] = true;
      visit(i + 1, equal + (relation === 2 ? 1 : 0));
      used[j] = false;
    }
  };
  visit(0, 0);
  return best;
}
