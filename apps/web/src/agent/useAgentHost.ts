/**
 * The shell's side of the agent tools (P6-08, ADR-0087 §5): `AppShell` hands
 * its stores, `apply`, commands, kernel and autosave to this hook, which
 * registers an `AgentHost` for the open design while the shell is mounted. The
 * host reads the latest of each through a ref, so it is registered once per
 * design and never holds a stale command list. Only where the platform has an
 * agent bridge (the desktop): on the web nothing is registered.
 */
import type { BodyId, Command, DocumentStore, ModelStore, SessionStore } from '@extrudo/core';
import {
  type ExportBody,
  type Interference,
  type ModelExporter,
  meshBodies,
  meshBytes,
  RESOLUTIONS,
  stepBody,
} from '@extrudo/kernel';
import { useEffect, useRef } from 'react';
import type { MeasureKernel } from '../measure/inspection';
import type { AgentExportFormat } from '../platform/agent';
import { bodyEntries } from '../shell/bodies';
import type { AppCommand } from '../shell/commands';
import type { ToolHost } from '../sketch/tools/host';
import { APP_VERSION } from '../version';
import type { ViewportStore } from '../viewport/store';
import { type AgentBody, type AgentHost, registerAgentHost } from './host';

export interface AgentShell {
  enabled: boolean;
  store: DocumentStore;
  session: SessionStore;
  model: ModelStore<unknown>;
  viewport: ViewportStore;
  kernel:
    | (ModelExporter &
        MeasureKernel &
        Partial<{ interference(bodies: readonly BodyId[]): Promise<Interference[]> }>)
    | undefined;
  apply(command: Command<unknown>): void;
  commands: readonly AppCommand[];
  save(): Promise<void>;
  /** The sketch tools' host (loaded lazily): its `apply` solves, once its solver is in. */
  toolHost: Pick<ToolHost, 'whenSolverReady'> | undefined;
}

/** The bodies an export takes: the shown ones, else all (as the Export dialog starts). */
function exportBodies(shell: AgentShell): ExportBody[] {
  const { doc } = shell.store.getState();
  const model = shell.model.getState();
  const names = new Map((doc.components ?? []).map((c) => [c.id, c.name]));
  const entries = bodyEntries(doc, model.bodies, model.origins);
  const shown = entries.filter((entry) => entry.display !== 'hidden');
  return (shown.length > 0 ? shown : entries).map((entry) => {
    const component = entry.component === undefined ? undefined : names.get(entry.component);
    return {
      id: entry.id,
      meta: entry.meta,
      ...(entry.mesh && { mesh: true }),
      ...(entry.component !== undefined &&
        component !== undefined && { component: { id: entry.component, name: component } }),
    };
  });
}

function createShellHost(designId: string, current: { current: AgentShell }): AgentHost {
  const shell = () => current.current;
  const command = (id: string) => shell().commands.find((c) => c.id === id);
  return {
    designId,
    store: shell().store,
    session: shell().session,
    model: shell().model,
    apply(commands) {
      const { apply, store } = shell();
      // The shell's `apply` takes one command; several go in one step of their own.
      if (commands.length === 1) {
        apply(commands[0] as Command<unknown>);
        return;
      }
      store.getState().beginTransaction(commands[0]?.label ?? 'Agent');
      try {
        for (const c of commands) apply(c);
        store.getState().commitTransaction();
      } catch (error) {
        store.getState().cancelTransaction();
        throw error;
      }
    },
    async bodies() {
      const { store, model, kernel } = shell();
      const { doc } = store.getState();
      const state = model.getState();
      const entries = bodyEntries(doc, state.bodies, state.origins);
      const inspection = kernel
        ? await kernel.inspect(entries.map((e) => ({ kind: 'body', body: e.id, index: 0 })))
        : undefined;
      return entries.map((entry, i): AgentBody => {
        const item = inspection?.items[i];
        const body = item?.kind === 'body' ? item : undefined;
        return {
          id: entry.id,
          name: entry.meta.name,
          ...(entry.meta.color !== undefined && { color: entry.meta.color }),
          ...(entry.meta.opacity !== undefined && { opacity: entry.meta.opacity }),
          volume: body ? Math.round(body.volume * 1000) / 1000 : Number.NaN,
          box: body ? { min: [...body.bbox.min], max: [...body.bbox.max] } : undefined,
          visible: entry.display !== 'hidden',
        };
      });
    },
    async interference(bodies) {
      const { kernel } = shell();
      if (!kernel?.interference) throw new Error("The geometry kernel isn't ready yet.");
      return kernel.interference(bodies as BodyId[]);
    },
    async ready() {
      // The tool host is a lazy chunk: wait for it (10 s at most), then for its solver.
      for (let i = 0; i < 200 && !shell().toolHost; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await shell().toolHost?.whenSolverReady();
    },
    snapshot: (size, options) =>
      shell().viewport.getState().snapshot?.(size, options) ?? Promise.resolve(null),
    commands: () =>
      shell().commands.map(({ id, label, group, unavailable, run }) => ({
        id,
        label,
        group,
        ...(unavailable !== undefined && { unavailable }),
        run,
      })),
    // The shell's own Undo and Redo: they close an open dialog first.
    undo: () => (command('undo')?.run ?? (() => shell().store.getState().undo()))(),
    redo: () => (command('redo')?.run ?? (() => shell().store.getState().redo()))(),
    save: () => shell().save(),
    async exportModel(format: AgentExportFormat) {
      const s = shell();
      const { kernel } = s;
      if (!kernel) throw new Error("The geometry kernel isn't ready yet.");
      const name = s.store.getState().doc.name;
      const bodies = exportBodies(s);
      if (bodies.length === 0) throw new Error('There are no bodies to export.');
      if (format === 'step') {
        const solid = bodies.filter((b) => !b.mesh);
        if (solid.length === 0)
          throw new Error('STEP takes only solid bodies, and there are none.');
        return new TextEncoder().encode(await kernel.exportStep(solid.map(stepBody)));
      }
      const meshed = await meshBodies(kernel, bodies, RESOLUTIONS.medium);
      return meshBytes(meshed, format, { application: `Extrudo ${APP_VERSION}`, project: name });
    },
  };
}

/** Registers the open design's `AgentHost` while the shell is mounted (desktop only). */
export function useAgentHost(shell: AgentShell): void {
  const current = useRef(shell);
  current.current = shell;
  const { enabled, store } = shell;
  useEffect(() => {
    if (!enabled) return;
    return registerAgentHost(createShellHost(store.getState().doc.id, current));
  }, [enabled, store]);
}
