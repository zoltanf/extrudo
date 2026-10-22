/**
 * Combine (`2A94257F…`) and Move (`64E40C8E…`), the features that act on
 * whole bodies.
 *
 * A combine's own members list, in this order: a reference to its state
 * record (`2E3AC990…`), its operation id (u64), the operand groups of its
 * tool bodies, 8 bytes, the body links of those tools (`D26351F0…`), then the
 * operand group of its target body; a wide GUID string closes them. Each
 * operand group holds a body operand (`9716F783…`) naming its body through a
 * body link. The two combines seen (both joins that consumed their tools)
 * have only zeros between the prologue and the first list and in the 8 bytes,
 * so where a cut, an intersect or "keep tools" is written is unknown: a
 * combine with anything else there is read without an operation.
 *
 * A move's references name its transform record (`84E6245F…`) and the
 * operand groups of the bodies it moves. The transform: 24 zero bytes, a u32
 * (5 for a free move, 1 for a turn about an axis), a byte (0 in all four
 * seen), then a 4 × 4 row-major matrix of doubles, lengths in cm (the
 * translation in the last column).
 */
import { F3dFormatError, finite, Reader } from '../bytes';
import type { Segment } from '../segment';
import { BODY } from './body';
import { OPERAND_GROUP } from './edges';
import { BODY_LINK, BODY_OPERAND } from './pattern';
import type { Scope } from './scope';
import { refAhead } from './sketch-geometry';

export const COMBINE = '2A94257F-2020-4B19-9A68-103A2672F1B7';
export const MOVE = '64E40C8E-E564-469C-8690-5C4E77C1B02C';
export const MOVE_TRANSFORM = '84E6245F-1CDC-4FB8-8048-163A85FAD3F0';

type Inside = (id: number) => number[];

export interface CombineRead {
  /** The body that stays, by body record. */
  target: number;
  /** The bodies combined into it, by body record. */
  tools: number[];
  /** Set where the bytes read as the joins seen (`undefined`: not known). */
  operation?: 'join';
}

/** The body records a body link names (its first body reference). */
function linkBody(seg: Segment, link: number, inside: Inside): number | undefined {
  return inside(link).find((r) => seg.typeOf(r)?.guid === BODY);
}

/** The bodies an operand group's body operands name, each once. */
export function groupBodies(seg: Segment, group: number, inside: Inside): number[] {
  const out: number[] = [];
  for (const member of inside(group)) {
    if (seg.typeOf(member)?.guid !== BODY_OPERAND) continue;
    for (const link of inside(member)) {
      if (seg.typeOf(link)?.guid !== BODY_LINK) continue;
      const body = linkBody(seg, link, inside);
      if (body !== undefined && !out.includes(body)) out.push(body);
    }
  }
  return out;
}

const zeroBytes = (bytes: Uint8Array, from: number, to: number): boolean => {
  for (let p = from; p < to; p++) if (bytes[p] !== 0) return false;
  return true;
};

export function readCombine(seg: Segment, scope: Scope, inside: Inside): CombineRead {
  // The references of the combine's own members, where each starts and ends.
  const refs: { id: number; start: number; end: number }[] = [];
  const r = new Reader(seg.bulk, scope.start, scope.tableAt);
  while (r.pos < scope.tableAt) {
    const id = refAhead(seg, r);
    if (id === undefined) {
      r.pos++;
      continue;
    }
    const start = r.pos;
    r.ref();
    refs.push({ id, start, end: r.pos });
  }
  const of = (guid: string) => refs.filter((x) => seg.typeOf(x.id)?.guid === guid);
  const links = of(BODY_LINK);
  const groups = of(OPERAND_GROUP);
  const first = links[0];
  const last = links[links.length - 1];
  if (!first || !last) throw new F3dFormatError(`Combine #${scope.id}: no tool bodies listed.`);
  const toolGroups = groups.filter((g) => g.end <= first.start);
  const targetGroups = groups.filter((g) => g.start >= last.end);
  const tools = [...new Set(toolGroups.flatMap((g) => groupBodies(seg, g.id, inside)))];
  const targets = [...new Set(targetGroups.flatMap((g) => groupBodies(seg, g.id, inside)))];
  const listed = links.map((l) => linkBody(seg, l.id, inside));
  const [target] = targets;
  if (target === undefined || targets.length !== 1 || tools.length === 0)
    throw new F3dFormatError(
      `Combine #${scope.id}: ${targets.length} targets and ${tools.length} tools.`,
    );
  if (tools.includes(target) || listed.some((b) => b === undefined || !tools.includes(b)))
    throw new F3dFormatError(`Combine #${scope.id}: its tool lists disagree.`);
  // The bytes the joins seen keep zero: after the prologue up to the first
  // list's count, and the 8 bytes between the tool groups and their links.
  const lastTool = toolGroups[toolGroups.length - 1];
  const head = refs[0];
  const join =
    head !== undefined &&
    lastTool !== undefined &&
    first.start - lastTool.end === 12 &&
    zeroBytes(seg.bulk, scope.start + 2, head.start - 4) &&
    zeroBytes(seg.bulk, lastTool.end, first.start - 4);
  return { target, tools, ...(join ? { operation: 'join' as const } : {}) };
}

export interface MoveRead {
  /** The bodies it moves, by body record. */
  bodies: number[];
  /** Row-major 4 × 4, cm. */
  matrix: number[];
}

export function readMove(seg: Segment, scope: Scope, inside: Inside): MoveRead {
  const transform = scope.refs.find((id) => seg.typeOf(id)?.guid === MOVE_TRANSFORM);
  if (transform === undefined) throw new F3dFormatError(`Move #${scope.id}: no transform.`);
  const r = seg.reader(transform);
  r.zeros(24);
  r.u32(); // the kind of move
  r.u8();
  const matrix: number[] = [];
  for (let i = 0; i < 16; i++) matrix.push(r.f64());
  finite(`Move transform #${transform}`, matrix);
  const bodies: number[] = [];
  for (const group of scope.refs)
    if (seg.typeOf(group)?.guid === OPERAND_GROUP)
      for (const body of groupBodies(seg, group, inside))
        if (!bodies.includes(body)) bodies.push(body);
  return { bodies, matrix };
}
