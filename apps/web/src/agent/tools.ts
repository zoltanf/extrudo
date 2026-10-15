/**
 * The agent tools (P6-08, ADR-0087 §5): what an MCP client may do with the app,
 * one function per tool over the open design's `AgentHost`. Main forwards each
 * call here (`runTool`); nothing in this file knows about MCP's wire.
 *
 * Rules kept: every change is **one undo transaction named `Agent: <what>`**
 * (the timeline and Ctrl+Z show it); parameter writes go through the shell's
 * `apply`, so sketches re-solve; features come from `@extrudo/api`'s methods
 * run on `Design.from(document)` (no kernel, ADR-0068) and go in at the marker
 * after `remintFeatures`, as a plugin command's do (ADR-0077); a bad input
 * answers `ApiError`'s path and changes nothing. A change waits for the
 * recompute and answers what failed, so an agent sees a broken feature at once.
 */
import {
  ApiError,
  Design,
  edgeName,
  type FeatureHandle,
  type RectangleHandle,
  type SketchBuilder,
  type SketchHandle,
} from '@extrudo/api';
import {
  addParameter,
  type Command,
  CommandError,
  type ConfigurationId,
  configurationChanges,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  type FeatureInputs,
  type GeomRef,
  insertFeature,
  newId,
  remintFeatures,
  removeFeature,
  renameFeature,
  setFeatureSuppressed,
  setParameterExpressions,
  updateFeatureInputs,
  updateParameter,
} from '@extrudo/core';
import type { ProjectSummary } from '@extrudo/storage';
import { withActiveComponent } from '../components/active';
import type { AgentExportFormat, AgentReply } from '../platform/agent';
import { type AgentHost, settled } from './host';
import { type SketchShape, TOOL_SCHEMAS, type ToolInput, type ToolName } from './schemas';

/** Commands `run_command` leaves to their own tools. */
const UNDO_COMMANDS: ReadonlySet<string> = new Set(['undo', 'redo']);

/**
 * App-level commands an agent may not run or see (ADR-0087 §5): what quits,
 * shows a native dialog or a file picker, opens a page outside the app, or
 * changes the app's own settings. Ids from the command registry
 * (`shell/commands.tsx`, `FILE_COMMANDS`); Open Recent's entries are a prefix.
 */
export const AGENT_DENIED_COMMANDS: ReadonlySet<string> = new Set([
  'quit',
  'clearRecent',
  'openFile',
  'saveAs',
  'saveToLinkedFolder',
  'exportProject',
  'exportScript',
  'exportSketch',
  'importProject',
  'importBody',
  'importDrawing',
  'checkForUpdates',
  'openSettings',
  'customizeMarkingMenu',
  'plugins',
  'about',
  'help',
  'docsGuide',
  'docsTools',
  'docsTutorials',
  'docsExamples',
]);

export const NOT_FOR_AGENTS = 'Not available to agents.';

/** Whether an agent may see and run the command `id`. */
export const agentMayRun = (id: string): boolean =>
  !AGENT_DENIED_COMMANDS.has(id) && !id.startsWith('openRecent');

export const NO_DESIGN = 'No design is open: call open_design first.';
export const BUSY =
  'Finish the sketch or close the open dialog in Extrudo first: a change now would join it.';

/** What the tools need besides the open design. */
export interface AgentContext {
  /** The open design's host, while one is open. */
  host(): AgentHost | undefined;
  designs(): Promise<readonly ProjectSummary[]>;
  /** Makes a new empty design; resolves with its id. */
  create(name: string | undefined): Promise<string>;
  /** Opens a design and resolves with its host once it is ready. */
  open(id: string): Promise<AgentHost>;
  /** Waits its turn: screenshots at most one a second. */
  screenshotTurn(): Promise<void>;
  /** Waits its turn: exports at most one every 2 s. */
  exportTurn(): Promise<void>;
  /** How long a change waits for the recompute (ms). */
  settleMs?: number;
}

const text = (value: string): AgentReply => ({
  result: { content: [{ type: 'text', text: value }] },
});
const json = (value: unknown): AgentReply => text(JSON.stringify(value, null, 2));
const failure = (message: string): AgentReply => ({
  result: { content: [{ type: 'text', text: message }], isError: true },
});

