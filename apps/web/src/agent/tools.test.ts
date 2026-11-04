import { Design } from '@extrudo/api';
import {
  type AnnotationId,
  addAnnotation,
  type BodyId,
  type ExtrudoDocument,
  type GeomFingerprint,
  type GeomRef,
  renameFeature,
  type SketchData,
} from '@extrudo/core';
import type { ProjectSummary } from '@extrudo/storage';
import { describe, expect, it } from 'vitest';
import type { AgentReply } from '../platform/agent';
import type { SnapshotOptions } from '../viewport/snapshotView';
import type { AgentHost } from './host';
import { TOOL_NAMES, toolDefinitions } from './schemas';
import { fakeContext, fakeHost } from './testing';
import {
  type AgentContext,
  BUSY,
  createPacer,
  expandShorthands,
  NO_DESIGN,
  NOT_FOR_AGENTS,
  plainInput,
  resolveBodyRefs,
  runTool,
} from './tools';

function plate(): ExtrudoDocument {
  const d = Design.create({ name: 'Plate' });
  d.parameter('thickness', '5 mm');
  const sketch = d.sketch(d.origin.xy, (k) => {
    k.rectangle([0, 0], [40, 20]);
  });
  d.extrude({ profiles: sketch.profileAt([10, 10]), distance: 'thickness' });
  return d.toJSON();
}

const plateHost = (doc = plate()) => fakeHost(doc, 'p1');

const designs: ProjectSummary[] = [
  {
    id: 'p1',
    name: 'Plate',
    created: 0,
    modified: 0,
    hasThumbnail: false,
  } as unknown as ProjectSummary,
  {
    id: 'p2',
    name: 'Old',
    created: 0,
    modified: 0,
    hasThumbnail: false,
    trashed: true,
  } as unknown as ProjectSummary,
];

function context(host: AgentHost | undefined, extra: Partial<AgentContext> = {}) {
  return fakeContext(host, designs, extra);
}

const textOf = (reply: AgentReply) => (reply.result.content[0] as { text: string }).text;
const jsonOf = (reply: AgentReply) => JSON.parse(textOf(reply));

