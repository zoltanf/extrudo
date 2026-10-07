/**
 * A plugin's handlers in the sandbox (P6-03, ADR-0077 §2): the module
 * evaluated afresh with its `export`s read back, the handler called with the
 * restricted design and frozen inputs and context, refusals worded for plugins,
 * a missing handler named, and lines that are the module's.
 */
import { Design, type ExtrudoDocument, type FeatureId } from '@extrudo/api';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  loadScriptRunner,
  PLUGIN_IN_SCRIPT,
  PLUGIN_REFUSAL_RULE,
  type PluginRequest,
  runPlugin,
  type ScriptResult,
  type ScriptRunner,
  scriptHost,
} from './index';

const NOW = '2026-10-07T12:00:00.000Z';

/** A module with a command and a feature, in TypeScript. */
const MODULE = `type Inputs = { width: number; rounded: boolean; plane: unknown };
export const commands = {
  'two-boxes': (design: any, ctx: any) => {
    design.box({ length: '10 mm', width: '10 mm', height: '10 mm' });
    design.box({ length: '5 mm', width: '5 mm', height: \`\${ctx.params.tall ?? 5} mm\` });
  },
};
export const features = {
  plate: (design: any, inputs: Inputs, ctx: any) => {
    console.log('width', inputs.width, Object.isFrozen(inputs), Object.isFrozen(ctx));
    design.box({ plane: inputs.plane, length: \`\${inputs.width} mm\`, width: '20 mm', height: '2 mm' });
  },
  broken: () => {
    const x = null as any;
    return x.y;
  },
  remover: (design: any) => design.remove('f1'),
  nested: (design: any) => design.add('plugin', {}),
  sneaky: (_design: any, inputs: any) => { inputs.width = 1; },
  later: async (design: any) => { design.box({}); },
  sees: (_design: any, _inputs: any, ctx: any) => { console.log(JSON.stringify(ctx.selection)); },
  spin: () => { while (true) {} },
  hog: () => { const big = new Array(20_000_000); big.fill(1); },
  many: (design: any) => {
    for (let i = 0; i < 1001; i++) design.box({ length: '1 mm', width: '1 mm', height: '1 mm' });
  },
  nothing: () => { throw null; },
  empty: () => { throw {}; },
  text: () => { throw 'x'; },
  swapDate: () => { (globalThis as any).Date = class {}; },
  swapRandom: () => { Math.random = () => 4; },
};
`;

let runner: ScriptRunner;
beforeAll(async () => {
  runner = await loadScriptRunner();
});

function design(): Design {
  return Design.create({ name: 'Plugins', units: 'mm', now: NOW });
}

function call(over: Partial<PluginRequest> & Pick<PluginRequest, 'handler'>): ScriptResult {
  return runner.runPlugin({
    code: MODULE,
    language: 'ts',
    design: design(),
    featureId: 'p1',
    ...over,
  });
}

