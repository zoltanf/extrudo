/**
 * The runner in Node (ADR-0070 §2): the same calls a script makes against a
 * document, the sandbox it runs in, every limit, and the failures that carry a
 * line.
 *
 * One thing a test cannot assert in the usual way is a leaked QuickJS handle:
 * QuickJS asserts that a runtime is empty when it is freed, so a leaked handle
 * aborts the process instead of failing a test. The last test runs a hundred
 * times and frees the runtime, which is that assertion.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Design, type ExtrudoDocument } from '@extrudo/api';
import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync';
import {
  isFail,
  newQuickJSWASMModuleFromVariant,
  type QuickJSWASMModule,
} from 'quickjs-emscripten-core';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  Bridge,
  loadScriptRunner,
  REFUSAL_RULE,
  REFUSED_METHODS,
  SCRIPT_METHODS,
  type ScriptRequest,
  type ScriptResult,
  type ScriptRunner,
} from './index';

/** The clock the API stamps into a document, so two runs can be compared. */
const NOW = '2026-10-05T12:00:00.000Z';

/** A plate of 60 × 40 mm with ten Ø4 holes in two rows, as a script writes it. */
const PLATE = `const width = 60;
const depth = 40;
const sketch = design.sketch(design.origin.xy, (k) => {
  k.rectangle([0, 0], [width, depth]);
});
design.extrude({ profiles: sketch.profileAt([1, 1]), distance: '5 mm' });
for (let i = 0; i < 10; i++) {
  design.hole({
    plane: design.origin.xy,
    x: \`\${5 + (i % 5) * 10} mm\`,
    y: \`\${i < 5 ? 10 : 30} mm\`,
    diameter: '4 mm',
    extent: 'through',
  });
}`;

/** A design to run against, with the same name the by-hand plate has. */
function emptyDesign(name = 'Plate'): Design {
  return Design.create({ name, units: 'mm', now: NOW });
}

/** The same plate, written straight against the API (ADR-0068). */
function plateByHand(): ExtrudoDocument {
  const design = emptyDesign();
  const sketch = design.sketch(design.origin.xy, (k) => {
    k.rectangle([0, 0], [60, 40]);
  });
  design.extrude({ profiles: sketch.profileAt([1, 1]), distance: '5 mm' });
  for (let i = 0; i < 10; i++) {
    design.hole({
      plane: design.origin.xy,
      x: `${5 + (i % 5) * 10} mm`,
      y: `${i < 5 ? 10 : 30} mm`,
      diameter: '4 mm',
      extent: 'through',
    });
  }
  return design.toJSON();
}

let runner: ScriptRunner;

/** Runs some source against a fresh design, with the feature ID `script-1`. */
function run(
  code: string,
  options: Partial<ScriptRequest> = {},
): { result: ScriptResult; design: Design } {
  const design = options.design ?? emptyDesign();
  const result = runner.run({ code, language: 'ts', design, featureId: 'script-1', ...options });
  return { result, design };
}

/** The failure of a run that was meant to fail, without its result's shape. */
function failure(result: ScriptResult): { message: string; line?: number; column?: number } {
  if (result.ok) throw new Error(`The script was meant to fail: ${JSON.stringify(result.added)}`);
  return result.error;
}

beforeAll(async () => {
  runner = await loadScriptRunner();
});