describe('the agent tools (ADR-0087 §5)', () => {
  it('lists every tool with an object schema', () => {
    const tools = toolDefinitions();
    expect(tools.map((t) => t.name)).toEqual(TOOL_NAMES);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.name).toMatch(/^[a-z][a-z_]*$/);
    }
    const add = tools.find((t) => t.name === 'add_feature');
    expect(add?.inputSchema.required).toEqual(['type']);
  });

  it('answers a change with no design open as a tool error', async () => {
    const reply = await runTool(
      'set_parameter',
      { name: 'w', expression: '1 mm' },
      context(undefined),
    );
    expect(reply.result).toEqual({ content: [{ type: 'text', text: NO_DESIGN }], isError: true });
    expect((await runTool('get_design', {}, context(undefined))).result.isError).toBe(true);
  });

  it('answers a bad input with its path', async () => {
    const { host } = plateHost();
    const reply = await runTool('set_parameter', { name: 'w' }, context(host));
    expect(reply.result.isError).toBe(true);
    expect(textOf(reply)).toMatch(/^expression: /);
    expect((await runTool('nope', {}, context(host))).result.isError).toBe(true);
  });

  it('lists the designs, leaving out the trashed ones', async () => {
    const { host } = plateHost();
    expect(jsonOf(await runTool('list_designs', {}, context(host)))).toEqual([
      { id: 'p1', name: 'Plate', modified: new Date(0).toISOString(), open: true },
    ]);
    expect((await runTool('open_design', { id: 'p2' }, context(host))).result.isError).toBe(true);
    expect(jsonOf(await runTool('open_design', { id: 'p1' }, context(host))).name).toBe('Plate');
  });

  it('reads the design: parameters and the timeline with statuses', async () => {
    const { host, model, store } = plateHost();
    const [sketch, extrude] = store.getState().doc.features;
    model.getState().computed({
      features: {
        [sketch?.id as never]: { status: 'ok' },
        [extrude?.id as never]: { status: 'error', message: 'No profile.' },
      },
      bodies: {},
    });
    const design = jsonOf(await runTool('get_design', {}, context(host)));
    expect(design.parameters).toEqual([
      expect.objectContaining({ name: 'thickness', expression: '5 mm' }),
    ]);
    expect(design.timeline).toEqual([
      { id: sketch?.id, type: 'sketch', name: 'Sketch1', status: 'ok', suppressed: false },
      {
        id: extrude?.id,
        type: 'extrude',
        name: 'Extrude1',
        status: 'error',
        message: 'No profile.',
        suppressed: false,
      },
    ]);
  });

  it("gives a feature's inputs as the API's plain values, and a sketch's profiles", async () => {
    const { host, store } = plateHost();
    const [sketch, extrude] = store.getState().doc.features;
    const detail = jsonOf(await runTool('get_feature', { id: extrude?.id }, context(host)));
    expect(detail.inputs.distance).toBe('thickness');
    expect(detail.inputs.profiles).toMatchObject({ kind: 'profile' });
    const sketchDetail = jsonOf(await runTool('get_feature', { id: sketch?.id }, context(host)));
    expect(sketchDetail.profiles).toHaveLength(1);
    expect(plainInput({ kind: 'bool', value: true })).toBe(true);
  });

  it("gives a Mesh to Solid's report with the feature, as its status has it", async () => {
    const { host, store, model } = plateHost();
    const [sketch, extrude] = store.getState().doc.features;
    const report = {
      method: 'prismatic' as const,
      faces: 7,
      planes: 6,
      cylinders: 1,
      cones: 0,
      spheres: 0,
      tori: 0,
      unfit: { regions: 0, triangles: 0, fraction: 0 },
      rebuild: 'exact' as const,
      facets: 0,
    };
    model.getState().computed({
      features: {
        [sketch?.id as never]: { status: 'ok' },
        [extrude?.id as never]: { status: 'ok', meshToSolid: report },
      },
      bodies: {},
    });
    const detail = jsonOf(await runTool('get_feature', { id: extrude?.id }, context(host)));
    expect(detail.meshToSolid).toEqual(report);
    const sketchDetail = jsonOf(await runTool('get_feature', { id: sketch?.id }, context(host)));
    expect(sketchDetail.meshToSolid).toBeUndefined();
  });

  it('sets a parameter through apply as one undo step named Agent: …', async () => {
    const { host, store, applied } = plateHost();
    const reply = await runTool(
      'set_parameter',
      { name: 'thickness', expression: '8 mm' },
      context(host),
    );
    expect(reply.result.isError).toBeUndefined();
    expect(jsonOf(reply).done).toBe('Agent: Set thickness');
    expect(applied).toHaveLength(1);
    expect(store.getState().doc.parameters[0]?.expression).toBe('8 mm');
    expect(store.getState().undoLabel).toBe('Agent: Set thickness');
    store.getState().undo();
    expect(store.getState().doc.parameters[0]?.expression).toBe('5 mm');
  });

  it('creates a parameter that does not exist', async () => {
    const { host, store } = plateHost();
    await runTool('set_parameter', { name: 'width', expression: '40 mm' }, context(host));
    expect(store.getState().doc.parameters.map((p) => p.name)).toEqual(['thickness', 'width']);
  });

  it('adds a sketch and an extrude of its profile: two steps, Ctrl+Z undoes the extrude', async () => {
    const { host, store } = plateHost();
    const sketch = jsonOf(
      await runTool(
        'add_sketch',
        {
          plane: 'xz',
          shapes: [{ shape: 'circle', center: [0, 0], diameter: '10 mm' }],
          name: 'Peg',
        },
        context(host),
      ),
    ).result;
    expect(sketch.name).toBe('Peg');
    expect(sketch.profiles).toHaveLength(1);
    const added = await runTool(
      'add_feature',
      { type: 'extrude', inputs: { profiles: sketch.profiles, distance: '12 mm' } },
      context(host),
    );
    expect(added.result.isError).toBeUndefined();
    const [extrude] = jsonOf(added).result;
    const features = store.getState().doc.features;
    expect(features).toHaveLength(4);
    expect(features[3]).toMatchObject({ id: extrude.id, type: 'extrude', name: 'Extrude2' });
    // The profile reference names the reminted sketch.
    expect(JSON.stringify(features[3]?.inputs)).toContain(sketch.id);
    expect(store.getState().undoLabel).toBe('Agent: Add extrude');
    store.getState().undo();
    expect(store.getState().doc.features).toHaveLength(3);
    expect(store.getState().undoLabel).toBe('Agent: Add Peg');
  });

  it('keeps a sketch coordinate given as an expression as a dimension from a fixed origin (#103)', async () => {
    const { host, store } = plateHost();
    const sketch = jsonOf(
      await runTool(
        'add_sketch',
        {
          plane: 'xy',
          shapes: [
            { shape: 'line', from: ['-thickness', 0], to: [10, '2 * thickness'] },
            { shape: 'line', from: ['-thickness', 5], to: [10, 5] },
          ],
        },
        context(host),
      ),
    ).result;
    const added = store.getState().doc.features.find((f) => f.id === sketch.id);
    const data = (added?.inputs.sketch as { sketch: SketchData } | undefined)?.sketch;
    const dims = Object.values(data?.dimensions ?? {}).map((d) => ({
      orientation: (d as { orientation: string }).orientation,
      expr: d.expr,
    }));
    // A negative coordinate is kept as its distance, on the side it is drawn.
    expect(dims).toEqual([
      { orientation: 'horizontal', expr: '-(-thickness)' },
      { orientation: 'vertical', expr: '2 * thickness' },
      { orientation: 'horizontal', expr: '-(-thickness)' },
    ]);
    // One fixed point at the origin serves every shape.
    const fixed = Object.values(data?.constraints ?? {}).filter((c) => c.type === 'fix');
    expect(fixed).toHaveLength(1);
  });

  it('refuses a sketch coordinate it cannot evaluate with its path and changes nothing', async () => {
    const { host, store } = plateHost();
    const before = store.getState().doc;
    const reply = await runTool(
      'add_sketch',
      { plane: 'xy', shapes: [{ shape: 'circle', center: [0, 'nothing / 2'], diameter: 4 }] },
      context(host),
    );
    expect(reply.result.isError).toBe(true);
    expect(textOf(reply)).toMatch(/^shapes\.0\.center\.1: .*nothing/);
    expect(store.getState().doc).toBe(before);
  });

  it('renames the open design in one step and saves it (#105)', async () => {
    const { host, store } = plateHost();
    let saved = 0;
    host.save = async () => {
      saved++;
    };
    const reply = jsonOf(await runTool('rename_design', { name: ' House ' }, context(host)));
    expect(reply.result).toEqual({ name: 'House' });
    expect(store.getState().doc.name).toBe('House');
    expect(store.getState().undoLabel).toBe('Agent: Rename design');
    expect(saved).toBe(1);
    expect(jsonOf(await runTool('get_design', {}, context(host))).name).toBe('House');
    const empty = await runTool('rename_design', { name: '  ' }, context(host));
    expect(empty.result.isError).toBe(true);
    expect(saved).toBe(1);
  });

  it('refuses a bad feature input with its path and changes nothing', async () => {
    const { host, store } = plateHost();
    const before = store.getState().doc;
    const reply = await runTool(
      'add_feature',
      { type: 'extrude', inputs: { profiles: [], distance: true } },
      context(host),
    );
    expect(reply.result.isError).toBe(true);
    expect(textOf(reply)).toMatch(/^distance: /);
    expect(store.getState().doc).toBe(before);
    expect(store.getState().canUndo).toBe(false);
    const unknown = await runTool('add_feature', { type: 'wobble' }, context(host));
    expect(textOf(unknown)).toBe('type: There is no feature type "wobble".');
  });

  it('edits some inputs and keeps the rest', async () => {
    const { host, store } = plateHost();
    const extrude = store.getState().doc.features[1];
    const reply = await runTool(
      'edit_feature',
      { id: extrude?.id, inputs: { distance: '2 * thickness' } },
      context(host),
    );
    expect(reply.result.isError).toBeUndefined();
    const after = store.getState().doc.features[1];
    expect(after?.inputs.distance).toMatchObject({ kind: 'expr', expr: '2 * thickness' });
    expect(after?.inputs.profiles).toEqual(extrude?.inputs.profiles);
    expect(store.getState().undoLabel).toBe('Agent: Edit Extrude1');
  });

  it('keeps the model-parameter name of an expression it edits', async () => {
    const doc = plate();
    const extrude = doc.features[1];
    const named = {
      ...doc,
      features: doc.features.map((f) =>
        f.id === extrude?.id
          ? {
              ...f,
              inputs: {
                ...f.inputs,
                distance: { kind: 'expr' as const, expr: '5 mm', paramName: 'd7' },
              },
            }
          : f,
      ),
    } as ExtrudoDocument;
    const { host, store } = plateHost(named);
    await runTool(
      'edit_feature',
      { id: extrude?.id, inputs: { distance: '15 mm' } },
      context(host),
    );
    expect(store.getState().doc.features[1]?.inputs.distance).toMatchObject({
      kind: 'expr',
      expr: '15 mm',
      paramName: 'd7',
    });
  });

  it('leaves undo and redo to their own tools in run_command', async () => {
    const { host } = plateHost();
    const commands = host.commands;
    host.commands = () => [
      ...commands(),
      { id: 'undo', label: 'Undo', group: 'Edit', run: () => {} },
    ];
    expect(textOf(await runTool('run_command', { id: 'undo' }, context(host)))).toBe(
      'Use the undo tool for that.',
    );
  });

  it("runs a command that opens a dialog outside the agent's step", async () => {
    const { host, store } = plateHost();
    const extrude = store.getState().doc.features[1];
    const commands = host.commands;
    host.commands = () => [
      ...commands(),
      {
        id: 'extrude',
        label: 'Extrude',
        group: 'Solid',
        // A feature dialog: it begins its own step and leaves it open.
        run: () => {
          store.getState().beginTransaction('Edit Extrude1');
          store.getState().dispatch(renameFeature({ id: extrude?.id as never, name: 'Draft' }));
        },
      },
    ];
    const reply = await runTool('run_command', { id: 'extrude' }, context(host));
    expect(reply.result.isError).toBeUndefined();
    expect(jsonOf(reply)).toMatchObject({ command: 'extrude', opened: 'Extrude' });
    expect(jsonOf(reply).message).toBe(
      'Extrude opened in the app: finish it there, or ask the person to; change tools are refused until then.',
    );
    // Only the dialog's own level is open, and change tools wait for it.
    expect(store.getState().transactionDepth).toBe(1);
    expect(textOf(await runTool('rename', { id: 'Draft', name: 'x' }, context(host)))).toBe(BUSY);
    store.getState().commitTransaction();
    expect(store.getState().transactionDepth).toBe(0);
    expect(store.getState().undoLabel).toBe('Edit Extrude1');
  });

  it('keeps app-level commands from agents', async () => {
    const { host, ran } = plateHost();
    const commands = host.commands;
    host.commands = () => [
      ...commands(),
      { id: 'quit', label: 'Quit', group: 'App', run: () => ran.push('quit') },
      { id: 'openRecent:0', label: 'a.extrudo', group: 'Recent', run: () => ran.push('recent') },
      { id: 'openSettings', label: 'Settings…', group: 'App', run: () => ran.push('settings') },
    ];
    const listed = jsonOf(await runTool('list_commands', {}, context(host))).map(
      (c: { id: string }) => c.id,
    );
    expect(listed).toEqual(['fitView', 'shell']);
    for (const id of ['quit', 'openRecent:0', 'openSettings', 'clearRecent']) {
      expect(textOf(await runTool('run_command', { id }, context(host)))).toBe(NOT_FOR_AGENTS);
    }
    expect(ran).toEqual([]);
  });

  it('suppresses, renames and removes, each one step', async () => {
    const { host, store } = plateHost();
    const extrude = store.getState().doc.features[1];
    await runTool('suppress', { id: extrude?.id, on: true }, context(host));
    expect(store.getState().doc.features[1]?.suppressed).toBe(true);
    await runTool('rename', { id: extrude?.id, name: 'Base' }, context(host));
    expect(store.getState().doc.features[1]?.name).toBe('Base');
    const sketchId = store.getState().doc.features[0]?.id;
    const refused = await runTool('remove', { id: sketchId }, context(host));
    expect(refused.result.isError).toBe(true);
    await runTool('remove', { id: 'Base' }, context(host));
    expect(store.getState().doc.features).toHaveLength(1);
    await runTool('undo', {}, context(host));
    expect(store.getState().doc.features).toHaveLength(2);
    await runTool('redo', {}, context(host));
    expect(store.getState().doc.features).toHaveLength(1);
  });

  it('refuses a change while a sketch or dialog is open', async () => {
    const { host, store } = plateHost();
    store.getState().beginTransaction('Edit Extrude1');
    const reply = await runTool('rename', { id: 'Extrude1', name: 'x' }, context(host));
    expect(textOf(reply)).toBe(BUSY);
    store.getState().cancelTransaction();
  });

  it('applies a configuration by name', async () => {
    const d = Design.from(plate());
    d.configuration('Thick', { thickness: '9 mm' });
    const { host, store } = plateHost(d.toJSON());
    const reply = await runTool('apply_configuration', { configuration: 'Thick' }, context(host));
    expect(jsonOf(reply).result).toEqual({ configuration: 'Thick', changed: 1 });
    expect(store.getState().doc.parameters[0]?.expression).toBe('9 mm');
  });

  it('runs a command, refusing an unavailable one with its reason', async () => {
    const { host, ran } = plateHost();
    await runTool('run_command', { id: 'fitView' }, context(host));
    expect(ran).toEqual(['fitView']);
    expect(textOf(await runTool('run_command', { id: 'shell' }, context(host)))).toBe(
      'Shell: Select a face first.',
    );
    expect(jsonOf(await runTool('list_commands', {}, context(host)))).toHaveLength(2);
  });

  it('reads bodies, selection, a screenshot and exports with the file', async () => {
    const { host, session } = plateHost();
    expect(jsonOf(await runTool('get_bodies', {}, context(host)))[0].volume).toBe(4000);
    session.getState().select([{ kind: 'face', id: 'b1:2' }]);
    expect(jsonOf(await runTool('get_selection', {}, context(host)))).toEqual([
      { kind: 'face', id: 'b1:2' },
    ]);
    const shot = await runTool('screenshot', {}, context(host));
    expect(shot.result.content[0]).toEqual({
      type: 'image',
      data: 'iVBORw==',
      mimeType: 'image/png',
    });
    const exported = await runTool('export', { format: 'stl' }, context(host));
    expect(exported.file).toEqual({
      design: 'Plate',
      format: 'stl',
      bytes: new Uint8Array([1, 2, 3]),
    });
  });
});

