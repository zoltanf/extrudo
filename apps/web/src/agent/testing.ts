/** Test helpers for the agent tools: a fake shell host and context (no kernel, no DOM). */
import { Design } from '@extrudo/api';
import {
  type Command,
  createDocumentStore,
  createModelStore,
  createSessionStore,
  type ExtrudoDocument,
} from '@extrudo/core';
import type { ProjectSummary } from '@extrudo/storage';
import type { AgentHost } from './host';
import type { AgentContext } from './tools';

/** A host over a document store, `apply` dispatching like the shell's (one step). */
export function fakeHost(
  doc: ExtrudoDocument = Design.create({ name: 'Untitled' }).toJSON(),
  designId: string = doc.id,
) {
  const store = createDocumentStore(doc);
  const session = createSessionStore();
  const model = createModelStore<unknown>();
  const applied: string[] = [];
  const ran: string[] = [];
  const host: AgentHost = {
    designId,
    store,
    session,
    model,
    apply(commands: readonly Command<unknown>[]) {
      store.getState().beginTransaction(commands[0]?.label ?? '');
      for (const command of commands) {
        applied.push(command.label);
        store.getState().dispatch(command);
      }
      store.getState().commitTransaction();
    },
    ready: async () => {},
    bodies: async () => [
      {
        id: 'b1',
        name: 'Body1',
        volume: 4000,
        box: { min: [0, 0, 0], max: [40, 20, 5] },
        visible: true,
      },
    ],
    interference: async () => [],
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

/** A context over `designs`; `new_design` makes a fresh host, which becomes the open one. */
export function fakeContext(
  initial: AgentHost | undefined,
  designs: readonly ProjectSummary[] = [],
  extra: Partial<AgentContext> = {},
): AgentContext & { current(): AgentHost | undefined } {
  let current = initial;
  const made = new Map<string, AgentHost>();
  return {
    current: () => current,
    host: () => current,
    designs: async () => [
      ...designs,
      ...[...made.values()].map(
        (h) =>
          ({
            id: h.designId,
            name: h.store.getState().doc.name,
            created: 0,
            modified: 0,
            hasThumbnail: false,
          }) as unknown as ProjectSummary,
      ),
    ],
    create: async (name) => {
      const { host } = fakeHost(Design.create({ name: name ?? 'Untitled' }).toJSON());
      made.set(host.designId, host);
      return host.designId;
    },
    open: async (id) => {
      const found = made.get(id) ?? (current?.designId === id ? current : undefined);
      if (!found) throw new Error(`no design ${id}`);
      current = found;
      return found;
    },
    screenshotTurn: async () => {},
    exportTurn: async () => {},
    settleMs: 5,
    ...extra,
  };
}
