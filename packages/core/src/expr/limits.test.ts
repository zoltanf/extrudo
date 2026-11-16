import { describe, expect, it } from 'vitest';
import { createDocument } from '../document';
import type { ExtrudoDocument, Parameter } from '../schema';
import { pid } from '../testing';
import { ExprError } from './errors';
import { type EvaluateResult, evaluateExpression } from './evaluate';
import { evaluateParameters, MAX_PARAMETER_DEPTH } from './parameters';
import { MAX_CALL_ARGUMENTS, MAX_DEPTH, MAX_EXPRESSION_LENGTH, parse } from './parser';

const DEEP = `Nested more than ${MAX_PARAMETER_DEPTH} levels deep through the parameters it uses.`;

function doc(expressions: string[]): ExtrudoDocument {
  const parameters: Parameter[] = expressions.map((expression, i) => ({
    id: pid(`id-${i}`),
    name: `p${i}`,
    expression,
    unit: 'length',
  }));
  return { ...createDocument({ now: '2026-11-15T10:00:00.000Z' }), parameters };
}

/** `p0 = p1 + 1 mm`, `p1 = p2 + 1 mm`, … `p(n-1) = 1 mm`: each refers to the next one in the list. */
function chain(n: number, wrap = (ref: string) => `${ref} + 1 mm`): string[] {
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? '1 mm' : wrap(`p${i + 1}`)));
}

/** Every result in list order. Evaluation itself never throws, and every error is an expression error. */
function results(d: ExtrudoDocument): EvaluateResult[] {
  const evaluation = evaluateParameters(d);
  const all = d.parameters.map((p) => evaluation.parameters.get(p.name)?.result as EvaluateResult);
  for (const result of all) if (!result.ok) expect(result.error).toBeInstanceOf(ExprError);
  return all;
}

const message = (r: EvaluateResult | undefined) => (r && !r.ok ? r.error.message : 'ok');

describe('expression limits: length', () => {
  it('reads an expression of the longest length and refuses a longer one', () => {
    const longest = `1${' '.repeat(MAX_EXPRESSION_LENGTH - 1)}`;
    expect(evaluateExpression(longest)).toMatchObject({ ok: true, value: 1 });
    const result = evaluateExpression(`${longest} `);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe(
      `Longer than ${MAX_EXPRESSION_LENGTH} characters: split it into parameters.`,
    );
    expect(result.error.code).toBe('limit');
    expect(result.error.span).toEqual({
      start: MAX_EXPRESSION_LENGTH,
      end: MAX_EXPRESSION_LENGTH + 1,
    });
  });

  it('refuses a very long expression without reading it', () => {
    const source = `${'1 + '.repeat(250_000)}1`;
    const t = Date.now();
    expect(() => parse(source)).toThrow(`Longer than ${MAX_EXPRESSION_LENGTH} characters`);
    expect(Date.now() - t).toBeLessThan(50);
  });
});