describe('a script is the same design as the same calls', () => {
  it('makes a plate with ten holes, byte for byte as the API alone', () => {
    const byHand = JSON.stringify(plateByHand());
    const first = run(PLATE);
    const second = run(PLATE);
    expect(first.result.ok).toBe(true);
    expect(second.result.ok).toBe(true);
    expect(JSON.stringify(first.design.toJSON())).toBe(byHand);
    expect(JSON.stringify(second.design.toJSON())).toBe(byHand);
  });

  it('reports the features it added, in order', () => {
    const { result, design } = run(PLATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.added).toHaveLength(12);
    expect(result.added).toEqual(design.doc.features.map((feature) => feature.id));
    expect(design.doc.features.map((feature) => feature.type)).toEqual([
      'sketch',
      'extrude',
      ...Array.from({ length: 10 }, () => 'hole'),
    ]);
    expect(design.doc.features.map((feature) => feature.name)).toEqual([
      'Sketch1',
      'Extrude1',
      ...Array.from({ length: 10 }, (_, index) => `Hole${index + 1}`),
    ]);
  });

  it('gives the same IDs and names every run', () => {
    const runs = [run(PLATE), run(PLATE), run(PLATE)];
    const ids = runs.map(({ design }) => JSON.stringify(design.toJSON().features));
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).toBe(ids[0]);
  });

  it('reads the document through design.features() and design.feature()', () => {
    const design = emptyDesign();
    design.box({ length: '40 mm', width: '20 mm', height: '10 mm' });
    const { result } = run(
      [
        'const [earlier] = design.features();',
        'console.log(design.features().length, earlier.name, earlier.type);',
        'design.box({ length: "10 mm", width: "10 mm", height: "10 mm" });',
        'console.log(design.feature(earlier.id).name, earlier.name);',
      ].join('\n'),
      { design },
    );
    expect(result.ok).toBe(true);
    expect(result.log).toEqual(['1 Box1 box', 'Box1 Box1']);
  });
});

describe('params', () => {
  it("reads the document's own values, in mm", () => {
    const design = emptyDesign();
    design.parameter('width', '40 mm');
    design.parameter('angle', '30 deg');
    const { result } = run(
      [
        'console.log(params.width, params.angle, params.nothing);',
        'design.box({ length: params.width, width: "10 mm", height: "5 mm" });',
      ].join('\n'),
      { design },
    );
    expect(result.ok).toBe(true);
    expect(result.log[0]).toBe('40 30 undefined');
    expect(design.doc.features[0]?.inputs).toMatchObject({
      length: { kind: 'expr', expr: '40', unit: 'length' },
    });
  });

  it('takes the values the caller passes, over the document’s own', () => {
    const design = emptyDesign();
    design.parameter('width', '40 mm');
    expect(run('console.log(params.width);', { design, params: { width: 7 } }).result.log).toEqual([
      '7',
    ]);
  });

  it('cannot be written', () => {
    const design = emptyDesign();
    design.parameter('width', '40 mm');
    const caught = run(
      [
        'let seen = -1;',
        'try {',
        '  params.width = 5;',
        '} catch (error) {',
        '  seen = params.width;',
        '}',
        'console.log(seen);',
      ].join('\n'),
      { design },
    );
    expect(caught.result.ok).toBe(true);
    expect(caught.result.log).toEqual(['40']);
    // And a write the script does not catch is a failure, not a quiet change.
    const bare = run('params.width = 5;\nconsole.log(params.width);', { design }).result;
    expect(bare.ok).toBe(false);
    expect(failure(bare).message).toMatch(/read-only|read only|frozen/i);
    expect(design.doc.parameters.map((parameter) => parameter.expression)).toEqual(['40 mm']);
  });
});