/** An `ApiError` as an agent reads it: the input path first. */
function apiMessage(error: ApiError): string {
  return error.path ? `${error.path}: ${error.message}` : error.message;
}

/** A thrown refusal as a tool error; anything else is a bug and propagates. */
function refusal(error: unknown): string | undefined {
  if (error instanceof ApiError) return apiMessage(error);
  if (error instanceof CommandError) return error.message;
  return undefined;
}

/** A pacer: each call resolves no sooner than `ms` after the previous one did. */
export function createPacer(ms: number, now = () => Date.now()): () => Promise<void> {
  let next = 0;
  return () => {
    const at = Math.max(now(), next);
    next = at + ms;
    const wait = at - now();
    return wait <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, wait));
  };
}

// --- Reading -----------------------------------------------------------------

/** The timeline with each feature's status, as `get_design` lists it. */
export function timeline(host: AgentHost) {
  const { doc } = host.store.getState();
  const { features } = host.model.getState();
  const marker = doc.timelineMarker ?? doc.features.length;
  return doc.features.map((feature, index) => {
    const status = features[feature.id];
    return {
      id: feature.id,
      type: feature.type,
      name: feature.name,
      status: feature.suppressed
        ? 'suppressed'
        : index >= marker
          ? 'rolled back'
          : (status?.status ?? 'pending'),
      ...(status?.message && { message: status.message }),
      suppressed: feature.suppressed,
    };
  });
}

function designSummary(host: AgentHost) {
  const { doc } = host.store.getState();
  return {
    id: host.designId,
    name: doc.name,
    parameters: doc.parameters.map(({ id, name, expression, comment }) => ({
      id,
      name,
      expression,
      ...(comment && { comment }),
    })),
    configurations: (doc.configurations ?? []).map(({ id, name, values }) => ({
      id,
      name,
      values: Object.fromEntries(
        Object.entries(values).map(([parameter, value]) => [
          doc.parameters.find((p) => p.id === parameter)?.name ?? parameter,
          value,
        ]),
      ),
    })),
    timeline: timeline(host),
    marker: doc.timelineMarker ?? doc.features.length,
    canUndo: host.store.getState().undoLabel ?? null,
  };
}

/** A stored input as the API's plain value (what `add_feature` takes back). */
export function plainInput(input: FeatureInputs[string]): unknown {
  switch (input.kind) {
    case 'expr':
      return input.expr;
    case 'enum':
    case 'bool':
    case 'code':
      return input.value;
    case 'labels':
      return input.labels;
    case 'ref':
      return input.refs.length === 1 ? input.refs[0] : input.refs;
    case 'file':
      return input.id;
    default:
      return input;
  }
}

function featureDetail(host: AgentHost, id: string) {
  const { doc } = host.store.getState();
  const feature = doc.features.find((f) => f.id === id);
  if (!feature) return undefined;
  const status = timeline(host).find((f) => f.id === id);
  const base = {
    id: feature.id,
    type: feature.type,
    name: feature.name,
    status: status?.status,
    ...(status?.message && { message: status.message }),
    suppressed: feature.suppressed,
  };
  if (feature.type === 'sketch') {
    const sketch = Design.from(doc).feature(feature.id) as SketchHandle;
    const curves = Object.entries(sketch.data.entities)
      .filter(([, entity]) => entity.type !== 'point')
      .map(([curve, entity]) => ({ id: curve, type: entity.type }));
    return { ...base, plane: sketch.plane, profiles: sketch.profiles(), curves };
  }
  return {
    ...base,
    inputs: Object.fromEntries(
      Object.entries(feature.inputs).map(([name, input]) => [name, plainInput(input)]),
    ),
  };
}

