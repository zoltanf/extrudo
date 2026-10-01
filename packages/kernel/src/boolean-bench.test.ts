// P3-13 (NFR-01, ADR-0047's slow case): ways to cut many interfering tools
// from a body without a facade change, timed on the case that took 7.9 s: a
// 10 × 10 grid of 6 mm holes at 5 mm pitch through a 120 mm plate.
// Measurement only: `BENCH=1 pnpm vitest run packages/kernel/src/boolean-bench.test.ts`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type ShapeHandle } from './kernel';
import { loadOcct } from './occt/load';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;

let kernel: Kernel;
beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});
afterAll(() => kernel?.dispose());

/** The plate and its 100 hole cylinders (grid position i, j), fresh each call. */
function parts() {
  const plate = kernel.box([120, 120, 10]);
  const holes: { i: number; j: number; shape: ShapeHandle }[] = [];
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 10; j++) {
      holes.push({ i, j, shape: kernel.cylinder(3, 10, [10 + 5 * i, 10 + 5 * j, 0]) });
    }
  }
  return { plate, holes };
}

/** Fuses shapes pairwise, halves first (what the pattern's `mergeTools` does per group). */
function treeFuse(shapes: ShapeHandle[]): ShapeHandle {
  let level = shapes;
  while (level.length > 1) {
    const next: ShapeHandle[] = [];
    for (let k = 0; k < level.length; k += 2) {
      const [a, b] = [level[k] as ShapeHandle, level[k + 1]];
      if (b === undefined) next.push(a);
      else {
        next.push(kernel.fuse(a, b, { simplify: true }).shape);
        kernel.release(a, b);
      }
    }
    level = next;
  }
  return level[0] as ShapeHandle;
}

const time = <T>(run: () => T): [T, number] => {
  const start = performance.now();
  const out = run();
  return [out, Math.round(performance.now() - start)];
};

describe.runIf(env?.BENCH)('many interfering tools', () => {
  it('tree fuse then one cut, against one cut per colour class', { timeout: 600_000 }, () => {
    const report: Record<string, unknown> = {};

    const a = parts();
    const [treeResult, tree] = time(() => {
      const tool = treeFuse(a.holes.map((h) => h.shape));
      const cut = kernel.cut(a.plate, tool, { simplify: true }).shape;
      kernel.release(tool);
      return cut;
    });
    report.tree = { ms: tree, ...kernel.measure(treeResult), valid: kernel.isValid(treeResult) };

    // Colour the interference graph: here instances two steps apart never meet
    // (10 mm apart, 6 mm across), so (i mod 2, j mod 2) is a colouring with 4
    // classes. Each class is a compound of tools that don't interfere: a
    // valid boolean argument, one cut each.
    const b = parts();
    const [colourResult, colour] = time(() => {
      let body = b.plate;
      for (const [di, dj] of [
        [0, 0],
        [0, 1],
        [1, 0],
        [1, 1],
      ]) {
        const members = b.holes.filter((h) => h.i % 2 === di && h.j % 2 === dj).map((h) => h.shape);
        const tool = kernel.compound(members);
        const cut = kernel.cut(body, tool, { simplify: true }).shape;
        kernel.release(body, tool, ...members);
        body = cut;
      }
      return body;
    });
    report.colour = {
      ms: colour,
      ...kernel.measure(colourResult),
      valid: kernel.isValid(colourResult),
    };
    kernel.release(treeResult, colourResult);
    expect.soft(report).toBeUndefined();
  });
});