describe('what a script may not do', () => {
  it('names the rule for every refused method', () => {
    for (const name of Object.keys(REFUSED_METHODS)) {
      const { result } = run(`design.${name}();`);
      const error = failure(result);
      expect(error.message, name).toBe(
        `${REFUSAL_RULE}: design.${name}() ${REFUSED_METHODS[name]}.`,
      );
    }
  });

  it('refuses to remove a feature that is already there', () => {
    const design = emptyDesign();
    const box = design.box({ length: '40 mm', width: '20 mm', height: '10 mm' });
    const { result } = run(`design.remove('${box.id}');`, { design });
    const error = failure(result);
    expect(error.message).toBe(`${REFUSAL_RULE}: design.remove() would delete a feature.`);
    expect(error.line).toBe(1);
    expect(design.doc.features.map((feature) => feature.id)).toEqual([box.id]);
  });

  it('refuses to suppress, rename or move one too', () => {
    const design = emptyDesign();
    const box = design.box({ length: '40 mm', width: '20 mm', height: '10 mm' });
    for (const call of [
      `design.suppress('${box.id}');`,
      `design.rename('${box.id}', 'Other');`,
      `design.move('${box.id}', 0);`,
    ]) {
      expect(failure(run(call, { design }).result).message).toContain(REFUSAL_RULE);
    }
    expect(design.doc.features[0]?.name).toBe('Box1');
    expect(design.doc.features[0]?.suppressed).toBe(false);
  });

  it('has no method that is not the API’s', () => {
    expect(run('console.log(typeof design.unicorn);').result.log).toEqual(['undefined']);
    expect(failure(run('design.unicorn();').result).message).toBe('TypeError: not a function');
  });

  it('refuses a component or joint method and a component option', () => {
    expect(failure(run('design.component("Lid");').result).message).toBe(
      `${REFUSAL_RULE}: design.component() would add a component.`,
    );
    expect(failure(run('design.joint("Hinge");').result).message).toBe(
      `${REFUSAL_RULE}: design.joint() would add a joint.`,
    );
    // A `component` option would place a feature outside the Script's own.
    expect(
      failure(run('design.box({ length: "10 mm" }, { component: "Lid" });').result).message,
    ).toBe("A script's features go into the Script's own component.");
  });

  it('offers the generated feature methods, sketch and origin', () => {
    expect(SCRIPT_METHODS).toContain('box');
    expect(SCRIPT_METHODS).toContain('hole');
    expect(SCRIPT_METHODS).toContain('sketch');
    expect(SCRIPT_METHODS).toContain('add');
    expect(SCRIPT_METHODS).toContain('origin');
    expect(SCRIPT_METHODS).toContain('remove');
    expect(SCRIPT_METHODS.length).toBeGreaterThan(40);
  });
});

describe('the limits', () => {
  it('stops a loop at two seconds, with the time message', () => {
    const started = performance.now();
    const { result } = run('let n = 0;\nwhile (true) {\n  n++;\n}');
    const elapsed = performance.now() - started;
    expect(failure(result).message).toBe('The script ran longer than 2 s.');
    expect(elapsed).toBeGreaterThan(1_800);
    expect(elapsed).toBeLessThan(5_000);
  });

  it('takes the limit the caller gave for the time message', () => {
    expect(failure(run('while (true) {}', { limits: { timeMs: 250 } }).result).message).toBe(
      'The script ran longer than 0.25 s.',
    );
  });

  it('stops a big array at 64 MB, with the memory message', () => {
    const { result } = run(
      'const big = new Array(20_000_000);\nbig.fill(1);\nconsole.log(big.length);',
    );
    expect(failure(result).message).toBe('The script used more than 64 MB of memory.');
  });

  it('takes the limit the caller gave for the memory message', () => {
    const { result } = run('const big = new Array(20_000_000);\nbig.fill(1);', {
      limits: { memoryBytes: 8 * 1024 * 1024 },
    });
    expect(failure(result).message).toBe('The script used more than 8 MB of memory.');
  });

  it('stops at a thousand features, with the count message', () => {
    const { result, design } = run(
      [
        'for (let i = 0; i < 1001; i++) {',
        '  design.box({ length: "1 mm", width: "1 mm", height: "1 mm" });',
        '}',
      ].join('\n'),
      { limits: { timeMs: 120_000 } },
    );
    expect(failure(result).message).toBe('The script added more than 1,000 features.');
    expect(design.doc.features).toHaveLength(1_000);
  });

  it('takes the limit the caller gave for the feature count', () => {
    const { result, design } = run(
      'for (let i = 0; i < 4; i++) design.box({ length: "1 mm", width: "1 mm", height: "1 mm" });',
      { limits: { features: 3 } },
    );
    expect(failure(result).message).toBe('The script added more than 3 features.');
    expect(design.doc.features).toHaveLength(3);
  });

  it('keeps 200 lines of output and says where it stopped', () => {
    const { result } = run('for (let i = 0; i < 300; i++) {\n  console.log("line", i);\n}');
    expect(result.ok).toBe(true);
    expect(result.log).toHaveLength(201);
    expect(result.log[0]).toBe('line 0');
    expect(result.log[199]).toBe('line 199');
    expect(result.log[200]).toBe("The script's output stopped at 200 lines.");
  });

  it('keeps 100,000 characters of output and says where it stopped', () => {
    const { result } = run('console.log("x".repeat(60_000));\nconsole.log("y".repeat(60_000));');
    expect(result.ok).toBe(true);
    expect(result.log).toHaveLength(3);
    expect(result.log[0]).toHaveLength(60_000);
    expect(result.log[1]).toHaveLength(40_000);
    expect(result.log[1]).toBe('y'.repeat(40_000));
    expect(result.log[2]).toBe("The script's output stopped at 100,000 characters.");
    expect(result.log.slice(0, 2).join('').length).toBe(100_000);
  });

  it('refuses a source longer than the ADR’s 100,000 characters', () => {
    expect(failure(run(`// ${'x'.repeat(120_000)}\ndesign.box({});`).result).message).toBe(
      'The script is longer than 100,000 characters.',
    );
  });
});

