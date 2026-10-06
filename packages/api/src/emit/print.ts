/**
 * A tiny TypeScript writer for the macro emitter (ADR-0073 §2): statements are
 * built as a small tree and printed the way Biome's formatter would print them
 * (two spaces, single quotes, trailing commas, 100 columns). Keeping the output
 * already formatted is what lets `emitScript`'s own test run `biome format` and
 * find nothing to change, so a macro pasted into a Script feature reads like
 * the rest of the repository.
 *
 * Only what the emitter writes is supported: `const` statements, calls, object
 * and array literals, template literals, arrow functions and literals. A node
 * that would exceed the width breaks the same way Biome breaks it — object and
 * array entries one to a line, a call's arguments one to a line, and a lone
 * object argument or a trailing arrow hugging the call.
 */

/** How wide a line may be (Biome's `lineWidth`). */
const WIDTH = 100;

export type Expr =
  | { t: 'raw'; s: string }
  | { t: 'str'; v: string }
  | { t: 'num'; v: number }
  | { t: 'bool'; v: boolean }
  | { t: 'tmpl'; segments: (string | { expr: string })[] }
  | { t: 'arr'; items: Expr[] }
  | { t: 'obj'; props: [string, Expr][] }
  | { t: 'call'; callee: string; args: Expr[] }
  | { t: 'arrow'; params: string; body: Stmt[] };

export type Stmt =
  | { s: 'const'; name: string; value: Expr; comment?: string }
  | { s: 'expr'; value: Expr; comment?: string }
  | { s: 'comment'; text: string };

export const raw = (s: string): Expr => ({ t: 'raw', s });
export const str = (v: string): Expr => ({ t: 'str', v });
export const num = (v: number): Expr => ({ t: 'num', v });
export const bool = (v: boolean): Expr => ({ t: 'bool', v });
export const tmpl = (segments: (string | { expr: string })[]): Expr => ({ t: 'tmpl', segments });
export const arr = (items: Expr[]): Expr => ({ t: 'arr', items });
export const obj = (props: [string, Expr][]): Expr => ({ t: 'obj', props });
export const call = (callee: string, args: Expr[]): Expr => ({ t: 'call', callee, args });
export const arrow = (params: string, body: Stmt[]): Expr => ({ t: 'arrow', params, body });
export const constant = (name: string, value: Expr, comment?: string): Stmt => ({
  s: 'const',
  name,
  value,
  ...(comment ? { comment } : {}),
});
export const statement = (value: Expr, comment?: string): Stmt => ({
  s: 'expr',
  value,
  ...(comment ? { comment } : {}),
});
export const comment = (text: string): Stmt => ({ s: 'comment', text: `// ${text}` });

/** A whole program (a list of statements) as the formatted source. */
export function printProgram(statements: readonly Stmt[]): string {
  return `${statements.map((stmt) => printStmt(stmt, 0)).join('\n')}\n`;
}

/** One statement, its whole first line indented by `indent`, wrapped lines too. */
function printStmt(stmt: Stmt, indent: number): string {
  if (stmt.s === 'comment') return `${pad(indent)}${stmt.text}`;
  const lead = stmt.comment ? `${pad(indent)}${stmt.comment}\n` : '';
  if (stmt.s === 'const') {
    const prefix = `const ${stmt.name} = `;
    return `${lead}${pad(indent)}${prefix}${print(stmt.value, indent, indent * 2 + prefix.length, 1)};`;
  }
  return `${lead}${pad(indent)}${print(stmt.value, indent, indent * 2, 1)};`;
}

/**
 * An expression: one line when it fits in the remaining width, broken the way
 * Biome breaks it otherwise. `col` is the column its first line starts at and
 * `trailing` the characters that follow it on that line (a comma or a bracket),
 * so the fits test is Biome's own.
 */
