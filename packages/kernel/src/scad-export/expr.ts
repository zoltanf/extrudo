/**
 * An Extrudo expression as OpenSCAD code (P6-09, ADR-0088 §6): base units
 * (mm, degrees), the document's length unit for bare numbers, parameters as
 * variables. The walk mirrors core's evaluator exactly, so a translated
 * expression evaluates to the same number here and in OpenSCAD; anything the
 * language pair can't share leaves the expression untranslatable and the
 * caller writes its value instead.
 */
import type { LengthUnit, ParameterEvaluation, UnitKind } from '@extrudo/core';
import {
  CONSTANTS,
  type Dim,
  dimOfKind,
  evaluateNode,
  isUnitless,
  lengthFactor,
  type Node,
  parse,
  type Quantity,
  type Scope,
  sameDim,
  UNITLESS,
} from '@extrudo/core';
import { scadNumber } from './number';

/** OpenSCAD keywords and built-in names a variable must not take. */
export const SCAD_RESERVED: ReadonlySet<string> = new Set(
  `module function include use if else for let each assert echo true false undef PI cube sphere
   cylinder polyhedron square circle polygon text union difference intersection translate rotate
   scale resize mirror multmatrix color offset hull minkowski linear_extrude rotate_extrude import
   surface projection render children abs sign sin cos tan acos asin atan atan2 floor round ceil
   ln len log lookup max min norm pow rands sqrt exp concat cross chr ord str search version
   version_num is_undef is_bool is_num is_string is_list is_function parent_module`
    .trim()
    .split(/\s+/),
);

/** Each parameter's OpenSCAD variable, by Extrudo name. */
export function scadNames(evaluation: ParameterEvaluation): Map<string, string> {
  const names = new Map<string, string>();
  for (const name of evaluation.parameters.keys()) {
    let candidate = name;
    while (
      SCAD_RESERVED.has(candidate) ||
      names.has(candidate) ||
      (candidate !== name && evaluation.parameters.has(candidate))
    ) {
      candidate += '_';
    }
    names.set(name, candidate);
  }
  return names;
}

export interface ExprContext {
  evaluation: ParameterEvaluation;
  /** The document's `doc.settings.units`. */
  lengthUnit: LengthUnit;
  /** From `scadNames`. */
  names: ReadonlyMap<string, string>;
}

export interface TranslatedExpr {
  /** OpenSCAD expression, in base units (mm, degrees). */
  code: string;
  /** Extrudo parameter names the code refers to, each once, in first-use order. */
  refs: string[];
}

/** One node's code and value while the tree is walked. */
interface Piece {
  code: string;
  /** Whether the code can stand where an atom may: literal, name, call, or already in one pair. */
  atomic: boolean;
  q: Quantity;
}