describe('failures carry a place', () => {
  it('reports the line of a TypeScript syntax error', () => {
    const error = failure(run(['const a = 1;', 'const b = 2;', 'const c: = 3;'].join('\n')).result);
    expect(error.line).toBe(3);
    expect(error.message).toMatch(/Unexpected token/);
  });

  it('reports the line a runtime error happened on', () => {
    const error = failure(
      run(
        [
          'const a = 1;',
          'const b = 2;',
          'const c = 3;',
          'const d = 4;',
          'const e = 5;',
          'const f = 6;',
          'const nothing = undefined;',
          'nothing.toFixed(2);',
          'const g = 9;',
        ].join('\n'),
      ).result,
    );
    expect(error.line).toBe(8);
    expect(error.message).toMatch(/^TypeError: /);
  });

  it('reports the line an API call was made on, with the API’s own message', () => {
    const error = failure(
      run(
        [
          '// A hole whose diameter is not a length.',
          'const sketch = design.sketch(design.origin.xy, (k) => {',
          '  k.rectangle([0, 0], [40, 20]);',
          '});',
          'design.hole({ plane: design.origin.xy, x: "10 mm", y: "10 mm", deep: true });',
        ].join('\n'),
      ).result,
    );
    expect(error.line).toBe(5);
    expect(error.message).toContain('Hole');
    expect(error.message).toContain('deep');
  });

  it('reports the line inside a sketch callback', () => {
    const { result } = run(
      [
        'const sketch = design.sketch(design.origin.xy, (k) => {',
        '  const plate = k.rectangle([0, 0], [40, 20]);',
        '  k.dimension(plate.bottom, "40 mm", { name: "width" });',
        '  k.polyline([[0, 0]]);',
        '});',
      ].join('\n'),
    );
    const error = failure(result);
    // QuickJS gives the position of the call the host threw from (the line its
    // closing bracket is on), and the line inside the callback goes in the
    // message, which is the one a user can act on.
    expect(error.message).toContain('at least two points');
    expect(error.message).toContain('line 4');
  });

  it('keeps what it logged before it failed', () => {
    const { result } = run('console.log("before");\nundefined.x;');
    expect(failure(result).line).toBe(2);
    expect(result.log).toEqual(['before']);
  });
});