async function screenshot(host: AgentHost): Promise<AgentReply> {
  const png = await host.snapshot(768);
  if (!png) return failure("The 3D view isn't drawn yet: try again in a moment.");
  const bytes = new Uint8Array(await png.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return { result: { content: [{ type: 'image', data: btoa(binary), mimeType: 'image/png' }] } };
}

// --- Changing ----------------------------------------------------------------

/**
 * Runs `body` as one undo step named "Agent: <label>", then waits for the
 * recompute and answers `body`'s summary with any feature that failed. A
 * refusal (`ApiError`, `CommandError`) cancels the step: nothing changes.
 */
async function change(
  ctx: AgentContext,
  host: AgentHost,
  label: string,
  body: () => unknown,
): Promise<AgentReply> {
  const { store, session } = host;
  if (store.getState().transactionDepth > 0 || session.getState().mode === 'sketch') {
    return failure(BUSY);
  }
  await host.ready();
  if (store.getState().transactionDepth > 0 || session.getState().mode === 'sketch') {
    return failure(BUSY);
  }
  let summary: unknown;
  store.getState().beginTransaction(`Agent: ${label}`);
  try {
    summary = body();
    store.getState().commitTransaction();
  } catch (error) {
    store.getState().cancelTransaction();
    const message = refusal(error);
    if (message !== undefined) return failure(message);
    throw error;
  }
  await settled(host, ctx.settleMs);
  const problems = timeline(host).filter((f) => f.status === 'error' || f.status === 'warning');
  const model = host.model.getState();
  return json({
    done: `Agent: ${label}`,
    ...(summary !== undefined && { result: summary }),
    ...(model.status === 'failed' && { recomputeFailed: model.error }),
    problems,
  });
}

/** The feature `id`, or a refusal naming it. */
function featureOf(doc: ExtrudoDocument, id: string): Feature {
  const feature = doc.features.find((f) => f.id === id || f.name === id);
  if (!feature) throw new CommandError(`There is no feature "${id}".`);
  return feature;
}

/** A shape's text-to-mm guess for drawing; the dimension sets the real size. */
function drawnSize(value: string | number, fallback: number): number {
  if (typeof value === 'number') return value;
  const plain = /^\s*(\d+(?:\.\d+)?)\s*(mm)?\s*$/.exec(value);
  return plain?.[1] ? Number(plain[1]) : fallback;
}

function drawShape(k: SketchBuilder, shape: SketchShape): void {
  const dimensionRect = (r: RectangleHandle, width?: string | number, height?: string | number) => {
    if (width !== undefined) k.dimension(r.bottom, width);
    if (height !== undefined) k.dimension(r.edges[1], height);
  };
  switch (shape.shape) {
    case 'rectangle':
      dimensionRect(k.rectangle(shape.from, shape.to), shape.width, shape.height);
      return;
    case 'centeredRectangle':
      dimensionRect(k.rectangleCentered(shape.center, shape.corner), shape.width, shape.height);
      return;
    case 'circle': {
      const circle = k.circle(shape.center, drawnSize(shape.diameter, 10) / 2);
      k.dimension(circle, shape.diameter);
      return;
    }
    case 'line':
      k.line(shape.from, shape.to);
      return;
    case 'polyline':
      k.polyline(
        shape.closed ? [...shape.points, shape.points[0] as [number, number]] : shape.points,
      );
      return;
    case 'arc':
      k.arc(shape.start, shape.end, shape.through);
      return;
    case 'slot':
      k.slot(shape.from, shape.to, shape.width);
  }
}

/**
 * What `build` adds to a design of the open document goes into the open
 * design: new parameters first, then the features re-minted (fresh IDs, the
 * app's names, references among them rewritten) at the marker, through the
 * shell's `apply` so the sketches among them are solved. Returns the new IDs
 * in the order `build` made the features.
 */
function insertFromApi(host: AgentHost, build: (d: Design) => void, name?: string): FeatureId[] {
  const { doc } = host.store.getState();
  const d = Design.from(doc);
  build(d);
  const after = d.toJSON();
  const oldFeatures = new Set(doc.features.map((f) => f.id));
  const oldParameters = new Set(doc.parameters.map((p) => p.id));
  const added = after.features.filter((f) => !oldFeatures.has(f.id));
  const parameters = after.parameters.filter((p) => !oldParameters.has(p.id));
  const fresh = added.map(() => newId<FeatureId>());
  // Re-minting gives the app's names; a name the agent asked for stays when it is free.
  const taken = new Set(doc.features.map((f) => f.name));
  const features = remintFeatures(added, doc, fresh).map((f, i) =>
    withActiveComponent(
      name !== undefined && added[i]?.name === name && !taken.has(name) ? { ...f, name } : f,
      host.session,
    ),
  );
  const commands: Command<unknown>[] = [
    ...parameters.map((parameter) => addParameter({ parameter }) as Command<unknown>),
    ...features.map((feature) => insertFeature({ feature }) as Command<unknown>),
  ];
  if (commands.length > 0) host.apply(commands);
  return fresh;
}

/**
 * The one shorthand inputs may use: `{ edgeBetween: [face, face] }` is the edge
 * between two faces by their persistent names, `{ kind: 'edge', id: 'e[…]' }`
 * with the names sorted as the kernel names it (ADR-0005).
 */
export function expandShorthands(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(expandShorthands);
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value);
  const [first] = entries;
  if (entries.length === 1 && first?.[0] === 'edgeBetween' && Array.isArray(first[1])) {
    const faces = first[1];
    if (faces.length >= 2 && faces.every((f) => typeof f === 'string')) {
      return { kind: 'edge', id: edgeName(faces as string[]) };
    }
  }
  return Object.fromEntries(entries.map(([key, inner]) => [key, expandShorthands(inner)]));
}

