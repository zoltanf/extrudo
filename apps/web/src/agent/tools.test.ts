import { Design } from '@extrudo/api';
import { type ExtrudoDocument, renameFeature } from '@extrudo/core';
import type { ProjectSummary } from '@extrudo/storage';
import { describe, expect, it } from 'vitest';
import type { AgentReply } from '../platform/agent';
import type { AgentHost } from './host';
import { TOOL_NAMES, toolDefinitions } from './schemas';
import { fakeContext, fakeHost } from './testing';
import {
  type AgentContext,
  BUSY,
  createPacer,
  NO_DESIGN,
  NOT_FOR_AGENTS,
  plainInput,
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
