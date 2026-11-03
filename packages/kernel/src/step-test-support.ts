// Test support (no production code): reads a STEP Part 21 text far enough to
// check how faces use their edges (P4-12, ADR-0034's third amendment). Ported
// from spikes/stl-to-solid/torus_loops.py (`analyse()`'s `uses`), without the
// sampling.

type Arg = string | number | null | Ref | Enum | Arg[];
type Ref = { ref: number };
type Enum = { enum: string };

/** Every simple entity of the DATA section: id -> [TYPE, args]. Complex entities are left out. */
export function stepEntities(text: string): Map<number, [string, Arg[]]> {
  const data = text.slice(text.indexOf('DATA;') + 5);
  const out = new Map<number, [string, Arg[]]>();
  const entity = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(/g;
  for (let m = entity.exec(data); m; m = entity.exec(data)) {
    const [args, end] = parseArgs(data, m.index + m[0].length - 1);
    out.set(Number(m[1]), [m[2] as string, args]);
    entity.lastIndex = end;
  }
  return out;
}

function parseArgs(text: string, start: number): [Arg[], number] {
  let i = start + 1;
  const out: Arg[] = [];
  for (;;) {
    while (' \n\r\t,'.includes(text[i] as string)) i++;
    const c = text[i];
    if (c === ')') return [out, i + 1];
    if (c === '(') {
      const [list, next] = parseArgs(text, i);
      out.push(list);
      i = next;
    } else if (c === "'") {
      let j = i + 1;
      while (text[j] !== "'" || text[j + 1] === "'") j += text[j] === "'" ? 2 : 1;
      out.push(text.slice(i + 1, j));
      i = j + 1;
    } else if (c === '#') {
      const m = /^#(\d+)/.exec(text.slice(i, i + 20)) as RegExpExecArray;
      out.push({ ref: Number(m[1]) });
      i += m[0].length;
    } else if (c === '.') {
      const j = text.indexOf('.', i + 1);
      out.push({ enum: text.slice(i + 1, j) });
      i = j + 1;
    } else if (c === '$' || c === '*') {
      out.push(null);
      i++;
    } else {
      const m = /^[-+0-9.Ee]+/.exec(text.slice(i, i + 40));
      if (m) {
        out.push(Number(m[0]));
        i += m[0].length;
      } else {
        // A typed parameter, e.g. LENGTH_MEASURE(1.): its value list.
        const name = /^[A-Z0-9_]+\s*/.exec(text.slice(i)) as RegExpExecArray;
        const [list, next] = parseArgs(text, i + name[0].length);
        out.push(list);
        i = next;
      }
    }
  }
}

/**
 * How the faces use their edges: for every EDGE_CURVE, one entry per use
 * (true when the use runs along the curve: ORIENTED_EDGE.orientation XNOR the
 * bound's orientation). In a closed shell each edge has two uses, opposite.
 */
export function stepEdgeUses(text: string): Map<number, boolean[]> {
  const e = stepEntities(text);
  const get = (a: Arg) => e.get((a as Ref).ref) as [string, Arg[]];
  const flag = (a: Arg) => (a as Enum).enum === 'T';
  const uses = new Map<number, boolean[]>();
  for (const [type, args] of e.values()) {
    if (type !== 'ADVANCED_FACE') continue;
    for (const b of args[1] as Arg[]) {
      const [, bound] = get(b);
      const [loopType, loop] = get(bound[1] as Arg);
      if (loopType !== 'EDGE_LOOP') continue;
      for (const oe of loop[1] as Arg[]) {
        const [, oriented] = get(oe);
        const edge = (oriented[3] as Ref).ref;
        const along = flag(oriented[4] as Arg) === flag(bound[2] as Arg);
        uses.set(edge, [...(uses.get(edge) ?? []), along]);
      }
    }
  }
  return uses;
}

/** The edges whose uses aren't exactly two opposite ones (empty for a sound closed shell). */
export function badEdgeUses(text: string): { edge: number; uses: boolean[] }[] {
  return [...stepEdgeUses(text)]
    .filter(([, uses]) => uses.length !== 2 || uses[0] === uses[1])
    .map(([edge, uses]) => ({ edge, uses }));
}
