/**
 * What every agent tool shares (P6-08, ADR-0087 §5): the context, the answers' shapes,
 * the refusals and `change`, the one undo transaction per change. The model's tools
 * (`tools.ts`) and the sheet tools (`sheetTools.ts`) both build on it.
 */
import { ApiError } from '@extrudo/api';
import { CommandError, type ExtrudoDocument } from '@extrudo/core';
import type { ProjectSummary } from '@extrudo/storage';
import type { AgentReply } from '../platform/agent';
import { type AgentHost, settled } from './host';

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

export const text = (value: string): AgentReply => ({
  result: { content: [{ type: 'text', text: value }] },
});
export const json = (value: unknown): AgentReply => text(JSON.stringify(value, null, 2));
export const failure = (message: string): AgentReply => ({
  result: { content: [{ type: 'text', text: message }], isError: true },
});

/** An `ApiError` as an agent reads it: the input path first. */
function apiMessage(error: ApiError): string {
  return error.path ? `${error.path}: ${error.message}` : error.message;
}

/** A thrown refusal as a tool error; anything else is a bug and propagates. */
export function refusal(error: unknown): string | undefined {
  if (error instanceof ApiError) return apiMessage(error);
  if (error instanceof CommandError) return error.message;
  return undefined;
}

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

/**
 * Runs `body` as one undo step named "Agent: <label>", then waits for the
 * recompute and answers `body`'s summary with any feature that failed. A
 * refusal (`ApiError`, `CommandError`) cancels the step: nothing changes.
 */
export async function change(
  ctx: AgentContext,
  host: AgentHost,
  /** The step's name; a function is read once the step can begin (after `ready`). */
  label: string | (() => string),
  body: () => unknown,
  /** Adds to the summary what is known only once the model is computed. */
  after?: (summary: unknown) => unknown | Promise<unknown>,
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
  if (after) summary = await after(summary);
  const problems = timeline(host).filter((f) => f.status === 'error' || f.status === 'warning');
  const model = host.model.getState();
  return json({
    done: `Agent: ${name}`,
    ...(summary !== undefined && { result: summary }),
    ...(model.status === 'failed' && { recomputeFailed: model.error }),
    problems,
  });
}

/**
 * The bodies at the marker, once the model is computed for the document as it
 * is; `undefined` while it isn't (no kernel, a failed recompute), when body
 * references go to the feature unchecked and its status says what is wrong.
 */
export function liveBodies(host: AgentHost): ReadonlySet<string> | undefined {
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
