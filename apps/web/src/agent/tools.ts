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
  type PointHandle,
  type RectangleHandle,
  type SketchBuilder,
  type SketchHandle,
  type Vec2,
} from '@extrudo/api';
import {
  type Annotation,
  type AnnotationAnchor,
  type AnnotationId,
  addAnnotation,
  addParameter,
  annotationAnchorProblem,
  annotationByNumber,
  annotationEntityPoint,
  type ClearableBodyField,
  type Command,
  CommandError,
  type ConfigurationId,
  configurationChanges,
  type ExtrudoDocument,
  evaluateParameters,
  type Feature,
  type FeatureId,
  type FeatureInputs,
  type GeomRef,
  insertFeature,
  moveAnnotation,
  newId,
  nextAnnotationNumber,
  planeFrame,
  readSketch,
  remintFeatures,
  removeAnnotation,
  removeFeature,
  renameDocument,
  renameFeature,
  type SketchEntityId,
  setFeatureSuppressed,
  setParameterExpressions,
  sketchEntityRefId,
  updateAnnotation,
  updateBody,
  updateFeatureInputs,
  updateParameter,
} from '@extrudo/core';
import type { ProjectSummary } from '@extrudo/storage';
import {
  type AnnotationRef,
  fingerprintedAnchor,
  placedNow,
  type Vec3,
} from '../annotations/anchor';
import { withActiveComponent } from '../components/active';
import type { AgentExportFormat, AgentReply } from '../platform/agent';
import { bodyEntries } from '../shell/bodies';
import type { SnapshotOptions } from '../viewport/snapshotView';
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
  'insertDesign',
  'checkForUpdates',
  'openSettings',
  'customizeMarkingMenu',
  'plugins',
  'about',
  'whatsNew',
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
    ...((doc.annotations ?? []).length > 0 && {
      annotations: annotationsInOrder(doc).map((a) => {
        const line = a.text.split('\n')[0] ?? '';
        return {
          number: a.number,
          text: line.length > 80 ? `${line.slice(0, 79)}…` : line,
          status: readableAnchor(host, a).status,
          ...(a.done && { done: true }),
        };
      }),
    }),
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

const round3 = (n: number) => Math.round(n * 1000) / 1000 + 0;

/**
 * Each of a sketch's profiles as an agent tells them apart (#85), in the order
 * of `profiles()`: its reference, area (mm²), box and centroid in sketch
 * coordinates, the curves of its outer loop and of each hole, and, for a sketch
 * `add_sketch` just drew, the indices of the shapes whose curves bound it.
 */
export function regionsOf(sketch: SketchHandle, shapeCurves?: readonly (readonly string[])[]) {
  const refs = sketch.profiles();
  return sketch.regions.map((region, i) => {
    const xs = region.outer.polygon.map((p) => p[0]);
    const ys = region.outer.polygon.map((p) => p[1]);
    // The centroid of the outer loop less the holes: their signed areas weigh them.
    let area = 0;
    let cx = 0;
    let cy = 0;
    for (const loop of [region.outer, ...region.holes]) {
      const pts = loop.polygon;
      for (let j = 0; j < pts.length; j++) {
        const [x0, y0] = pts[j] as readonly [number, number];
        const [x1, y1] = pts[(j + 1) % pts.length] as readonly [number, number];
        const cross = x0 * y1 - x1 * y0;
        area += cross / 2;
        cx += ((x0 + x1) * cross) / 6;
        cy += ((y0 + y1) * cross) / 6;
      }
    }
    const curvesOf = (loop: typeof region.outer) => [...new Set(loop.edges.map((e) => e.curve))];
    const outer = curvesOf(region.outer);
    const holes = region.holes.map(curvesOf);
    const bounding = new Set<string>([...outer, ...holes.flat()]);
    const shapes = shapeCurves
      ?.map((curves, index) => (curves.some((c) => bounding.has(c)) ? index : -1))
      .filter((index) => index >= 0);
    return {
      profile: refs[i] as GeomRef,
      area: round3(region.area),
      box: {
        min: [round3(Math.min(...xs)), round3(Math.min(...ys))],
        max: [round3(Math.max(...xs)), round3(Math.max(...ys))],
      },
      ...(area !== 0 && { centroid: [round3(cx / area), round3(cy / area)] }),
      outer,
      holes,
      ...(shapes && { shapes }),
    };
  });
}