describe('expression limits: values per call', () => {
  const call = (count: number) => `min(${Array(count).fill('1 mm').join(', ')})`;

  it('reads a call with the most values and refuses one more', () => {
    expect(evaluateExpression(call(MAX_CALL_ARGUMENTS))).toMatchObject({ ok: true, value: 1 });
    const result = evaluateExpression(call(MAX_CALL_ARGUMENTS + 1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe(`\`min\` takes at most ${MAX_CALL_ARGUMENTS} values.`);
    expect(result.error.code).toBe('limit');
    expect(result.error.span).toEqual({ start: 0, end: 3 });
  });

  it('refuses a call with very many values with an expression error everywhere', () => {
    for (const count of [MAX_CALL_ARGUMENTS + 1, 200_000]) {
      const source = call(count);
      expect(() => parse(source)).toThrow(ExprError);
      expect(evaluateExpression(source).ok).toBe(false);
      const [result] = results(doc([source]));
      expect(result?.ok).toBe(false);
    }
  });

  it('refuses many long expressions before reading them', () => {
    // Each is far past the length limit: refused before it is read.
    const d = doc(Array(20).fill(`min(${Array(60_000).fill('1 mm').join(',')})`));
    const t = Date.now();
    const all = results(d);
    expect(Date.now() - t).toBeLessThan(500);
    expect(all.every((r) => !r.ok)).toBe(true);
  });
});

describe('expression limits: depth through parameters', () => {
  it('reads a chain of the deepest kind and refuses one deeper, whichever way round the list is', () => {
    // `pk = p(k+1)` nests one level each: the first of n is n levels deep.
    const bare = (n: number) => chain(n, (ref) => ref);
    const reversed = (expressions: string[]) => {
      const n = expressions.length;
      return expressions
        .reverse()
        .map((e) => e.replace(/p(\d+)/, (_, k) => `p${n - 1 - Number(k)}`));
    };
    const atLimit = results(doc(bare(MAX_PARAMETER_DEPTH)));
    expect(atLimit.every((r) => r.ok)).toBe(true);
    expect(results(doc(reversed(bare(MAX_PARAMETER_DEPTH)))).every((r) => r.ok)).toBe(true);

    const past = results(doc(bare(MAX_PARAMETER_DEPTH + 1)));
    expect(message(past[0])).toBe(DEEP);
    expect(past.slice(1).every((r) => r.ok)).toBe(true);
    const pastReversed = results(doc(reversed(bare(MAX_PARAMETER_DEPTH + 1))));
    expect(message(pastReversed.at(-1))).toBe(DEEP);
    expect(pastReversed.slice(0, -1).every((r) => r.ok)).toBe(true);
  });

  it('evaluates a long chain inside the limit, whichever way round the list is', () => {
    const n = 3000;
    const values = Array.from({ length: n }, (_, i) => n - i);
    const forward = results(doc(chain(n)));
    expect(forward.map((r) => r.ok && r.value)).toEqual(values);
    const backward = results(
      doc(
        chain(n)
          .reverse()
          .map((e) => e.replace(/p(\d+)/, (_, k) => `p${n - 1 - Number(k)}`)),
      ),
    );
    expect(backward.map((r) => r.ok && r.value)).toEqual([...values].reverse());
  });

  it('ends a chain of any length in an expression error', () => {
    // `pk = p(k+1) + 1 mm` nests two levels each.
    const within = MAX_PARAMETER_DEPTH / 2;
    for (const n of [within + 100, 30_000]) {
      const t = Date.now();
      const all = results(doc(chain(n)));
      expect(Date.now() - t).toBeLessThan(n / 2);
      // The far end of the chain keeps its values; the first one past the
      // limit says so, and those that use it have an error from it.
      expect(all.slice(n - within).map((r) => r.ok && r.value)).toEqual(
        Array.from({ length: within }, (_, i) => within - i),
      );
      expect(message(all[n - within - 1])).toBe(DEEP);
      expect(message(all[n - within - 2])).toBe(`Uses \`p${n - within - 1}\`, which has an error.`);
      expect(all.slice(0, n - within).every((r) => !r.ok)).toBe(true);
    }
  });

  it('counts the nesting inside each parameter of a chain', () => {
    // `abs(…abs(pk)…) + 1 mm` with 64 calls nests 66 levels; `1 mm` one.
    const nested = (ref: string) => `${'abs('.repeat(64)}${ref}${')'.repeat(64)} + 1 mm`;
    const all = results(doc(chain(200, nested)));
    const within = Math.floor((MAX_PARAMETER_DEPTH - 1) / 66) + 1;
    expect(all.filter((r) => r.ok)).toHaveLength(within);
    expect(all.slice(-within).every((r) => r.ok)).toBe(true);
  });

  it('evaluates through a chain at the limit from an expression nested as deep as can be', () => {
    const evaluation = evaluateParameters(doc(chain(MAX_PARAMETER_DEPTH / 2)));
    expect(evaluation.parameters.get('p0')?.result).toMatchObject({ ok: true });
    const deep = `${'abs('.repeat(MAX_DEPTH - 1)}p0${')'.repeat(MAX_DEPTH - 1)}`;
    expect(evaluation.evaluate(deep)).toMatchObject({ ok: true, value: MAX_PARAMETER_DEPTH / 2 });
    // The far end, nested as deep as can be, is read at the bottom of a full stack.
    const far = chain(MAX_PARAMETER_DEPTH, (ref) => ref);
    far[far.length - 1] = `${'abs('.repeat(MAX_DEPTH - 1)}1 mm${')'.repeat(MAX_DEPTH - 1)}`;
    const all = results(doc(far));
    expect(all.at(-1)).toMatchObject({ ok: true, value: 1 });
    expect(all.filter((r) => r.ok)).toHaveLength(MAX_PARAMETER_DEPTH - MAX_DEPTH + 1);
  });

  it('keeps the cycle message for a cycle, and counts the members of a long one', () => {
    const short = results(doc(['p1 + 1 mm', 'p2', 'p0']));
    expect(message(short[0])).toBe('`p0` refers to itself: p0 → p1 → p2 → p0.');
    for (const n of [3000, 20_000]) {
      const ring = chain(n);
      ring[n - 1] = 'p0';
      const t = Date.now();
      const all = results(doc(ring));
      expect(Date.now() - t).toBeLessThan(n / 2);
      expect(all.map(message)).toEqual(
        Array.from({ length: n }, (_, i) => `\`p${i}\` refers to itself through ${n} parameters.`),
      );
      const evaluation = evaluateParameters(doc(ring));
      expect(
        [...evaluation.parameters.values()].every(
          (p) => !p.result.ok && p.result.error.code === 'cycle',
        ),
      ).toBe(true);
    }
  });
});

describe('cycle messages', () => {
  const named = (names: string[], next = (i: number) => names[(i + 1) % names.length] as string) =>
    doc(names.map((_, i) => next(i))).parameters.map((p, i) => ({
      ...p,
      name: names[i] as string,
    }));

  it('lists the path of a short cycle, however tall its expressions', () => {
    // Three members, each nested 200 levels around the next.
    const names = ['a', 'b', 'c'];
    const tall = (ref: string) => `${'abs('.repeat(200)}${ref}${')'.repeat(200)}`;
    const d = { ...doc([]), parameters: named(names, (i) => tall(names[(i + 1) % 3] as string)) };
    expect(results(d).map(message)).toEqual([
      '`a` refers to itself: a → b → c → a.',
      '`b` refers to itself: b → c → a → b.',
      '`c` refers to itself: c → a → b → c.',
    ]);
  });

  it('follows no reference past an error in the same expression, as the walk always has', () => {
    // `y` closes a cycle through `x`, but `x` fails before it reaches `y`.
    const d = {
      ...doc([]),
      parameters: named(['x', 'y'], (i) => (i === 0 ? '1 mm + 1 deg + y' : 'x')),
    };
    expect(results(d).map(message)).toEqual([
      "Can't add a length and an angle.",
      'Uses `x`, which has an error.',
    ]);
  });

  it('lists the path of up to 20 members and counts a longer cycle', () => {
    const cycle = (n: number) => Array.from({ length: n }, (_, i) => `q${i}`);
    const twenty = results({ ...doc([]), parameters: named(cycle(20)) });
    expect(message(twenty[0])).toBe(
      `\`q0\` refers to itself: ${[...cycle(20), 'q0'].join(' → ')}.`,
    );
    const more = results({ ...doc([]), parameters: named(cycle(21)) });
    expect(message(more[0])).toBe('`q0` refers to itself through 21 parameters.');
  });

  it('counts the members of a cycle of long names, in text linear in its size', () => {
    const names = Array.from({ length: 300 }, (_, i) => `${'n'.repeat(9000)}${i}`);
    const all = results({ ...doc([]), parameters: named(names) });
    const text = all.reduce((n, r) => n + message(r).length, 0);
    expect(text).toBeLessThan(300 * 9100);
    expect(message(all[0])).toBe(`\`${names[0]}\` refers to itself through 300 parameters.`);
    // Two long names: the path would pass 500 characters.
    const two = results({ ...doc([]), parameters: named(names.slice(0, 2)) });
    expect(message(two[0])).toBe(`\`${names[0]}\` refers to itself through 2 parameters.`);
  });
});

describe('did you mean', () => {
  it('suggests the same names as before', () => {
    const d = doc(['wdith + 1 mm', '2 mm', 'hieght', 'lenght * 2', 'qqqq']);
    d.parameters[1] = { ...(d.parameters[1] as Parameter), name: 'width' };
    d.parameters[2] = { ...(d.parameters[2] as Parameter), name: 'height' };
    d.parameters.push({ ...(d.parameters[1] as Parameter), id: pid('id-l'), name: 'length' });
    expect(results(d).map(message)).toEqual([
      'Unknown name `wdith`. Did you mean `width`?',
      'ok',
      'Unknown name `hieght`. Did you mean `height`?',
      // Two edits from both: the first in the list, as before.
      'Unknown name `lenght`. Did you mean `height`?',
      'Unknown name `qqqq`.',
      'ok',
    ]);
  });

  it('suggests again in each evaluate() call of one evaluation', () => {
    const d = doc(Array(300).fill('1 mm'));
    d.parameters = d.parameters.map((p, i) => ({ ...p, name: `width${i}` }));
    const evaluation = evaluateParameters(d);
    for (let k = 0; k < 2000; k++) {
      const r = evaluation.evaluate('widht0 + 1 mm');
      expect(message(r)).toBe('Unknown name `widht0`. Did you mean `width0`?');
    }
  });

  it('stops suggesting once a budget of work is spent, in many unknown names', () => {
    const n = 4000;
    const names = Array.from({ length: n }, (_, i) => `xxxxxxxx${i}`);
    const d = doc(names.map((name) => `q${name} + 1 mm`));
    d.parameters = d.parameters.map((p, i) => ({ ...p, name: names[i] as string }));
    const t = Date.now();
    const all = results(d);
    expect(Date.now() - t).toBeLessThan(2000);
    expect(message(all[0])).toBe('Unknown name `qxxxxxxxx0`. Did you mean `xxxxxxxx0`?');
    const suggested = all.filter((r) => message(r).includes('Did you mean')).length;
    expect(suggested).toBeGreaterThan(100);
    expect(suggested).toBeLessThan(n);
  });
});
