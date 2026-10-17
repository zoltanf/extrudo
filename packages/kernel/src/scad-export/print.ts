/**
 * The IR as OpenSCAD source (P6-09, ADR-0088): two-space indent, one
 * statement per line, every number through `scadNumber`, so the same tree
 * always prints the same text.
 *
 * A node with one child chains it on the next line (`translate([…])` then the
 * child, indented); with several, braces. A polyhedron writes a few points
 * and faces per line.
 */
import type { CsgNode, Scalar, Vec2, Vec3 } from './ir';
import { scadNumber } from './number';

/** How the printer writes the references the IR holds. */
export interface PrintRefs {
  /** The module that makes a body version (`Bracket_v3`). */
  version(body: string, version: number): string;
  /** A shared tool: its module's name, or the node to write in its place. */
  tool(tool: number): string | CsgNode;
}

const INDENT = '  ';
const POINTS_PER_LINE = 4;
const FACES_PER_LINE = 8;

export function scalar(value: Scalar): string {
  return typeof value === 'number' ? scadNumber(value) : value.expr;
}

function vector(values: Vec2 | Vec3 | readonly number[]): string {
  return `[${values.map(scalar).join(', ')}]`;
}

/** Named arguments, leaving out the absent ones. */
function args(list: readonly (readonly [string, string | undefined])[]): string {
  return list
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name} = ${value}`)
    .join(', ');
}

/** The statement's head: the call without its children. */
function head(node: CsgNode, refs: PrintRefs): string {
  switch (node.kind) {
    case 'translate':
    case 'scale':
    case 'mirror':
      return `${node.kind}(${vector(node.v)})`;
    case 'rotate': {
      const a = typeof node.a === 'object' && 'length' in node.a ? vector(node.a) : scalar(node.a);
      return node.v ? `rotate(a = ${a}, v = ${vector(node.v)})` : `rotate(${a})`;
    }
    case 'multmatrix':
      return `multmatrix([${node.m.map((row) => vector(row)).join(', ')}, [0, 0, 0, 1]])`;
    case 'color':
      return node.alpha === undefined
        ? `color("${node.color}")`
        : `color("${node.color}", ${scadNumber(node.alpha)})`;
    case 'union':
    case 'difference':
    case 'intersection':
      return `${node.kind}()`;
    case 'cube':
      return `cube(${
        node.center
          ? args([
              ['size', vector(node.size)],
              ['center', 'true'],
            ])
          : vector(node.size)
      })`;
    case 'cylinder':
      return `cylinder(${args([
        ['h', scalar(node.h)],
        ['r1', scalar(node.r1)],
        ['r2', scalar(node.r2)],
        ['center', node.center ? 'true' : undefined],
      ])})`;
    case 'sphere':
      return `sphere(r = ${scalar(node.r)})`;
    case 'circle':
      return `circle(r = ${scalar(node.r)})`;
    case 'square':
      return `square(${
        node.center
          ? args([
              ['size', vector(node.size)],
              ['center', 'true'],
            ])
          : vector(node.size)
      })`;
    case 'linear_extrude': {
      const scale =
        node.scale === undefined
          ? undefined
          : typeof node.scale === 'object' && 'length' in node.scale
            ? vector(node.scale)
            : scalar(node.scale);
      return `linear_extrude(${args([
        ['height', scalar(node.height)],
        ['center', node.center ? 'true' : undefined],
        ['twist', node.twist === undefined ? undefined : scalar(node.twist)],
        ['scale', scale],
      ])})`;
    }
    case 'rotate_extrude':
      return `rotate_extrude(${node.angle === undefined ? '' : args([['angle', scalar(node.angle)]])})`;
    case 'version':
      return `${refs.version(node.body, node.version)}()`;
    case 'polygon':
    case 'polyhedron':
    case 'tool':
      throw new Error(`${node.kind} has no one-line head.`);
  }
}

/** Lines of `values` printed `perLine` to a line, comma-separated, at `indent`. */
function rows(values: readonly string[], perLine: number, indent: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < values.length; i += perLine) {
    const last = i + perLine >= values.length;
    out.push(`${indent}${values.slice(i, i + perLine).join(', ')}${last ? '' : ','}`);
  }
  return out;
}

/** The node as statement lines at `depth`, each ending as OpenSCAD wants. */
export function printNode(node: CsgNode, refs: PrintRefs, depth = 0): string[] {
  const pad = INDENT.repeat(depth);
  const inner = INDENT.repeat(depth + 1);
  switch (node.kind) {
    case 'tool': {
      const found = refs.tool(node.tool);
      return typeof found === 'string' ? [`${pad}${found}();`] : printNode(found, refs, depth);
    }
    case 'polygon': {
      const points = node.points.map((p) => vector(p));
      if (!node.paths) {
        return [`${pad}polygon(points = [`, ...rows(points, POINTS_PER_LINE, inner), `${pad}]);`];
      }
      return [
        `${pad}polygon(`,
        `${inner}points = [`,
        ...rows(points, POINTS_PER_LINE, inner + INDENT),
        `${inner}],`,
        `${inner}paths = [`,
        ...rows(
          node.paths.map((path) => vector(path)),
          1,
          inner + INDENT,
        ),
        `${inner}]`,
        `${pad});`,
      ];
    }
    case 'polyhedron':
      return [
        `${pad}polyhedron(`,
        `${inner}points = [`,
        ...rows(
          node.points.map((p) => vector(p)),
          POINTS_PER_LINE,
          inner + INDENT,
        ),
        `${inner}],`,
        `${inner}faces = [`,
        ...rows(
          node.faces.map((f) => vector(f)),
          FACES_PER_LINE,
          inner + INDENT,
        ),
        `${inner}]`,
        `${pad});`,
      ];
    default:
      break;
  }
  const line = `${pad}${head(node, refs)}`;
  if (!('children' in node)) return [`${line};`];
  const { children } = node;
  if (children.length === 0) return [`${line};`];
  if (children.length === 1) return [line, ...printNode(children[0] as CsgNode, refs, depth + 1)];
  return [`${line} {`, ...children.flatMap((c) => printNode(c, refs, depth + 1)), `${pad}}`];
}

/** `module name() { … }` around a node. */
export function printModule(name: string, node: CsgNode, refs: PrintRefs): string[] {
  return [`module ${name}() {`, ...printNode(node, refs, 1), '}'];
}

/** One line of a comment, without line breaks. */
export function commentText(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim();
}