/**
 * A sketch's frame in world coordinates (mm), as the kernel reported it on the
 * last recompute (a face's frame follows the face), or the plane's own frame
 * when it can be known without the kernel; `undefined` while neither is (#86).
 */
function sketchFrame(host: AgentHost, id: FeatureId, plane: GeomRef | undefined) {
  const model = host.model.getState();
  const frame =
    model.sketches[id]?.frame ?? (plane ? planeFrame(plane, model.construction) : undefined);
  if (!frame) return undefined;
  const r = (v: readonly number[]) => v.map(round3);
  return { origin: r(frame.origin), xDir: r(frame.x), yDir: r(frame.y), normal: r(frame.normal) };
}

function featureDetail(host: AgentHost, id: string) {
  const { doc } = host.store.getState();
  const feature = doc.features.find((f) => f.id === id);
  if (!feature) return undefined;
  const status = timeline(host).find((f) => f.id === id);
  // A Mesh to Solid's report (ADR-0097 §4) goes out as the status has it.
  const meshToSolid = host.model.getState().features[feature.id]?.meshToSolid;
  const base = {
    id: feature.id,
    type: feature.type,
    name: feature.name,
    status: status?.status,
    ...(status?.message && { message: status.message }),
    ...(meshToSolid && { meshToSolid }),
    suppressed: feature.suppressed,
  };
  if (feature.type === 'sketch') {
    const sketch = Design.from(doc).feature(feature.id) as SketchHandle;
    const curves = Object.entries(sketch.data.entities)
      .filter(([, entity]) => entity.type !== 'point')
      .map(([curve, entity]) => ({
        id: curve,
        type: entity.type,
        // What a revolve's axis or any curve input takes.
        ref: {
          kind: 'sketchEntity',
          id: sketchEntityRefId(feature.id, curve as SketchEntityId),
        },
      }));
    const frame = sketchFrame(host, feature.id, sketch.plane);
    return {
      ...base,
      plane: sketch.plane,
      ...(frame && { frame }),
      profiles: sketch.profiles(),
      regions: regionsOf(sketch),
      curves,
    };
  }
  return {
    ...base,
    inputs: Object.fromEntries(
      Object.entries(feature.inputs).map(([name, input]) => [name, plainInput(input)]),
    ),
  };
}