function print(node: Expr, indent: number, col = indent * 2, trailing = 0): string {
  const flat = flatOf(node);
  if (flat !== undefined && col + flat.length + trailing <= WIDTH) return flat;
  switch (node.t) {
    case 'arr': {
      if (node.items.length === 0) return '[]';
      const items = node.items.map(
        (item) => `${pad(indent + 1)}${print(item, indent + 1, (indent + 1) * 2, 1)}`,
      );
      return `[\n${items.join(',\n')},\n${pad(indent)}]`;
    }
    case 'obj': {
      if (node.props.length === 0) return '{}';
      const props = node.props.map(
        ([key, value]) =>
          `${pad(indent + 1)}${key}: ${print(value, indent + 1, (indent + 1) * 2 + key.length + 2, 1)}`,
      );
      return `{\n${props.join(',\n')},\n${pad(indent)}}`;
    }
    case 'call': {
      const { args } = node;
      if (args.length === 0) return `${node.callee}()`;
      const last = args[args.length - 1] as Expr;
      const open = `${node.callee}(`;
      // A trailing arrow hugs the call: `design.sketch(plane, (k) => {`.
      if (last.t === 'arrow') {
        const before = args.slice(0, -1);
        const head = `${open}${before.map((arg) => print(arg, indent, col + open.length, 0)).join(', ')}${before.length > 0 ? ', ' : ''}`;
        return `${head}${printArrow(last, indent, col + head.length)})`;
      }
      // A lone object or array argument hugs too: `design.fillet({`.
      if (args.length === 1 && (last.t === 'obj' || last.t === 'arr')) {
        return `${open}${print(last, indent, col + open.length, 1)})`;
      }
      // A trailing object hugs when the arguments before it are simple and fit
      // on the first line (Biome's last-argument expansion); an earlier object
      // or array makes Biome break every argument instead.
      if (last.t === 'obj') {
        const earlier = args.slice(0, -1);
        const simple = earlier.every((arg) => arg.t !== 'obj' && arg.t !== 'arr');
        const head = earlier.map((arg) => flatOf(arg));
        if (simple && head.every((arg) => arg !== undefined)) {
          const before = head.join(', ');
          const start = col + open.length + (before ? before.length + 2 : 0);
          if (start + 1 <= WIDTH) {
            return `${open}${before}${before ? ', ' : ''}${print(last, indent, start, 1)})`;
          }
        }
      }
      const inner = args.map(
        (arg) => `${pad(indent + 1)}${print(arg, indent + 1, (indent + 1) * 2, 1)}`,
      );
      return `${open}\n${inner.join(',\n')},\n${pad(indent)})`;
    }
    case 'arrow':
      return printArrow(node, indent, col);
    default:
      return flat ?? '';
  }
}

function printArrow(node: { params: string; body: Stmt[] }, indent: number, _col: number): string {
  const body = node.body.map((stmt) => printStmt(stmt, indent + 1));
  return `${node.params} => {\n${body.join('\n')}\n${pad(indent)}}`;
}

/** The single-line form of an expression, or `undefined` when it has none. */
function flatOf(node: Expr): string | undefined {
  switch (node.t) {
    case 'raw':
      return node.s;
    case 'str':
      return quote(node.v);
    case 'num':
      return String(node.v);
    case 'bool':
      return String(node.v);
    case 'tmpl':
      return `\`${node.segments.map(templatePart).join('')}\``;
    case 'arr': {
      if (node.items.length === 0) return '[]';
      // Biome always breaks an array of several arrays (or objects) of several
      // items each, such as a spline's points: it has no one-line form.
      if (isMatrix(node.items)) return undefined;
      const items = node.items.map((item) => flatOf(item));
      if (items.some((item) => item === undefined)) return undefined;
      return `[${items.join(', ')}]`;
    }
    case 'obj': {
      if (node.props.length === 0) return '{}';
      const props = node.props.map(([key, value]) => [key, flatOf(value)] as const);
      if (props.some(([, value]) => value === undefined)) return undefined;
      return `{ ${props.map(([key, value]) => `${key}: ${value}`).join(', ')} }`;
    }
    case 'call': {
      const args = node.args.map((arg) => flatOf(arg));
      if (args.some((arg) => arg === undefined)) return undefined;
      return `${node.callee}(${args.join(', ')})`;
    }
    case 'arrow':
      return undefined;
  }
}

/** Several arrays, or several objects, of more than one item each (Biome's rule for breaking). */
function isMatrix(items: readonly Expr[]): boolean {
  if (items.length < 2) return false;
  const kind = items[0]?.t;
  return items.every(
    (item) =>
      item.t === kind &&
      ((item.t === 'arr' && item.items.length > 1) || (item.t === 'obj' && item.props.length > 1)),
  );
}

function templatePart(segment: string | { expr: string }): string {
  return typeof segment === 'string' ? escapeTemplate(segment) : `\${${segment.expr}}`;
}

function pad(indent: number): string {
  return '  '.repeat(indent);
}

/** A string as Biome writes it with `quoteStyle: single`: the quote that needs fewer escapes. */
function quote(value: string): string {
  if (value.includes("'") && !value.includes('"')) return `"${escapeString(value, '"')}"`;
  return `'${escapeString(value, "'")}'`;
}

function escapeString(value: string, quoteChar: '"' | "'"): string {
  let out = '';
  for (const char of value) {
    if (char === '\\') out += '\\\\';
    else if (char === quoteChar) out += `\\${char}`;
    else if (char === '\n') out += '\\n';
    else if (char === '\r') out += '\\r';
    else if (char === '\t') out += '\\t';
    else out += char;
  }
  return out;
}

/** Text inside a template literal: backticks and `${` escaped, nothing else. */
function escapeTemplate(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}