describe('the agent tools, the rest (coverage)', () => {
  it('makes a new design and opens it, and gives the whole document', async () => {
    const ctx = context(undefined);
    const made = jsonOf(await runTool('new_design', { name: 'Fresh' }, ctx));
    expect(made).toMatchObject({ name: 'Fresh', timeline: [], parameters: [] });
    expect(ctx.current()?.designId).toBe(made.id);
    const doc = jsonOf(await runTool('get_document', {}, ctx));
    expect(doc.name).toBe('Fresh');
    expect(doc.features).toEqual([]);
  });

  it('saves, and answers that undo and redo have nothing to do', async () => {
    const { host } = plateHost();
    expect(textOf(await runTool('save', {}, context(host)))).toBe('Saved Plate.');
    expect(textOf(await runTool('undo', {}, context(host)))).toBe('There is nothing to undo.');
    expect(textOf(await runTool('redo', {}, context(host)))).toBe('There is nothing to redo.');
  });

  it('leaves get_skill to the desktop app', async () => {
    const reply = await runTool('get_skill', {}, context(undefined));
    expect(reply.result.isError).toBe(true);
  });

  it('expands { edgeBetween } anywhere in the inputs, and nothing else', () => {
    const faces = ['box:B:cap:end', 'box:B:side:front'];
    const expanded = expandShorthands({ edges: [{ edgeBetween: faces }], distance: '1 mm' });
    expect(expanded).toEqual({
      edges: [{ kind: 'edge', id: expect.stringContaining('box:B:cap:end') }],
      distance: '1 mm',
    });
    expect(expandShorthands({ edgeBetween: ['one'] })).toEqual({ edgeBetween: ['one'] });
    expect(expandShorthands({ edgeBetween: faces, other: 1 })).toEqual({
      edgeBetween: faces,
      other: 1,
    });
  });

  it('resolves body references by the bodies the model has (#84)', () => {
    const doc = plate();
    const [, extrude] = doc.features;
    const id = extrude?.id as string;
    const live = new Set([`${id}:0`, 'other:0', 'other:1']);
    // Kept as given, a bare feature id or name for its one body, and refusals with paths.
    expect(resolveBodyRefs({ kind: 'body', id: 'other:1' }, live, doc)).toEqual({
      kind: 'body',
      id: 'other:1',
    });
    expect(resolveBodyRefs([{ kind: 'body', id }], live, doc)).toEqual([
      { kind: 'body', id: `${id}:0` },
    ]);
    expect(resolveBodyRefs({ target: { kind: 'body', id: 'Extrude1' } }, live, doc)).toEqual({
      target: { kind: 'body', id: `${id}:0` },
    });
    expect(() => resolveBodyRefs({ a: [{ kind: 'body', id: 'gone:0' }] }, live, doc)).toThrow(
      /^a\.0: There is no body "gone:0"/,
    );
    // Other references pass through.
    expect(resolveBodyRefs({ kind: 'face', id: 'x' }, live, doc)).toEqual({
      kind: 'face',
      id: 'x',
    });
  });

  it('passes body references unchecked while the model is not computed', async () => {
    const { host, store } = plateHost();
    const reply = await runTool(
      'add_feature',
      {
        type: 'shell',
        inputs: { bodies: [{ kind: 'body', id: 'unknown:0' }], thickness: '1 mm' },
      },
      context(host),
    );
    expect(reply.result.isError).toBeUndefined();
    expect(store.getState().doc.features.at(-1)?.type).toBe('shell');
  });

  it('refuses body tools while the model is not computed', async () => {
    const { host } = plateHost();
    for (const [tool, args] of [
      ['set_body_appearance', { id: 'b1', color: '#000000' }],
      ['check_interference', {}],
      ['screenshot', { bodies: [{ kind: 'body', id: 'b1' }] }],
    ] as const) {
      const reply = await runTool(tool, args, context(host));
      expect(reply.result.isError, tool).toBe(true);
      expect(textOf(reply)).toMatch(/isn't computed/);
    }
  });

  it('checks the interference of the visible bodies once computed', async () => {
    const { host, model, store } = plateHost();
    const [, extrude] = store.getState().doc.features;
    const body = `${extrude?.id}:0`;
    model.getState().computed({
      features: {},
      bodies: { [body]: {}, 'x:0': {} } as Record<BodyId, unknown>,
      doc: store.getState().doc,
    });
    const asked: string[][] = [];
    host.interference = async (ids) => {
      asked.push([...ids]);
      return [
        { a: body, b: 'x:0', volume: 12.34567, box: { min: [0, 0, 0], max: [1, 2, 3.00004] } },
      ];
    };
    expect(jsonOf(await runTool('check_interference', {}, context(host)))).toEqual([
      { a: body, b: 'x:0', volume: 12.346, box: { min: [0, 0, 0], max: [1, 2, 3] } },
    ]);
    expect(asked).toEqual([[body, 'x:0']]);
  });
});

describe('createPacer', () => {
  it('spaces calls by the interval', async () => {
    let time = 0;
    const pace = createPacer(1000, () => time);
    await pace();
    const second = pace();
    let done = false;
    void second.then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    time = 1000;
    await new Promise((resolve) => setTimeout(resolve, 1050));
    expect(done).toBe(true);
  });
});

describe('annotations (ADR-0126 §8)', () => {
  /** The plate with its model computed: one body, `<extrude id>:0`. */
  function computedPlate() {
    const fake = plateHost();
    const { model, store } = fake;
    const [sketch, extrude] = store.getState().doc.features;
    const body = `${extrude?.id}:0`;
    const ready = () =>
      model.getState().computed({
        features: {},
        bodies: { [body]: {} } as Record<BodyId, unknown>,
        doc: store.getState().doc,
      });
    ready();
    // Every document change is "recomputed" at once, as the kernel would.
    store.subscribe((s, p) => {
      if (s.doc !== p.doc) ready();
    });
    return { ...fake, sketch: sketch?.id as string, extrude: extrude?.id as string, body };
  }
  const top = (extrude: string) => `extrude:${extrude}:cap:end`;

  it('adds a free note and a sketch note with running numbers, and lists them', async () => {
    const { host, store, sketch } = computedPlate();
    const first = jsonOf(
      await runTool(
        'add_annotation',
        { text: 'Logo here', anchor: { at: [1, 2, 3] } },
        context(host),
      ),
    );
    expect(first.done).toBe('Agent: Annotate #1');
    expect(first.result.number).toBe(1);
    const second = jsonOf(
      await runTool(
        'add_annotation',
        { text: 'Round this\ncorner', anchor: { sketch, at: [40, 20] } },
        context(host),
      ),
    );
    expect(second.result.number).toBe(2);
    expect(store.getState().undoLabel).toBe('Agent: Annotate #2');
    expect(jsonOf(await runTool('list_annotations', {}, context(host)))).toEqual([
      {
        number: 1,
        text: 'Logo here',
        done: false,
        hidden: false,
        anchor: { kind: 'free', status: 'ok', at: [1, 2, 3] },
      },
      {
        number: 2,
        text: 'Round this\ncorner',
        done: false,
        hidden: false,
        anchor: { kind: 'sketch', status: 'ok', at: [40, 20], sketch },
      },
    ]);
    const design = jsonOf(await runTool('get_design', {}, context(host)));
    expect(design.annotations).toEqual([
      { number: 1, text: 'Logo here', status: 'ok' },
      { number: 2, text: 'Round this', status: 'ok' },
    ]);
  });

  it('stores a face by its resolved name and fingerprint, and lists it agent-readably', async () => {
    const { host, model, extrude, body } = computedPlate();
    const fingerprint: GeomFingerprint = {
      type: 'plane',
      at: [20, 10, 5],
      dir: [0, 0, 1],
      size: 800,
    };
    const asked: unknown[] = [];
    host.resolveAnnotation = async (annotation) => {
      asked.push(annotation.anchor);
      return {
        id: annotation.id,
        status: 'ok',
        at: [20, 10, 5],
        normal: [0, 0, 1],
        resolved: {
          ref: { kind: 'face', id: top(extrude), fingerprint: { ...fingerprint, at: [20, 10, 5] } },
          body: body as BodyId,
        },
      };
    };
    const reply = jsonOf(
      await runTool(
        'add_annotation',
        { text: 'Make this hole M4', anchor: { face: top(extrude), at: [5, 5, 5] } },
        context(host),
      ),
    );
    expect(reply.result.number).toBe(1);
    expect(asked).toEqual([
      { kind: 'model', ref: { kind: 'face', id: top(extrude) }, at: [0, 0, 0] },
    ]);
    const stored = host.store.getState().doc.annotations?.[0];
    expect(stored?.anchor).toEqual({
      kind: 'model',
      ref: { kind: 'face', id: top(extrude), fingerprint: { ...fingerprint, at: [20, 10, 5] } },
      at: [5, 5, 5],
    });
    // What the kernel reports after the recompute is what list_annotations reads.
    model.setState({
      annotations: {
        [stored?.id as AnnotationId]: {
          id: stored?.id as AnnotationId,
          status: 'moved',
          at: [5, 5, 7],
          normal: [0, 0, 1],
          resolved: { ref: { kind: 'face', id: top(extrude) }, body: body as BodyId },
        },
      },
    });
    const [listed] = jsonOf(await runTool('list_annotations', {}, context(host)));
    expect(listed.anchor).toEqual({
      kind: 'model',
      status: 'moved',
      at: [5, 5, 7],
      normal: [0, 0, 1],
      face: top(extrude),
      body,
      feature: extrude,
    });
    // Without `at`, the note sits at the face's centre.
    await runTool(
      'add_annotation',
      { text: 'Centre', anchor: { face: top(extrude) } },
      context(host),
    );
    expect(host.store.getState().doc.annotations?.[1]?.anchor).toMatchObject({ at: [20, 10, 5] });
  });

  it('turns edgeBetween into an edge name and a bare feature id into its body', async () => {
    const { host, extrude, body } = computedPlate();
    const asked: GeomRef[] = [];
    host.resolveAnnotation = async (annotation) => {
      const ref = (annotation.anchor as { ref: GeomRef }).ref;
      asked.push(ref);
      return {
        id: annotation.id,
        status: 'ok',
        resolved: { ref: { ...ref, fingerprint: { type: 'line', at: [0, 0, 0] } } },
      };
    };
    await runTool(
      'add_annotation',
      { text: 'Chamfer', anchor: { edgeBetween: ['b:f:side', 'a:f:cap'] } },
      context(host),
    );
    await runTool(
      'add_annotation',
      { text: 'Whole part', anchor: { body: extrude } },
      context(host),
    );
    expect(asked).toEqual([
      { kind: 'edge', id: 'e[a:f:cap|b:f:side]' },
      { kind: 'body', id: body },
    ]);
  });

  it('refuses what does not resolve, with the input path, and changes nothing', async () => {
    const { host, store, extrude } = computedPlate();
    const before = store.getState().doc;
    const refused = async (args: Record<string, unknown>) => {
      const reply = await runTool('add_annotation', args, context(host));
      expect(reply.result.isError).toBe(true);
      expect(store.getState().doc).toBe(before);
      return textOf(reply);
    };
    // The kernel can't say yet.
    expect(await refused({ text: 'x', anchor: { face: top(extrude) } })).toBe(
      "The model isn't computed: check get_design's problems first.",
    );
    host.resolveAnnotation = async (annotation) => ({ id: annotation.id, status: 'detached' });
    expect(await refused({ text: 'x', anchor: { face: 'extrude:nope:cap:end' } })).toBe(
      'anchor.face: There is no face "extrude:nope:cap:end" in the model at the timeline marker: get_feature and list_annotations give names.',
    );
    expect(await refused({ text: 'x', anchor: { body: 'nope' } })).toBe(
      'anchor.body: There is no body "nope": bodies are named <feature id>:<n>, and get_bodies lists them.',
    );
    expect(await refused({ text: 'x', anchor: { sketch: 'nope', at: [0, 0] } })).toBe(
      'anchor.sketch: There is no sketch "nope".',
    );
    expect(
      await refused({ text: 'x', anchor: { sketch: 'Sketch1', at: [0, 0], entity: 'zz' } }),
    ).toBe('anchor.entity: The sketch has no entity "zz".');
    expect(await refused({ text: '   ', anchor: { at: [0, 0, 0] } })).toMatch(/^text: /);
    expect(await refused({ text: 'x', anchor: { face: top(extrude), at: [0, 0] } })).toMatch(
      /^anchor/,
    );
  });

  it('edits text, done, hidden and anchor by number, and answers the note', async () => {
    const { host, store, sketch } = computedPlate();
    await runTool('add_annotation', { text: 'a', anchor: { at: [0, 0, 0] } }, context(host));
    const edited = jsonOf(
      await runTool(
        'edit_annotation',
        {
          number: 1,
          text: 'Thicker wall',
          done: true,
          hidden: true,
          anchor: { sketch, at: [1, 1] },
        },
        context(host),
      ),
    );
    expect(edited.done).toBe('Agent: Edit #1');
    expect(edited.result).toEqual({
      number: 1,
      text: 'Thicker wall',
      done: true,
      hidden: true,
      anchor: { kind: 'sketch', status: 'ok', at: [1, 1], sketch },
    });
    // One undo step takes it all back.
    await runTool('undo', {}, context(host));
    expect(store.getState().doc.annotations?.[0]).toMatchObject({
      text: 'a',
      anchor: { kind: 'free' },
    });
    expect(
      (await runTool('edit_annotation', { number: 7, done: true }, context(host))).result,
    ).toEqual({
      content: [{ type: 'text', text: 'There is no annotation #7: list_annotations lists them.' }],
      isError: true,
    });
    expect(textOf(await runTool('edit_annotation', { number: 1 }, context(host)))).toBe(
      'Give text, done, hidden or anchor to change.',
    );
    // Ticked-off notes are listed last, and can be left out.
    await runTool('add_annotation', { text: 'b', anchor: { at: [0, 0, 0] } }, context(host));
    await runTool('edit_annotation', { number: 1, done: true }, context(host));
    const listed = jsonOf(await runTool('list_annotations', {}, context(host)));
    expect(listed.map((a: { number: number }) => a.number)).toEqual([2, 1]);
    const open = jsonOf(await runTool('list_annotations', { includeDone: false }, context(host)));
    expect(open.map((a: { number: number }) => a.number)).toEqual([2]);
  });

  it('removes by number, never gives a number again, and refuses an unknown one', async () => {
    const { host, store } = computedPlate();
    for (const text of ['a', 'b', 'c']) {
      await runTool('add_annotation', { text, anchor: { at: [0, 0, 0] } }, context(host));
    }
    const removed = jsonOf(await runTool('remove_annotation', { numbers: [3, 1] }, context(host)));
    expect(removed.done).toBe('Agent: Delete #3, #1');
    expect(removed.result).toEqual({ removed: [3, 1] });
    expect(store.getState().doc.annotations?.map((a) => a.number)).toEqual([2]);
    const next = jsonOf(
      await runTool('add_annotation', { text: 'd', anchor: { at: [0, 0, 0] } }, context(host)),
    );
    expect(next.result.number).toBe(4);
    expect(textOf(await runTool('remove_annotation', { numbers: [1, 9] }, context(host)))).toBe(
      'There is no annotation #1, #9: list_annotations lists them.',
    );
  });

  it('takes a plane, axis or point without the bodies, and refuses a body until they are', async () => {
    // A design whose model isn't computed: no bodies to check names against.
    const { host, store } = plateHost();
    const asked: GeomRef[] = [];
    host.resolveAnnotation = async (annotation) => {
      const ref = (annotation.anchor as { ref: GeomRef }).ref;
      asked.push(ref);
      return {
        id: annotation.id,
        status: 'ok',
        resolved: { ref: { ...ref, fingerprint: { type: ref.kind, at: [0, 0, 0] } } },
      };
    };
    for (const anchor of [
      { plane: 'origin:xy', at: [1, 2, 0] },
      { axis: 'origin:z' },
      { point: 'origin:point' },
    ]) {
      const reply = await runTool('add_annotation', { text: 'x', anchor }, context(host));
      expect(reply.result.isError, textOf(reply)).toBeUndefined();
    }
    expect(asked.map((r) => r.kind)).toEqual(['plane', 'axis', 'point']);
    expect(store.getState().doc.annotations?.map((a) => a.anchor)).toEqual([
      {
        kind: 'model',
        ref: { kind: 'plane', id: 'origin:xy', fingerprint: { type: 'plane', at: [0, 0, 0] } },
        at: [1, 2, 0],
      },
      {
        kind: 'model',
        ref: { kind: 'axis', id: 'origin:z', fingerprint: { type: 'axis', at: [0, 0, 0] } },
        at: [0, 0, 0],
      },
      {
        kind: 'model',
        ref: { kind: 'point', id: 'origin:point', fingerprint: { type: 'point', at: [0, 0, 0] } },
        at: [0, 0, 0],
      },
    ]);
    const body = await runTool(
      'add_annotation',
      { text: 'x', anchor: { body: 'b' } },
      context(host),
    );
    expect(textOf(body)).toBe("The model isn't computed: check get_design's problems first.");
  });

  it('names the step and answers the number given as the step begins', async () => {
    const { host, store } = computedPlate();
    // A person's note lands while the agent's change waits for the solver.
    host.ready = async () => {
      store.getState().dispatch(
        addAnnotation({
          id: 'p1' as AnnotationId,
          text: 'Mine',
          anchor: { kind: 'free', at: [0, 0, 0] },
        }),
      );
    };
    const reply = jsonOf(
      await runTool('add_annotation', { text: 'Agent', anchor: { at: [0, 0, 0] } }, context(host)),
    );
    expect(reply.done).toBe('Agent: Annotate #2');
    expect(reply.result.number).toBe(2);
  });

  it("screenshot { annotations } hands the notes' badges to the snapshot, hidden ones left out", async () => {
    const { host } = computedPlate();
    for (const text of ['a', 'b', 'c']) {
      await runTool('add_annotation', { text, anchor: { at: [1, 2, 3] } }, context(host));
    }
    await runTool('edit_annotation', { number: 2, done: true }, context(host));
    await runTool('edit_annotation', { number: 3, hidden: true }, context(host));
    const asked: (SnapshotOptions | undefined)[] = [];
    host.snapshot = async (_size, options) => {
      asked.push(options);
      // The fake's picture changes with what it draws, as the real one does.
      const bytes = options?.marks ? [137, 80, 78, 71, options.marks.length] : [137, 80, 78, 71];
      return new Blob([new Uint8Array(bytes)], { type: 'image/png' });
    };
    const plain = await runTool('screenshot', {}, context(host));
    const marked = await runTool('screenshot', { annotations: true }, context(host));
    expect(asked[0]).toBeUndefined();
    expect(asked[1]?.marks).toEqual([
      { at: [1, 2, 3], number: 1, look: 'solid' },
      { at: [1, 2, 3], number: 2, look: 'muted' },
    ]);
    const data = (reply: AgentReply) => (reply.result.content[0] as { data: string }).data;
    expect(data(marked)).not.toBe(data(plain));
  });

  it('refuses a change while a sketch is open', async () => {
    const { host, session } = computedPlate();
    session.setState({ mode: 'sketch' } as never);
    expect(
      textOf(
        await runTool('add_annotation', { text: 'x', anchor: { at: [0, 0, 0] } }, context(host)),
      ),
    ).toBe(BUSY);
    expect(textOf(await runTool('remove_annotation', { numbers: [1] }, context(host)))).toMatch(
      /There is no annotation/,
    );
  });
});
