import { Design } from '@extrudo/api';
import {
  type Command,
  createDocumentStore,
  createModelStore,
  createSessionStore,
  type ExtrudoDocument,
} from '@extrudo/core';
import type { ProjectSummary } from '@extrudo/storage';
import { describe, expect, it } from 'vitest';
import type { AgentReply } from '../platform/agent';
import type { AgentHost } from './host';
import { TOOL_NAMES, toolDefinitions } from './schemas';
import { type AgentContext, BUSY, createPacer, NO_DESIGN, plainInput, runTool } from './tools';

function plate(): ExtrudoDocument {
  const d = Design.create({ name: 'Plate' });
  d.parameter('thickness', '5 mm');
  const sketch = d.sketch(d.origin.xy, (k) => {
    k.rectangle([0, 0], [40, 20]);
  });
  d.extrude({ profiles: sketch.profileAt([10, 10]), distance: 'thickness' });
  return d.toJSON();
}

function fakeHost(doc = plate()) {
  const store = createDocumentStore(doc);
  const session = createSessionStore();
  const model = createModelStore<unknown>();
  const applied: string[] = [];
  const ran: string[] = [];
  const host: AgentHost = {
    designId: 'p1',
    store,
    session,
    model,
    apply(commands: readonly Command<unknown>[]) {
      // The shell's `apply`: one step for the lot (nested in the agent's).
      store.getState().beginTransaction(commands[0]?.label ?? '');
      for (const command of commands) {
        applied.push(command.label);
        store.getState().dispatch(command);
      }
      store.getState().commitTransaction();
    },
    bodies: async () => [
      {
        id: 'b1',
        name: 'Body1',
        volume: 4000,
        box: { min: [0, 0, 0], max: [40, 20, 5] },
        visible: true,
      },
    ],
    snapshot: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
    commands: () => [
      { id: 'fitView', label: 'Fit view', group: 'View', run: () => ran.push('fitView') },
      {
        id: 'shell',
        label: 'Shell',
        group: 'Solid',
        unavailable: 'Select a face first.',
        run: () => {},
      },
    ],
    undo: () => store.getState().undo(),
    redo: () => store.getState().redo(),
    save: async () => {},
    exportModel: async () => new Uint8Array([1, 2, 3]),
  };
  return { host, store, session, model, applied, ran };
}

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

function context(host: AgentHost | undefined, extra: Partial<AgentContext> = {}): AgentContext {
  return {
    host: () => host,
    designs: async () => designs,
    open: async () => {
      if (!host) throw new Error('no host');
      return host;
    },
    screenshotTurn: async () => {},
    exportTurn: async () => {},
    settleMs: 5,
    ...extra,
  };
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
    const { host } = fakeHost();
    const reply = await runTool('set_parameter', { name: 'w' }, context(host));
    expect(reply.result.isError).toBe(true);
    expect(textOf(reply)).toMatch(/^expression: /);
    expect((await runTool('nope', {}, context(host))).result.isError).toBe(true);
  });

  it('lists the designs, leaving out the trashed ones', async () => {
    const { host } = fakeHost();
    expect(jsonOf(await runTool('list_designs', {}, context(host)))).toEqual([
      { id: 'p1', name: 'Plate', modified: new Date(0).toISOString(), open: true },
    ]);
    expect((await runTool('open_design', { id: 'p2' }, context(host))).result.isError).toBe(true);
    expect(jsonOf(await runTool('open_design', { id: 'p1' }, context(host))).name).toBe('Plate');
  });

  it('reads the design: parameters and the timeline with statuses', async () => {
    const { host, model, store } = fakeHost();
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
    const { host, store } = fakeHost();
    const [sketch, extrude] = store.getState().doc.features;
    const detail = jsonOf(await runTool('get_feature', { id: extrude?.id }, context(host)));
    expect(detail.inputs.distance).toBe('thickness');
    expect(detail.inputs.profiles).toMatchObject({ kind: 'profile' });
    const sketchDetail = jsonOf(await runTool('get_feature', { id: sketch?.id }, context(host)));
    expect(sketchDetail.profiles).toHaveLength(1);
    expect(plainInput({ kind: 'bool', value: true })).toBe(true);
  });

  it('sets a parameter through apply as one undo step named Agent: …', async () => {
    const { host, store, applied } = fakeHost();
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
    const { host, store } = fakeHost();
    await runTool('set_parameter', { name: 'width', expression: '40 mm' }, context(host));
    expect(store.getState().doc.parameters.map((p) => p.name)).toEqual(['thickness', 'width']);
  });

  it('adds a sketch and an extrude of its profile: two steps, Ctrl+Z undoes the extrude', async () => {
    const { host, store } = fakeHost();
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
    const { host, store } = fakeHost();
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
    const { host, store } = fakeHost();
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

  it('suppresses, renames and removes, each one step', async () => {
    const { host, store } = fakeHost();
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
    const { host, store } = fakeHost();
    store.getState().beginTransaction('Edit Extrude1');
    const reply = await runTool('rename', { id: 'Extrude1', name: 'x' }, context(host));
    expect(textOf(reply)).toBe(BUSY);
    store.getState().cancelTransaction();
  });

  it('applies a configuration by name', async () => {
    const d = Design.from(plate());
    d.configuration('Thick', { thickness: '9 mm' });
    const { host, store } = fakeHost(d.toJSON());
    const reply = await runTool('apply_configuration', { configuration: 'Thick' }, context(host));
    expect(jsonOf(reply).result).toEqual({ configuration: 'Thick', changed: 1 });
    expect(store.getState().doc.parameters[0]?.expression).toBe('9 mm');
  });

  it('runs a command, refusing an unavailable one with its reason', async () => {
    const { host, ran } = fakeHost();
    await runTool('run_command', { id: 'fitView' }, context(host));
    expect(ran).toEqual(['fitView']);
    expect(textOf(await runTool('run_command', { id: 'shell' }, context(host)))).toBe(
      'Shell: Select a face first.',
    );
    expect(jsonOf(await runTool('list_commands', {}, context(host)))).toHaveLength(2);
  });

  it('reads bodies, selection, a screenshot and exports with the file', async () => {
    const { host, session } = fakeHost();
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