/** Undefined when the expression doesn't parse, doesn't evaluate, or names something unknown. */
export function translateExpression(
  source: string,
  kind: UnitKind | undefined,
  ctx: ExprContext,
): TranslatedExpr | undefined {
  try {
    const root = parse(source);
    const scope: Scope = {
      lookup: (name) => {
        const p = ctx.evaluation.parameters.get(name);
        return p?.result.ok ? { value: p.result.value, dim: p.result.dim } : undefined;
      },
      names: () => ctx.evaluation.parameters.keys(),
      lengthUnit: ctx.lengthUnit,
    };
    const unit = lengthFactor(ctx.lengthUnit);
    const refs: string[] = [];
    const seen = new Set<string>();

    const walk = (node: Node): Piece => {
      const q = evaluateNode(node, scope);
      switch (node.kind) {
        case 'num':
          return { code: scadNumber(q.value), atomic: true, q };
        case 'ref': {
          if (Object.hasOwn(CONSTANTS, node.name)) {
            return { code: node.name.toUpperCase(), atomic: true, q };
          }
          const name = ctx.names.get(node.name);
          if (name === undefined) throw new Error(`Unknown name \`${node.name}\`.`);
          if (!seen.has(node.name)) {
            seen.add(node.name);
            refs.push(node.name);
          }
          return { code: name, atomic: true, q };
        }
        case 'unary': {
          const arg = walk(node.arg);
          if (node.op === '+') return arg;
          // `-x` on its own for a literal or a name; anything else gets a pair of its own.
          const atom =
            /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(arg.code) ||
            /^[A-Za-z_]\w*$/.test(arg.code);
          if (atom) return { code: `-${arg.code}`, atomic: false, q };
          return { code: `-(${strip(arg.code)})`, atomic: false, q };
        }
        case 'binary': {
          const a = walk(node.left);
          const b = walk(node.right);
          switch (node.op) {
            case '+':
            case '-': {
              // The evaluator's rule: a bare number takes the other side's unit.
              const dim = a.q.bare && isUnitless(a.q.dim) ? b.q.dim : a.q.dim;
              return {
                code: `(${matched(a, dim)} ${node.op} ${matched(b, dim)})`,
                atomic: true,
                q,
              };
            }
            case '*':
            case '/':
              return { code: `(${a.code} ${node.op} ${strictly(b)})`, atomic: true, q };
            case '^':
              return { code: `pow(${a.code}, ${b.code})`, atomic: true, q };
            default:
              throw new Error('Unknown operator.');
          }
        }
        case 'call': {
          const args = node.args.map(walk);
          switch (node.name) {
            case 'sin':
            case 'cos':
            case 'tan': {
              // An angle or a bare number is degrees; a named number is radians.
              const arg = args[0] as Piece;
              const code =
                isUnitless(arg.q.dim) && !arg.q.bare ? `${strictly(arg)} * 180 / PI` : arg.code;
              return { code: `${node.name}(${code})`, atomic: true, q };
            }
            case 'asin':
            case 'acos':
            case 'atan':
              return { code: `${node.name}(${(args[0] as Piece).code})`, atomic: true, q };
            case 'sqrt':
            case 'abs':
              return { code: `${node.name}(${(args[0] as Piece).code})`, atomic: true, q };
            case 'min':
            case 'max': {
              // The evaluator's rule: a bare number takes the first named side's unit.
              const dim = args.find((a) => !isUnitless(a.q.dim) || !a.q.bare)?.q.dim ?? UNITLESS;
              return {
                code: `${node.name}(${args.map((a) => matched(a, dim)).join(', ')})`,
                atomic: true,
                q,
              };
            }
            default: {
              // round, floor, ceil: rounding in display units, as Extrudo does.
              const arg = args[0] as Piece;
              const u = unit ** arg.q.dim.length;
              if (u === 1) return { code: `${node.name}(${arg.code})`, atomic: true, q };
              return {
                code: `${node.name}(${strictly(arg)} / ${scadNumber(u)}) * ${scadNumber(u)}`,
                atomic: false,
                q,
              };
            }
          }
        }
      }
    };

    /** A bare operand takes `dim`'s unit; anything else already matches. */
    const matched = (side: Piece, dim: Dim): string => {
      if (sameDim(side.q.dim, dim)) return side.code;
      if (!(side.q.bare && isUnitless(side.q.dim))) throw new Error('Dimension mismatch.');
      return withFactor(side.code, side.atomic, side.q.value, unit ** dim.length);
    };

    const result = walk(root);
    let { code } = result;
    if (kind && result.q.bare && isUnitless(result.q.dim)) {
      code = withFactor(code, result.atomic, result.q.value, unit ** dimOfKind(kind).length);
    }
    return { code: strip(code), refs };
  } catch {
    return undefined;
  }
}

/** `code * factor` for a bare unitless number: a literal folds (`2` in cm becomes `20`). */
function withFactor(code: string, atomic: boolean, value: number, factor: number): string {
  if (factor === 1) return code;
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(code)) return scadNumber(value * factor);
  return `${atomic ? code : `(${strip(code)})`} * ${scadNumber(factor)}`;
}

/** In parentheses unless the code is itself an atom. */
function strictly(arg: Piece): string {
  return arg.atomic ? arg.code : `(${arg.code})`;
}

/** One pair of parentheses that encloses the whole code, if there is one. */
function strip(code: string): string {
  if (!code.startsWith('(')) return code;
  let depth = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return i === code.length - 1 ? code.slice(1, -1) : code;
    }
  }
  return code;
}