describe('the sandbox has nothing else', () => {
  it('has no fetch, no timers and no require', () => {
    const { result } = run(
      [
        'const names = ["fetch", "setTimeout", "setInterval", "require", "process", "window",',
        '  "document", "XMLHttpRequest", "WebAssembly", "importScripts", "eval"];',
        'const describe = (name) => name + "=" + typeof globalThis[name];',
        'console.log(names.map(describe).join(" "));',
      ].join('\n'),
    );
    expect(result.ok).toBe(true);
    expect(result.log[0]).toBe(
      'fetch=undefined setTimeout=undefined setInterval=undefined require=undefined ' +
        'process=undefined window=undefined document=undefined XMLHttpRequest=undefined ' +
        'WebAssembly=undefined importScripts=undefined eval=function',
    );
  });

  it('cannot load a module', () => {
    const async =
      'The script runs on its own, with nothing to wait for: it cannot use import() or await.';
    expect(failure(run('const loaded = import("./other.js");').result).message).toBe(async);
    expect(failure(run('import("./other.js");').result).message).toBe(async);
    expect(failure(run('Promise.resolve(1);').result).message).toBe(async);
  });

  it('has no DOM, even in the sketch builder', () => {
    const { result } = run(
      [
        'const sketch = design.sketch(design.origin.xy, (k) => {',
        '  k.rectangle([0, 0], [10, 10]);',
        '  k.dimension(k.line([0, 0], [10, 0]), "10 mm");',
        '});',
        'console.log(sketch.profiles().length);',
      ].join('\n'),
    );
    expect(result.ok).toBe(true);
    expect(result.log).toEqual(['1']);
  });
});