async function screenshot(
  host: AgentHost,
  size = 768,
  options?: SnapshotOptions,
): Promise<AgentReply> {
  const png = await host.snapshot(size, options);
  if (!png) {
    return failure(
      options?.bodies
        ? 'None of those bodies is shown: get_bodies says which are visible.'
        : "The 3D view isn't drawn yet: try again in a moment.",
    );
  }
  const bytes = new Uint8Array(await png.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return { result: { content: [{ type: 'image', data: btoa(binary), mimeType: 'image/png' }] } };
}

// --- Annotations (ADR-0126 §8) ---------------------------------------------------

/** Open notes by number, then the ticked-off ones. */
function annotationsInOrder(doc: ExtrudoDocument): Annotation[] {
  return [...(doc.annotations ?? [])].sort(
    (a, b) => Number(a.done ?? false) - Number(b.done ?? false) || a.number - b.number,
  );
}

const round3s = (v: readonly number[]) => v.map(round3);

/**
 * Where an annotation is, as an agent reads it: its status and point, and the
 * names of what it is on, ready to paste into a feature's references.
 */
function readableAnchor(host: AgentHost, annotation: Annotation) {
  const { anchor } = annotation;
  if (anchor.kind === 'free') return { kind: 'free', status: 'ok', at: round3s(anchor.at) };
  const { doc } = host.store.getState();
  if (anchor.kind === 'sketch') {
    const feature = doc.features.find((f) => f.id === anchor.sketch);
    const data = feature ? readSketch(feature)?.data : undefined;
    const base =
      anchor.entity === undefined || !data ? undefined : annotationEntityPoint(data, anchor.entity);
    return {
      kind: 'sketch',
      status: 'ok',
      at: round3s(base ? [base[0] + anchor.at[0], base[1] + anchor.at[1]] : anchor.at),
      sketch: anchor.sketch,
      ...(anchor.entity !== undefined && {
        sketchEntity: sketchEntityRefId(anchor.sketch, anchor.entity),
      }),
    };
  }
  const model = host.model.getState();
  const report = model.annotations[annotation.id];
  const ref = report?.resolved?.ref ?? anchor.ref;
  const maker = ref.kind === 'face' ? ref.id.split(':')[1] : undefined;
  return {
    kind: 'model',
    status: report?.status ?? 'pending',
    at: round3s(report?.at ?? anchor.at),
    ...(report?.normal && { normal: round3s(report.normal) }),
    [ref.kind]: ref.id,
    ...(report?.resolved?.body !== undefined && { body: report.resolved.body }),
    ...(maker !== undefined && doc.features.some((f) => f.id === maker) && { feature: maker }),
  };
}

/** An annotation as list_annotations answers it. */
function readableAnnotation(host: AgentHost, annotation: Annotation) {
  return {
    number: annotation.number,
    text: annotation.text,
    done: annotation.done ?? false,
    hidden: annotation.hidden ?? false,
    anchor: readableAnchor(host, annotation),
  };
}

type AgentAnchor = ToolInput<'add_annotation'>['anchor'];

/** The geometry keys of an agent's anchor and the reference kind each names. */
const ANCHOR_KINDS = {
  face: 'face',
  edge: 'edge',
  edgeBetween: 'edge',
  vertex: 'vertex',
  body: 'body',
  sketchEntity: 'sketchEntity',
  plane: 'plane',
  axis: 'axis',
  point: 'point',
} as const;

/** The anchors that need the bodies at the marker (the others are origin, construction or sketch geometry). */
const ON_BODIES: ReadonlySet<string> = new Set(['face', 'edge', 'edgeBetween', 'vertex', 'body']);

/**
 * An agent's anchor as stored (ADR-0126 §8): a name resolved in the model at
 * the marker, kept with its current name and fingerprint, or a sketch or free
 * point checked against the document. Anything that doesn't resolve is refused
 * with its input path before anything changes.
 */
async function storedAnchor(
  ctx: AgentContext,
  host: AgentHost,
  anchor: AgentAnchor,
): Promise<AnnotationAnchor> {
  const { doc } = host.store.getState();
  if ('sketch' in anchor) {
    const feature = doc.features.find(
      (f) => f.type === 'sketch' && (f.id === anchor.sketch || f.name === anchor.sketch),
    );
    if (!feature) throw new CommandError(`anchor.sketch: There is no sketch "${anchor.sketch}".`);
    const stored: AnnotationAnchor = {
      kind: 'sketch',
      sketch: feature.id,
      at: anchor.at,
      ...(anchor.entity !== undefined && { entity: anchor.entity as SketchEntityId }),
    };
    const problem = annotationAnchorProblem(doc, stored);
    if (problem) throw new CommandError(`anchor.entity: ${problem}`);
    return stored;
  }
  const key = (Object.keys(ANCHOR_KINDS) as (keyof typeof ANCHOR_KINDS)[]).find((k) => k in anchor);
  if (key === undefined) return { kind: 'free', at: (anchor as { at: Vec3 }).at };
  const given = (anchor as Record<string, unknown>)[key];
  const at = (anchor as { at?: Vec3 }).at;
  await settled(host, ctx.settleMs);
  const live = liveBodies(host);
  if (!live && ON_BODIES.has(key)) {
    throw new CommandError("The model isn't computed: check get_design's problems first.");
  }
  let ref: AnnotationRef =
    key === 'edgeBetween'
      ? { kind: 'edge', id: edgeName(given as string[]) }
      : { kind: ANCHOR_KINDS[key], id: given as string };
  if (key === 'body' && live) {
    ref = (resolveBodyRefs({ body: ref }, live, doc, ['anchor']) as { body: AnnotationRef }).body;
  }
  const stored = await fingerprintedAnchor((a) => host.resolveAnnotation(a), ref, at);
  if (!stored)
    throw new CommandError("The model isn't computed: check get_design's problems first.");
  if (stored === 'detached') {
    const what = key === 'edgeBetween' ? 'edge between' : key;
    const named = key === 'edgeBetween' ? (given as string[]).join(' and ') : `"${given}"`;
    // The input's path, built so it never reads as a preference key (settings inventory).
    const path = ['anchor', key].join('.');
    throw new CommandError(
      `${path}: There is no ${what} ${named} in the model at the timeline marker: get_feature and list_annotations give names.`,
    );
  }
  return stored;
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
  /** The step's name; a function is read once the step can begin (after `ready`). */
  label: string | (() => string),
  body: () => unknown,
  /** Adds to the summary what is known only once the model is computed. */
  after?: (summary: unknown) => unknown,
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
  const name = typeof label === 'function' ? label() : label;
  store.getState().beginTransaction(`Agent: ${name}`);
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
  if (after) summary = after(summary);
  const problems = timeline(host).filter((f) => f.status === 'error' || f.status === 'warning');
  const model = host.model.getState();
  return json({
    done: `Agent: ${name}`,
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

/** A length given as a number of mm or '<n> mm'; undefined for anything else. */
function millimetres(value: string | number): number | undefined {
  if (typeof value === 'number') return value;
  const plain = /^\s*(-?\d+(?:\.\d+)?)\s*(mm)?\s*$/.exec(value);
  return plain?.[1] ? Number(plain[1]) : undefined;
}

/**
 * Draws `add_sketch`'s shapes. A coordinate or size given as an expression is
 * evaluated to draw, then kept as a dimension, so it follows its parameters
 * (#103): a coordinate as a horizontal or vertical distance from a fixed point
 * at the sketch origin, added with the first one. Plain numbers stay as drawn.
 */
function shapeDrawer(k: SketchBuilder, doc: ExtrudoDocument) {
  const evaluation = evaluateParameters(doc);
  let origin: PointHandle | undefined;
  const length = (value: string | number, path: string): number => {
    const plain = millimetres(value);
    if (plain !== undefined) return plain;
    const result = evaluation.evaluate(String(value), 'length');
    if (!result.ok) throw new ApiError(result.error.message, { path });
    return result.value;
  };
  return (shape: SketchShape, index: number): void => {
    // An input's path for a refusal, e.g. shapes.0.from.1.
    const path = (...parts: (string | number)[]) => ['shapes', index, ...parts].join('.');
    const kept: { at: Vec2; axis: 0 | 1; expr: string }[] = [];
    /** A point to draw at; `keep` keeps its expressions as dimensions. */
    const at = (p: SketchPoint, name: Name, keep = true): Vec2 => {
      const point: Vec2 = [
        length(p[0], path(...[name].flat(), 0)),
        length(p[1], path(...[name].flat(), 1)),
      ];
      for (const axis of [0, 1] as const) {
        if (keep && millimetres(p[axis]) === undefined) {
          kept.push({ at: point, axis, expr: String(p[axis]) });
        }
      }
      return point;
    };
    const before = new Set(Object.keys(k.data.entities));
    drawShape(k, shape, at, (value, name) => length(value, path(name)));
    // Each kept coordinate dimensions the shape's first new point drawn there.
    const done = new Set<string>();
    for (const { at: p, axis, expr } of kept) {
      const point = Object.entries(k.data.entities).find(
        ([id, e]) =>
          !before.has(id) &&
          e.type === 'point' &&
          Math.abs(e.x - p[0]) < 1e-6 &&
          Math.abs(e.y - p[1]) < 1e-6,
      )?.[0];
      if (!point || done.has(`${point}:${axis}`)) continue;
      done.add(`${point}:${axis}`);
      if (!origin) {
        origin = k.point([0, 0]);
        k.fix(origin);
      }
      // Dimensions are unsigned: the side comes from where the point is drawn.
      k.distance([origin, point], p[axis] < 0 ? `-(${expr})` : expr, {
        orientation: axis === 0 ? 'horizontal' : 'vertical',
      });
    }
  };
}

type SketchPoint = readonly [string | number, string | number];
/** Where an input sits in a shape: `'from'`, or `['points', 2]`. */
type Name = string | readonly (string | number)[];

function drawShape(
  k: SketchBuilder,
  shape: SketchShape,
  at: (p: SketchPoint, name: Name, keep?: boolean) => Vec2,
  length: (value: string | number, name: string) => number,
): void {
  const dimensionRect = (r: RectangleHandle, width?: string | number, height?: string | number) => {
    if (width !== undefined) k.dimension(r.bottom, width);
    if (height !== undefined) k.dimension(r.edges[1], height);
  };
  switch (shape.shape) {
    case 'rectangle':
      dimensionRect(
        k.rectangle(at(shape.from, 'from'), at(shape.to, 'to')),
        shape.width,
        shape.height,
      );
      return;
    case 'centeredRectangle':
      dimensionRect(
        k.rectangleCentered(at(shape.center, 'center'), at(shape.corner, 'corner')),
        shape.width,
        shape.height,
      );
      return;
    case 'circle': {
      const circle = k.circle(at(shape.center, 'center'), length(shape.diameter, 'diameter') / 2);
      k.dimension(circle, shape.diameter);
      return;
    }
    case 'line':
      k.line(at(shape.from, 'from'), at(shape.to, 'to'));
      return;
    case 'polyline': {
      const points = shape.points.map((p, i) => at(p, ['points', i]));
      const chain = k.polyline(shape.closed ? [...points, points[0] as Vec2] : points);
      // Closed for good: the last end stays on the first start when they move.
      if (shape.closed) {
        k.coincident(chain.lines.at(-1)?.end as PointHandle, chain.points[0] as PointHandle);
      }
      return;
    }
    case 'arc':
      k.arc(at(shape.start, 'start'), at(shape.end, 'end'), at(shape.through, 'through', false));
      return;
    case 'slot': {
      const slot = k.slot(at(shape.from, 'from'), at(shape.to, 'to'), length(shape.width, 'width'));
      if (millimetres(shape.width) === undefined) k.distance(slot.lines, shape.width);
    }
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

/**
 * The bodies at the marker, once the model is computed for the document as it
 * is; `undefined` while it isn't (no kernel, a failed recompute), when body
 * references go to the feature unchecked and its status says what is wrong.
 */
function liveBodies(host: AgentHost): ReadonlySet<string> | undefined {
  const model = host.model.getState();
  if (model.status !== 'ready' || model.doc !== host.store.getState().doc) return undefined;
  return new Set(Object.keys(model.bodies));
}

/**
 * Body references as the kernel names bodies, `<feature id>:<n>` (ADR-0030):
 * a bare feature id (or name) stands for the one body that feature made, and
 * a body that isn't there is refused with the input's path, so a mistaken
 * reference changes nothing instead of adding a feature in error (#84).
 */
export function resolveBodyRefs(
  value: unknown,
  live: ReadonlySet<string>,
  doc: ExtrudoDocument,
  path: readonly (string | number)[] = [],
): unknown {
  if (Array.isArray(value)) return value.map((v, i) => resolveBodyRefs(v, live, doc, [...path, i]));
  if (value === null || typeof value !== 'object') return value;
  const ref = value as { kind?: unknown; id?: unknown };
  if (ref.kind === 'body' && typeof ref.id === 'string') {
    if (live.has(ref.id)) return value;
    const at = path.length > 0 ? `${path.join('.')}: ` : '';
    const feature = doc.features.find((f) => f.id === ref.id || f.name === ref.id);
    const made = feature ? [...live].filter((b) => b.startsWith(`${feature.id}:`)) : [];
    if (made.length === 1) return { ...value, id: made[0] };
    if (made.length > 1) {
      throw new CommandError(
        `${at}${feature?.name} made ${made.length} bodies: name one, ${made.join(', ')}.`,
      );
    }
    throw new CommandError(
      `${at}There is no body "${ref.id}": bodies are named <feature id>:<n>, and get_bodies lists them.`,
    );
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [
      key,
      resolveBodyRefs(inner, live, doc, [...path, key]),
    ]),
  );
}

/** An agent's inputs as the API takes them: shorthands expanded, body references checked. */
function agentInputs(host: AgentHost, inputs: Record<string, unknown>): Record<string, unknown> {
  const expanded = expandShorthands(inputs) as Record<string, unknown>;
  const live = liveBodies(host);
  return live
    ? (resolveBodyRefs(expanded, live, host.store.getState().doc) as Record<string, unknown>)
    : expanded;
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
  rename_design: async ({ name }, ctx, host) => {
    const h = need(host);
    const reply = await change(ctx, h, 'Rename design', () => {
      h.store.getState().dispatch(renameDocument({ name }));
      return { name: h.store.getState().doc.name };
    });
    // Saved now, so list_designs (the saved designs) shows the new name.
    if (!reply.result.isError) await h.save();
    return reply;
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
  check_interference: async ({ bodies }, ctx, host) => {
    const h = need(host);
    await settled(h, ctx.settleMs);
    const live = liveBodies(h);
    if (!live) return failure("The model isn't computed: check get_design's problems first.");
    const { doc } = h.store.getState();
    const model = h.model.getState();
    const ids = bodies
      ? (resolveBodyRefs({ bodies }, live, doc) as { bodies: GeomRef[] }).bodies.map((b) => b.id)
      : bodyEntries(doc, model.bodies, model.origins)
          .filter((e) => e.display !== 'hidden')
          .map((e) => e.id);
    const found = await h.interference([...new Set(ids)]);
    const r = (v: readonly number[]) => v.map(round3);
    return json(
      found.map(({ a, b, volume, box }) => ({
        a,
        b,
        volume: round3(volume),
        box: { min: r(box.min), max: r(box.max) },
      })),
    );
  },
  get_selection: (_input, _ctx, host) => json(need(host).session.getState().selection),
  screenshot: async ({ view, bodies, section, overlays, annotations, size }, ctx, host) => {
    const h = need(host);
    await ctx.screenshotTurn();
    await settled(h, ctx.settleMs);
    const options: SnapshotOptions = {
      ...(view !== undefined && { view }),
      ...(overlays !== undefined && { overlays }),
    };
    if (bodies) {
      const live = liveBodies(h);
      if (!live) return failure("The model isn't computed: check get_design's problems first.");
      const { doc } = h.store.getState();
      options.bodies = (resolveBodyRefs({ bodies }, live, doc) as { bodies: GeomRef[] }).bodies.map(
        (b) => b.id,
      );
    }
    if (section) {
      const ref: GeomRef =
        typeof section.plane === 'string'
          ? { kind: 'plane', id: `origin:${section.plane}` }
          : (section.plane as GeomRef);
      const frame = planeFrame(ref, h.model.getState().construction);
      if (!frame) return failure('section.plane: give an origin plane or a construction plane.');
      const offset = millimetres(section.offset ?? 0);
      if (offset === undefined) return failure("section.offset: a number of mm or '10 mm'.");
      const n = frame.normal;
      options.section = {
        origin: [
          frame.origin[0] + n[0] * offset,
          frame.origin[1] + n[1] * offset,
          frame.origin[2] + n[2] * offset,
        ],
        normal: n,
      };
    }
    if (annotations) {
      // Every note that isn't hidden, whatever the person's eye says: the agent asked.
      const { doc } = h.store.getState();
      options.marks = placedNow(doc, h.model.getState(), h.openSketch?.())
        .filter((p) => !p.annotation.hidden)
        .map((p) => ({
          at: p.at,
          number: p.annotation.number,
          look: p.status === 'detached' ? 'hollow' : p.annotation.done ? 'muted' : 'solid',
        }));
    }
    const plain = Object.keys(options).length === 0;
    return screenshot(h, size, plain ? undefined : options);
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
    return change(
      ctx,
      h,
      `Add ${name ?? 'sketch'}`,
      () => {
        // The curves each shape drew, to say which shapes bound each profile.
        const shapeCurves: string[][] = [];
        const { doc } = h.store.getState();
        const [id] = insertFromApi(
          h,
          (d) => {
            const on = typeof plane === 'string' ? d.origin[plane] : (plane as GeomRef);
            const draw = (k: SketchBuilder) => {
              const drawOne = shapeDrawer(k, doc);
              for (const [index, shape] of shapes.entries()) {
                const before = new Set(Object.keys(k.data.entities));
                drawOne(shape, index);
                shapeCurves.push(
                  Object.entries(k.data.entities)
                    .filter(([curve, entity]) => !before.has(curve) && entity.type !== 'point')
                    .map(([curve]) => curve),
                );
              }
            };
            d.sketch(on, draw, name ? { name } : {});
          },
          name,
        );
        const sketch = Design.from(h.store.getState().doc).feature(id as FeatureId) as SketchHandle;
        return {
          id,
          name: nameOf(h, id as FeatureId),
          profiles: sketch.profiles(),
          regions: regionsOf(sketch, shapeCurves),
        };
      },
      (summary) => {
        // The frame, from the recompute: where sketch x and y go in the world.
        const { id } = summary as { id: FeatureId };
        const sketch = Design.from(h.store.getState().doc).feature(id) as SketchHandle;
        const frame = sketchFrame(h, id, sketch.plane);
        return { ...(summary as object), ...(frame && { frame }) };
      },
    );
  },
  add_feature: async ({ type, inputs, name }, ctx, host) => {
    const h = need(host);
    if (type === 'sketch') return failure('Use add_sketch to add a sketch.');
    // Body references are checked against the bodies the model has now.
    await settled(h, ctx.settleMs);
    return change(ctx, h, `Add ${type}`, () => {
      const ids = insertFromApi(
        h,
        (d) => {
          d.add(type, agentInputs(h, inputs) as never, name ? { name } : {});
        },
        name,
      );
      return ids.map((id) => ({ id, name: nameOf(h, id) }));
    });
  },
  edit_feature: async ({ id, inputs }, ctx, host) => {
    const h = need(host);
    await settled(h, ctx.settleMs);
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
      const changed = agentInputs(h, inputs);
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
  set_body_appearance: async ({ id, color, opacity, name, visible }, ctx, host) => {
    const h = need(host);
    await settled(h, ctx.settleMs);
    const live = liveBodies(h);
    if (!live) return failure("The model isn't computed: check get_design's problems first.");
    const { doc } = h.store.getState();
    // Keyed `id`, so a refusal reads "id: There is no body …".
    const { id: body } = resolveBodyRefs({ id: { kind: 'body', id } }, live, doc) as {
      id: GeomRef;
    };
    const model = h.model.getState();
    const entry = bodyEntries(doc, model.bodies, model.origins).find((e) => e.id === body.id);
    if (!entry) return failure(`There is no body "${id}": get_bodies lists them.`);
    return change(ctx, h, `Change ${entry.meta.name}`, () => {
      const clear: ClearableBodyField[] = [];
      if (opacity !== undefined && opacity >= 1) clear.push('opacity');
      if (visible === false) clear.push('ghost');
      h.store.getState().dispatch(
        updateBody({
          id: entry.id,
          changes: {
            // A body with no stored metadata yet gets the name it shows.
            ...(!entry.stored && { name: entry.meta.name }),
            ...(name !== undefined && { name }),
            ...(color !== undefined && { color: color.toLowerCase() }),
            ...(opacity !== undefined && opacity < 1 && { opacity }),
            ...(visible !== undefined && { visible }),
          },
          clear,
        }),
      );
      const meta = h.store.getState().doc.bodies[entry.id];
      return { id: entry.id, ...meta };
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
  list_annotations: async ({ includeDone }, ctx, host) => {
    const h = need(host);
    await settled(h, ctx.settleMs);
    return json(
      annotationsInOrder(h.store.getState().doc)
        .filter((a) => includeDone || !a.done)
        .map((a) => readableAnnotation(h, a)),
    );
  },
  add_annotation: async ({ text, anchor }, ctx, host) => {
    const h = need(host);
    const stored = await storedAnchor(ctx, h, anchor);
    const id = newId<AnnotationId>();
    // The number is read as the step begins: another change may land while it waits.
    return change(
      ctx,
      h,
      () => `Annotate #${nextAnnotationNumber(h.store.getState().doc)}`,
      () => {
        h.store.getState().dispatch(addAnnotation({ id, text, anchor: stored }));
        const number = h.store.getState().doc.annotations?.find((a) => a.id === id)?.number;
        return { number, id };
      },
    );
  },
  edit_annotation: async ({ number, text, done, hidden, anchor }, ctx, host) => {
    const h = need(host);
    const found = annotationByNumber(h.store.getState().doc, number);
    if (!found) return failure(`There is no annotation #${number}: list_annotations lists them.`);
    if (text === undefined && done === undefined && hidden === undefined && !anchor) {
      return failure('Give text, done, hidden or anchor to change.');
    }
    const stored = anchor ? await storedAnchor(ctx, h, anchor) : undefined;
    return change(
      ctx,
      h,
      `Edit #${number}`,
      () => {
        const { dispatch } = h.store.getState();
        if (text !== undefined || done !== undefined || hidden !== undefined) {
          dispatch(
            updateAnnotation({
              id: found.id,
              changes: {
                ...(text !== undefined && { text }),
                ...(done !== undefined && { done }),
                ...(hidden !== undefined && { hidden }),
              },
            }),
          );
        }
        if (stored) dispatch(moveAnnotation({ id: found.id, anchor: stored }));
        return { number };
      },
      () => {
        const now = annotationByNumber(h.store.getState().doc, number);
        return now ? readableAnnotation(h, now) : { number };
      },
    );
  },
  remove_annotation: ({ numbers }, ctx, host) => {
    const h = need(host);
    const { doc } = h.store.getState();
    const unique = [...new Set(numbers)];
    const missing = unique.filter((n) => !annotationByNumber(doc, n));
    if (missing.length > 0) {
      return failure(
        `There is no annotation ${missing.map((n) => `#${n}`).join(', ')}: list_annotations lists them.`,
      );
    }
    return change(ctx, h, `Delete ${unique.map((n) => `#${n}`).join(', ')}`, () => {
      const ids = unique.map((n) => annotationByNumber(doc, n)?.id as AnnotationId);
      h.store.getState().dispatch(removeAnnotation({ ids }));
      return { removed: unique };
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