describe('ScriptRunner.runPlugin', () => {
  it('calls a command with the design and ctx.params, and gives back what it added', () => {
    const d = design();
    const result = call({
      handler: { kind: 'command', name: 'two-boxes' },
      design: d,
      params: { tall: 8 },
    });
    expect(result.ok).toBe(true);
    expect(d.doc.features.map((f) => f.type)).toEqual(['box', 'box']);
    expect(d.doc.features[1]?.inputs.height).toMatchObject({ expr: '8 mm' });
  });

  it('calls a feature with its inputs, frozen, and prints what it logs', () => {
    const d = design();
    const result = call({
      handler: { kind: 'feature', name: 'plate' },
      design: d,
      inputs: { width: 60, rounded: true, plane: { kind: 'plane', id: 'origin:xy' } },
    });
    expect(result).toMatchObject({ ok: true, log: ['width 60 true true'] });
    expect(d.doc.features[0]?.inputs.length).toMatchObject({ expr: '60 mm' });
    const changed = call({ handler: { kind: 'feature', name: 'sneaky' }, inputs: { width: 3 } });
    expect(changed.ok).toBe(false);
  });

  it('names a handler the module does not export', () => {
    const result = call({ handler: { kind: 'feature', name: 'name-plate' } });
    expect(result).toMatchObject({
      ok: false,
      error: { message: "main.ts exports no `features['name-plate']`." },
    });
    const js = runner.runPlugin({
      code: 'export const features = {};',
      language: 'js',
      handler: { kind: 'command', name: 'x' },
      design: design(),
      featureId: 'p1',
    });
    expect(js).toMatchObject({
      ok: false,
      error: { message: "main.js exports no `commands['x']`." },
    });
  });

  it("words a refusal as a plugin's, refuses a plugin feature inside, and keeps the module's lines", () => {
    expect(call({ handler: { kind: 'feature', name: 'remover' } })).toMatchObject({
      ok: false,
      error: { message: `${PLUGIN_REFUSAL_RULE}: design.remove() would delete a feature.` },
    });
    expect(call({ handler: { kind: 'feature', name: 'nested' } })).toMatchObject({
      ok: false,
      error: { message: PLUGIN_IN_SCRIPT },
    });
    const broken = call({ handler: { kind: 'feature', name: 'broken' } });
    expect(broken).toMatchObject({ ok: false, error: { line: 15 } });
    expect(call({ handler: { kind: 'feature', name: 'later' } })).toMatchObject({
      ok: false,
      error: { message: expect.stringMatching(/cannot use import\(\) or await/) },
    });
  });

  it('gives the module no global design or params, and no require for an import', () => {
    const globals = runner.runPlugin({
      code: `export const commands = { look: () => { console.log(typeof design, typeof params); } };`,
      language: 'js',
      handler: { kind: 'command', name: 'look' },
      design: design(),
      featureId: 'p1',
    });
    expect(globals).toMatchObject({ ok: true, log: ['undefined undefined'] });
    const imported = runner.runPlugin({
      code: `import { box } from 'elsewhere';\nexport const commands = { look: () => box() };`,
      language: 'js',
      handler: { kind: 'command', name: 'look' },
      design: design(),
      featureId: 'p1',
    });
    expect(imported).toMatchObject({
      ok: false,
      error: { message: expect.stringMatching(/require/), line: 1 },
    });
  });

  it('makes IDs and names behind the feature, through the host', () => {
    const doc: ExtrudoDocument = design().toJSON();
    const result = runPlugin(runner, {
      code: MODULE,
      language: 'ts',
      handler: { kind: 'command', name: 'two-boxes' },
      doc,
      featureId: 'pf' as FeatureId,
      featureName: 'Name plate1',
      params: {},
    });
    expect(result.ok && result.features.map((f) => [f.id, f.name])).toEqual([
      ['pf.f1', 'Name plate1 › Box1'],
      ['pf.f2', 'Name plate1 › Box2'],
    ]);
    expect(typeof scriptHost(runner).runPlugin).toBe('function');
  });

  it('frees every handle, run after run', () => {
    for (let i = 0; i < 50; i++) {
      call({
        handler: { kind: 'feature', name: i % 2 ? 'plate' : 'broken' },
        inputs: { width: i },
      });
    }
  });

  it('hands a command the selection in ctx', () => {
    const selection = [{ kind: 'body', id: 'f1:0' }];
    const result = call({
      handler: { kind: 'feature', name: 'sees' },
      selection,
    });
    expect(result).toMatchObject({ ok: true, log: [JSON.stringify(selection)] });
  });

  it('holds a plugin to the two second, 64 MB and 1,000 feature limits', () => {
    const started = performance.now();
    const loop = call({ handler: { kind: 'feature', name: 'spin' }, limits: { timeMs: 2_000 } });
    expect(loop).toMatchObject({
      ok: false,
      error: { message: 'The script ran longer than 2 s.' },
    });
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(call({ handler: { kind: 'feature', name: 'hog' } })).toMatchObject({
      ok: false,
      error: { message: 'The script used more than 64 MB of memory.' },
    });
    const d = design();
    expect(
      call({ handler: { kind: 'feature', name: 'many' }, design: d, limits: { timeMs: 120_000 } }),
    ).toMatchObject({
      ok: false,
      error: { message: 'The script added more than 1,000 features.' },
    });
    expect(d.doc.features).toHaveLength(1_000);
  });

  it('gives a message, never a crash, for throw null, throw {} and throw "x"', () => {
    for (const name of ['nothing', 'empty', 'text']) {
      const result = call({ handler: { kind: 'feature', name } });
      expect(result.ok, name).toBe(false);
      if (!result.ok) expect(result.error.message.length, name).toBeGreaterThan(0);
    }
  });

  it('refuses a module that replaces Date or Math.random', () => {
    for (const name of ['swapDate', 'swapRandom']) {
      expect(call({ handler: { kind: 'feature', name } }), name).toMatchObject({
        ok: false,
        error: { message: "A plugin can't replace Date or Math.random." },
      });
    }
  });
});
