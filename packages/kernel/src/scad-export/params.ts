/**
 * The parameter block of an exported `.scad` file (P6-09, ADR-0088 §5): the
 * top-level variables the written code needs, laid out for OpenSCAD's
 * Customizer — exposed parameters with their ranges and groups, the rest
 * hidden, everything in an order OpenSCAD can run.
 */
import { customizerRows, type EvaluatedParameter, type ExtrudoDocument } from '@extrudo/core';
import { type ExprContext, translateExpression } from './expr';
import { scadNumber } from './number';
import { commentText } from './print';

export interface ParameterUse {
  /** Extrudo parameter names the written code refers to directly. */
  used: Iterable<string>;
  /** Parameter name → names of features whose geometry it sets but this file holds fixed. */
  fixed?: ReadonlyMap<string, readonly string[]>;
}

export interface ParameterBlock {
  /** The OpenSCAD source; `''` when nothing is written. Ends with a newline when not empty. */
  code: string;
  /** Extrudo names written, in written order. */
  written: string[];
}

/** A group's name for its `/* [name] *\/` Customizer header: one line, no comment end, no brackets. */
function groupName(group: string): string {
  return commentText(group).replace(/\*\//g, '* /').replace(/\[/g, '(').replace(/\]/g, ')');
}

export function parameterBlock(
  doc: ExtrudoDocument,
  ctx: ExprContext,
  use: ParameterUse,
): ParameterBlock {
  const evaluation = ctx.evaluation;
  const byName = evaluation.parameters;
  const rows = new Map(customizerRows(doc, evaluation).map((r) => [r.name, r]));

  /** What the written line for a parameter is, and which written names it refers to. */
  const lineOf = new Map<string, { line: string; refs: string[] }>();
  const lineWithRefs = (p: EvaluatedParameter): { line: string; refs: string[] } => {
    let done = lineOf.get(p.name);
    if (done) return done;
    const row = rows.get(p.name);
    const name = ctx.names.get(p.name) ?? p.name;
    if (p.result.ok) {
      if (row) {
        // OpenSCAD's Customizer only shows literals, so a value, not an expression.
        done = { line: `${name} = ${scadNumber(p.result.value)};${range(row)}`, refs: [] };
      } else {
        const t = translateExpression(p.expression, p.unit, ctx);
        done = {
          line: `${name} = ${t ? t.code : scadNumber(p.result.value)};`,
          refs: t ? t.refs : [],
        };
      }
    } else {
      done = { line: `${name} = undef; // ${p.result.error.message}`, refs: [] };
    }
    lineOf.set(p.name, done);
    return done;
  };

  /** `use.used` plus, transitively, every reference of a written expression. */
  const written = new Set<string>();
  for (let queue = [...use.used].filter((n) => byName.has(n)); queue.length > 0; ) {
    const name = queue.pop() as string;
    if (written.has(name)) continue;
    written.add(name);
    const p = byName.get(name) as EvaluatedParameter;
    queue.push(...lineWithRefs(p).refs.filter((r) => byName.has(r) && !written.has(r)));
  }

  // Customizer parameters first: ungrouped, then one section per group.
  const sections: { header?: string; names: string[] }[] = [{ names: [] }];
  const seenGroup = new Map<string, number>();
  const emitted = new Set<string>();
  for (const p of doc.parameters) {
    if (!written.has(p.name) || !p.customizer || emitted.has(p.name)) continue;
    emitted.add(p.name);
    const group = p.group === undefined ? '' : groupName(p.group);
    if (!group) sections[0]?.names.push(p.name);
    else {
      const at = seenGroup.get(group);
      if (at === undefined) {
        seenGroup.set(group, sections.length);
        sections.push({ header: `/* [${group}] */`, names: [p.name] });
      } else {
        (sections[at] as { names: string[] }).names.push(p.name);
      }
    }
  }

  // The rest under `/* [Hidden] */`, a parameter after everything it refers to.
  const hidden = [...written].filter((n) => !emitted.has(n));
  hidden.sort((a, b) => [...byName.keys()].indexOf(a) - [...byName.keys()].indexOf(b));
  const order: string[] = [];
  const placed = new Set<string>();
  for (let before = -1; order.length < hidden.length && before !== order.length; ) {
    before = order.length;
    for (const name of hidden) {
      if (placed.has(name)) continue;
      const { refs } = lineWithRefs(byName.get(name) as EvaluatedParameter);
      if (refs.every((r) => !written.has(r) || emitted.has(r) || placed.has(r))) {
        placed.add(name);
        order.push(name);
      }
    }
  }
  if (order.length < hidden.length) throw new Error('Parameters refer to each other in a circle.');
  if (hidden.length > 0) sections.push({ header: '/* [Hidden] */', names: order });

  // One description line above a written parameter, when there is anything to say.
  const description = (name: string): string | undefined => {
    const parts: string[] = [];
    const comment = doc.parameters.find((q) => q.name === name)?.comment;
    if (comment) parts.push(commentText(comment));
    const fixed = [...(use.fixed?.get(name) ?? [])].map(commentText);
    if (fixed.length > 0) {
      parts.push(
        `Also sets ${fixed.slice(0, -1).join(', ')}${fixed.length > 1 ? ' and ' : ''}${fixed.at(-1)}, which this file holds fixed.`,
      );
    }
    if (parts.length === 0) return undefined;
    let text = parts[0] as string;
    for (const part of parts.slice(1)) text += text.endsWith('.') ? ` ${part}` : `. ${part}`;
    return `// ${text}`;
  };

  const lines: string[] = [];
  const orderOf: string[] = [];
  for (const section of sections) {
    if (section.names.length === 0) continue;
    if (section.header !== undefined && lines.length > 0) lines.push('');
    if (section.header !== undefined) lines.push(section.header);
    for (const name of section.names) {
      const done = description(name);
      if (done) lines.push(done);
      lines.push(lineWithRefs(byName.get(name) as EvaluatedParameter).line);
      orderOf.push(name);
    }
  }
  return { code: lines.length === 0 ? '' : `${lines.join('\n')}\n`, written: orderOf };
}

/** The Customizer's range comment, in base units: `// [min:step:max]` or `// [min:max]`. */
function range(row: { min?: number; max?: number; step?: number }): string {
  const { min, max, step } = row;
  if (min === undefined || max === undefined) return '';
  return step === undefined
    ? ` // [${scadNumber(min)}:${scadNumber(max)}]`
    : ` // [${scadNumber(min)}:${scadNumber(step)}:${scadNumber(max)}]`;
}
