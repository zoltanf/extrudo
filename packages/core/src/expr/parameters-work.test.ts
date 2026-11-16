import { describe, expect, it, vi } from 'vitest';
import { createDocument } from '../document';
import type { ExtrudoDocument, Parameter } from '../schema';
import { pid } from '../testing';
import { combine } from './evaluate';
import { evaluateParameters } from './parameters';
import { type Node, parse } from './parser';

// Every expression node evaluation goes through `combine`: counting its calls counts the work.
vi.mock('./evaluate', async (importOriginal) => {
  const original = await importOriginal<typeof import('./evaluate')>();
  return { ...original, combine: vi.fn(original.combine) };
});

function doc(expressions: [name: string, expression: string][]): ExtrudoDocument {
  const parameters: Parameter[] = expressions.map(([name, expression], i) => ({
    id: pid(`id-${i}`),
    name,
    expression,
    unit: 'length',
  }));
  return { ...createDocument({ now: '2026-11-15T10:00:00.000Z' }), parameters };
}

function nodes(node: Node): Node[] {
  switch (node.kind) {
    case 'num':
    case 'ref':
      return [node];
    case 'unary':
      return [node, ...nodes(node.arg)];
    case 'binary':
      return [node, ...nodes(node.left), ...nodes(node.right)];
    case 'call':
      return [node, ...node.args.flatMap(nodes)];
  }
}

/** Evaluates `d` and checks that every node of every expression was evaluated exactly once. */
function evaluatedOnce(d: ExtrudoDocument) {
  const counted = vi.mocked(combine);
  counted.mockClear();
  const evaluation = evaluateParameters(d);
  const calls = new Map<Node, number>();
  for (const [node] of counted.mock.calls) calls.set(node, (calls.get(node) ?? 0) + 1);
  // Each parse makes new nodes: compare by shape, expression by expression, in order.
  const expected = d.parameters.reduce((n, p) => n + nodes(parse(p.expression)).length, 0);
  expect(counted.mock.calls.length).toBe(expected);
  expect([...calls.values()].every((n) => n === 1)).toBe(true);
  const refs = counted.mock.calls.filter(([node]) => node.kind === 'ref').length;
  const expectedRefs = d.parameters.reduce(
    (n, p) => n + nodes(parse(p.expression)).filter((x) => x.kind === 'ref').length,
    0,
  );
  expect(refs).toBe(expectedRefs);
  return evaluation;
}

describe('evaluation work', () => {
  it('evaluates each parameter once along a long spine with wide branches at its far end', () => {
    // `s0 … s253`, each `max(c, …, c, s(i+1))`; the last takes the maximum of
    // 200 parameters, each `abs(c) + 1 mm`.
    const fill = Array(50).fill('c').join(', ');
    const spine: [string, string][] = Array.from({ length: 254 }, (_, i) => [
      `s${i}`,
      `max(${fill}, s${i + 1})`,
    ]);
    const tips = Array.from({ length: 200 }, (_, i) => `t${i}`);
    const evaluation = evaluatedOnce(
      doc([
        ['c', '1 mm'],
        ...spine,
        ['s254', `max(${tips.join(', ')})`],
        ...tips.map((t): [string, string] => [t, 'abs(c) + 1 mm']),
      ]),
    );
    expect(evaluation.parameters.get('s0')?.result).toMatchObject({ ok: true, value: 2 });
  });

  it('evaluates each parameter once in a lattice where every one uses every one of the next row', () => {
    const rows = 30;
    const width = 8;
    const name = (r: number, k: number) => `r${r}_${k}`;
    const lattice: [string, string][] = [];
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < width; k++) {
        const next = Array.from({ length: width }, (_, j) => name(r + 1, j));
        lattice.push([name(r, k), r === rows - 1 ? `${k} mm` : `max(${next.join(', ')}) + 1 mm`]);
      }
    }
    const evaluation = evaluatedOnce(doc(lattice));
    expect(evaluation.parameters.get(name(0, 0))?.result).toMatchObject({
      ok: true,
      value: width - 1 + rows - 1,
    });
  });

  it('evaluates each parameter once on a chain listed from its near end', () => {
    const n = 3000;
    evaluatedOnce(
      doc(
        Array.from({ length: n }, (_, i) => [`p${i}`, i === n - 1 ? '1 mm' : `p${i + 1} + 1 mm`]),
      ),
    );
  });
});