const nameOf = (host: AgentHost, id: FeatureId) =>
  host.store.getState().doc.features.find((f) => f.id === id)?.name;

// --- The tools -----------------------------------------------------------------

type Handler<T extends ToolName> = (
  input: ToolInput<T>,
  ctx: AgentContext,
  host: AgentHost | undefined,
) => Promise<AgentReply> | AgentReply;

/** `host` is defined for every tool but list_designs, new_design, open_design and get_skill. */
const need = (host: AgentHost | undefined): AgentHost => host as AgentHost;

const HANDLERS: { [T in ToolName]: Handler<T> } = {
  list_designs: async (_input, ctx, host) =>
    json(
      (await ctx.designs())
        .filter((p) => !p.trashed)
        .map((p) => ({
          id: p.id,
          name: p.name,
          modified: new Date(p.modified).toISOString(),
          ...(p.id === host?.designId && { open: true }),
        })),
    ),
  new_design: async ({ name }, ctx) => json(designSummary(await ctx.open(await ctx.create(name)))),
  open_design: async ({ id }, ctx) => {
    const designs = await ctx.designs();
    if (!designs.some((p) => p.id === id && !p.trashed)) {
      return failure(`There is no design "${id}": list_designs lists them.`);
    }
    const host = await ctx.open(id);
    return json(designSummary(host));
  },
  get_design: (_input, _ctx, host) => json(designSummary(need(host))),
  get_document: (_input, _ctx, host) => json(need(host).store.getState().doc),
  get_feature: ({ id }, _ctx, host) => {
    const found = featureDetail(need(host), id);
    return found ? json(found) : failure(`There is no feature "${id}".`);
  },
  get_bodies: async (_input, ctx, host) => {
    await settled(need(host), ctx.settleMs);
    return json(await need(host).bodies());
  },
  get_selection: (_input, _ctx, host) => json(need(host).session.getState().selection),
  screenshot: async (_input, ctx, host) => {
    await ctx.screenshotTurn();
    await settled(need(host), ctx.settleMs);
    return screenshot(need(host));
  },
  list_commands: (_input, _ctx, host) =>
    json(
      need(host)
        .commands()
        .filter(({ id }) => agentMayRun(id))
        .map(({ id, label, group, unavailable }) => ({
          id,
          label,
          group,
          ...(unavailable && { unavailable }),
        })),
    ),
  set_parameter: ({ name, expression }, ctx, host) => {
    const h = need(host);
    return change(ctx, h, `Set ${name}`, () => {
      const existing = h.store.getState().doc.parameters.find((p) => p.name === name);
      if (existing) {
        h.apply([
          updateParameter({ id: existing.id, changes: { expression } }) as Command<unknown>,
        ]);
        return { parameter: name, expression };
      }
      insertFromApi(h, (d) => d.parameter(name, expression));
      return { parameter: name, expression, created: true };
    });
  },
  apply_configuration: ({ configuration }, ctx, host) => {
    const h = need(host);
    const { doc } = h.store.getState();
    const found = (doc.configurations ?? []).find(
      (c) => c.id === configuration || c.name === configuration,
    );
    if (!found) return failure(`There is no configuration "${configuration}".`);
    return change(ctx, h, `Apply ${found.name}`, () => {
      const changes = configurationChanges(doc, found.id as ConfigurationId);
      if (changes.length > 0) h.apply([setParameterExpressions({ changes }) as Command<unknown>]);
      return { configuration: found.name, changed: changes.length };
    });
  },
  add_sketch: ({ plane, shapes, name }, ctx, host) => {
    const h = need(host);
    return change(ctx, h, `Add ${name ?? 'sketch'}`, () => {
      const [id] = insertFromApi(
        h,
        (d) => {
          const on = typeof plane === 'string' ? d.origin[plane] : (plane as GeomRef);
          const draw = (k: SketchBuilder) => {
            for (const shape of shapes) drawShape(k, shape);
          };
          d.sketch(on, draw, name ? { name } : {});
        },
        name,
      );
      const sketch = Design.from(h.store.getState().doc).feature(id as FeatureId) as SketchHandle;
      return { id, name: nameOf(h, id as FeatureId), profiles: sketch.profiles() };
    });
  },
  add_feature: ({ type, inputs, name }, ctx, host) => {
    const h = need(host);
    if (type === 'sketch') return failure('Use add_sketch to add a sketch.');
    return change(ctx, h, `Add ${type}`, () => {
      const ids = insertFromApi(
        h,
        (d) => {
          d.add(type, expandShorthands(inputs) as never, name ? { name } : {});
        },
        name,
      );
      return ids.map((id) => ({ id, name: nameOf(h, id) }));
    });
  },
  edit_feature: ({ id, inputs }, ctx, host) => {
    const h = need(host);
    const { doc } = h.store.getState();
    const feature = doc.features.find((f) => f.id === id);
    if (!feature) return failure(`There is no feature "${id}".`);
    if (feature.type === 'sketch') {
      return failure("A sketch's shapes can't be edited here: change its dimensions' parameters.");
    }
    return change(ctx, h, `Edit ${feature.name}`, () => {
      // The feature's own schema checks the merged inputs on a scratch copy.
      const scratch = Design.from(doc);
      // An expression input that names a model parameter (`d17`) keeps the name, so
      // whatever reads it still resolves.
      const changed = expandShorthands(inputs) as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...feature.inputs, ...changed };
      for (const [key, value] of Object.entries(changed)) {
        const old = feature.inputs[key];
        if (old?.kind === 'expr' && old.paramName !== undefined && typeof value !== 'object') {
          merged[key] = { expr: String(value), paramName: old.paramName };
        }
      }
      const handle: FeatureHandle = scratch.add(feature.type, merged as never, {
        name: feature.name,
      });
      const checked = scratch.find(handle.id)?.inputs;
      if (!checked) throw new CommandError(`Couldn't edit ${feature.name}.`);
      h.apply([
        updateFeatureInputs({ id: feature.id, inputs: checked, replace: true }) as Command<unknown>,
      ]);
      return { id: feature.id, name: feature.name };
    });
  },
  suppress: ({ id, on }, ctx, host) => {
    const h = need(host);
    return change(ctx, h, `${on ? 'Suppress' : 'Unsuppress'} ${id}`, () => {
      const feature = featureOf(h.store.getState().doc, id);
      h.store.getState().dispatch(setFeatureSuppressed({ id: feature.id, suppressed: on }));
      return { id: feature.id, name: feature.name, suppressed: on };
    });
  },
  rename: ({ id, name }, ctx, host) => {
    const h = need(host);
    return change(ctx, h, `Rename ${id}`, () => {
      const feature = featureOf(h.store.getState().doc, id);
      h.store.getState().dispatch(renameFeature({ id: feature.id, name }));
      return { id: feature.id, name };
    });
  },
  remove: ({ id }, ctx, host) => {
    const h = need(host);
    return change(ctx, h, `Delete ${id}`, () => {
      const feature = featureOf(h.store.getState().doc, id);
      h.store.getState().dispatch(removeFeature({ id: feature.id }));
      return { id: feature.id, name: feature.name };
    });
  },
  run_command: async ({ id }, ctx, host) => {
    const h = need(host);
    if (!agentMayRun(id)) return failure(NOT_FOR_AGENTS);
    const command = h.commands().find((c) => c.id === id);
    if (!command) return failure(`There is no command "${id}": list_commands lists them.`);
    if (command.unavailable) return failure(`${command.label}: ${command.unavailable}`);
    // The agent's own step would undo nothing: the undo and redo tools do it.
    if (UNDO_COMMANDS.has(command.id)) return failure(`Use the ${command.id} tool for that.`);
    const { store, session } = h;
    if (store.getState().transactionDepth > 0 || session.getState().mode === 'sketch') {
      return failure(BUSY);
    }
    await h.ready();
    // Outside any agent transaction: a command is undoable on its own, and one that
    // opens a dialog or a sketch begins its own step, which an agent step around it
    // would swallow (UndoHistory commits the innermost level).
    command.run();
    if (store.getState().transactionDepth > 0 || session.getState().mode === 'sketch') {
      return json({
        command: command.id,
        opened: command.label,
        message: `${command.label} opened in the app: finish it there, or ask the person to; change tools are refused until then.`,
      });
    }
    await settled(h, ctx.settleMs);
    return json({
      done: command.label,
      problems: timeline(h).filter((f) => f.status === 'error' || f.status === 'warning'),
    });
  },
  undo: async (_input, ctx, host) => {
    const h = need(host);
    const label = h.store.getState().undoLabel;
    if (!label) return failure('There is nothing to undo.');
    if (h.store.getState().transactionDepth > 0 || h.session.getState().mode === 'sketch') {
      return failure(BUSY);
    }
    h.undo();
    await settled(h, ctx.settleMs);
    return json({ undone: label, problems: timeline(h).filter((f) => f.status === 'error') });
  },
  redo: async (_input, ctx, host) => {
    const h = need(host);
    const label = h.store.getState().redoLabel;
    if (!label) return failure('There is nothing to redo.');
    if (h.store.getState().transactionDepth > 0 || h.session.getState().mode === 'sketch') {
      return failure(BUSY);
    }
    h.redo();
    await settled(h, ctx.settleMs);
    return json({ redone: label, problems: timeline(h).filter((f) => f.status === 'error') });
  },
  save: async (_input, _ctx, host) => {
    await need(host).save();
    return text(`Saved ${need(host).store.getState().doc.name}.`);
  },
  export: async ({ format }, ctx, host) => {
    const h = need(host);
    await ctx.exportTurn();
    await settled(h, ctx.settleMs);
    const bytes = await h.exportModel(format as AgentExportFormat);
    const design = h.store.getState().doc.name;
    return {
      result: {
        content: [{ type: 'text', text: `Exported ${design} as ${format.toUpperCase()}.` }],
      },
      file: { design, format: format as AgentExportFormat, bytes },
    };
  },
  // Main answers get_skill from the skill it serves; this is the web's fallback.
  get_skill: () => failure('The skill is served by the desktop app.'),
};

/** Runs one tool call: checks its input, then the design, then the tool. */
export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<AgentReply> {
  if (!(name in TOOL_SCHEMAS)) return failure(`Unknown tool: ${name}`);
  const tool = name as ToolName;
  const parsed = TOOL_SCHEMAS[tool].input.safeParse(args);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    return failure(`${path}${issue?.message ?? 'Bad input.'}`);
  }
  const host = ctx.host();
  const needsDesign = !['list_designs', 'new_design', 'open_design', 'get_skill'].includes(tool);
  if (needsDesign && !host) {
    return failure(NO_DESIGN);
  }
  try {
    return await (HANDLERS[tool] as Handler<ToolName>)(parsed.data as never, ctx, host);
  } catch (error) {
    const message = refusal(error);
    if (message !== undefined) return failure(message);
    return failure(error instanceof Error ? error.message : String(error));
  }
}