describe('the environment is fixed', () => {
  it('seeds Math.random from the feature ID', () => {
    const code = 'console.log(Math.random(), Math.random(), Math.random());';
    const first = run(code, { featureId: 'script-1' }).result.log;
    const again = run(code, { featureId: 'script-1' }).result.log;
    const other = run(code, { featureId: 'script-2' }).result.log;
    expect(first).toEqual(again);
    expect(first[0]).not.toBe(other[0]);
    const numbers = first[0]?.split(' ').map(Number) ?? [];
    expect(numbers).toHaveLength(3);
    for (const value of numbers) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('freezes Date at 0', () => {
    expect(
      run(
        'console.log(Date.now(), new Date().getTime(), new Date(2026, 0, 1).valueOf(), Date.UTC(2026, 0, 1));',
      ).result.log,
    ).toEqual(['0 0 0 0']);
  });

  it('logs what console.log was given, as text', () => {
    const { result } = run(
      [
        'console.log("a string", 42, true, null, undefined);',
        'console.log([1, 2, { a: 3 }]);',
        'console.log(design.box({ length: "1 mm", width: "1 mm", height: "1 mm" }));',
        'console.warn("warned");',
        'console.error("failed");',
      ].join('\n'),
    );
    expect(result.log).toEqual([
      'a string 42 true null undefined',
      '[1,2,{"a":3}]',
      '[Box1]',
      'warned',
      'failed',
    ]);
  });
});

describe('handles, and what a script may do with them', () => {
  it('builds a sketch and extrudes one of its profiles', () => {
    const { result, design } = run(
      [
        'const sketch = design.sketch(design.origin.xy, (k) => {',
        '  const plate = k.rectangle([0, 0], [40, 20]);',
        '  k.circle([10, 10], "3 mm");',
        '  k.dimension(plate.bottom, "40 mm", { name: "width" });',
        '  console.log(plate.edges.length, plate.corners[0].at(), k.sketch.lines().length);',
        '});',
        'const solid = design.extrude({ profiles: sketch.profileAt([30, 10]), distance: "5 mm" });',
        'console.log(solid.name, JSON.stringify(solid.face("cap:end")));',
      ].join('\n'),
    );
    expect(result.ok).toBe(true);
    expect(result.log[0]).toBe('4 [0,0] 4');
    expect(result.log[1]).toBe('Extrude1 {"kind":"face","id":"extrude:f2:cap:end"}');
    expect(design.doc.features.at(-1)?.type).toBe('extrude');
  });

  it('passes a handle of its own back into a call', () => {
    const { result, design } = run(
      [
        'const plate = design.box({ length: "40 mm", width: "20 mm", height: "10 mm" });',
        'const shaft = design.cylinder({ diameter: "8 mm", height: "20 mm" });',
        'design.combine({ target: plate.body(), tools: [shaft.body()], operation: "join" });',
      ].join('\n'),
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(design.doc.features.at(-1)?.type).toBe('combine');
    expect(result.added).toHaveLength(3);
  });

  it('reads the document it was given', () => {
    const design = emptyDesign();
    design.box({ length: '40 mm', width: '20 mm', height: '10 mm' });
    const { result } = run(
      [
        'const [earlier] = design.features();',
        'console.log(design.features().length, earlier.name, earlier.type);',
        'console.log(design.feature(earlier.id).id, design.validate().length);',
        'design.box({ length: "5 mm", width: "5 mm", height: "5 mm" });',
        'console.log(design.features().length);',
      ].join('\n'),
      { design },
    );
    expect(result.log).toEqual(['1 Box1 box', 'f1 0', '2']);
  });
});

describe('QuickJS itself', () => {
  it('loads once, and the runner is cheap to make again', async () => {
    const first = await loadScriptRunner();
    const second = await loadScriptRunner();
    expect(first).not.toBe(second);
    expect(run('console.log(1);').result.log).toEqual(['1']);
  });

  it('loads from a URL when the caller gives one', async () => {
    // What the browser does: Emscripten's `locateFile` answers with our own asset
    // URL for the WASM file (ADR-0070 §2). The file is the one quickjs-emscripten
    // would have loaded itself, found through its own entry point, since the
    // WebAssembly file belongs to the variant package.
    const require = createRequire(import.meta.url);
    const url = pathToFileURL(require.resolve('@jitl/quickjs-wasmfile-release-sync/wasm')).href;
    const fromUrl = await loadScriptRunner({ wasmUrl: url });
    const result = fromUrl.run({
      code: 'design.box({ length: "10 mm", width: "10 mm", height: "10 mm" });',
      language: 'ts',
      design: emptyDesign('From a URL'),
      featureId: 'script-1',
    });
    expect(result.ok).toBe(true);
  });

  it('leaks no handle over a hundred runs', async () => {
    const wasm: QuickJSWASMModule = await newQuickJSWASMModuleFromVariant(RELEASE_SYNC);
    const runtime = wasm.newRuntime();
    const ctx = runtime.newContext();
    // QuickJS counts what it has allocated; a handle of ours that is still alive
    // keeps its objects, so the count is what a leak shows up in.
    const used = (): number => {
      const handle = runtime.computeMemoryUsage();
      try {
        return (ctx.dump(handle) as { malloc_count: number; obj_count: number }).malloc_count;
      } finally {
        handle.dispose();
      }
    };
    const once = (code: string) => {
      const bridge = new Bridge(ctx, 'script.ts');
      try {
        bridge.set(ctx.global, 'params', bridge.toValue({ width: 40 }));
        const result = ctx.evalCode(code, 'script.ts', { type: 'global', strict: true });
        if (isFail(result)) result.error.dispose();
        else result.value.dispose();
      } finally {
        bridge.dispose();
      }
    };
    once('const x = [1, 2, 3].map((n) => n * 2);\nconsole.log(x.length);');
    const after = used();
    for (let run = 0; run < 100; run++) {
      once('const x = { a: [1, 2, 3], b: { c: 4 } };\nconsole.log(x.b.c);');
    }
    expect(used() - after).toBeLessThan(64 * 1024);
    // Freeing the runtime with a handle of ours still alive aborts here.
    ctx.dispose();
    runtime.dispose();
  });
});
