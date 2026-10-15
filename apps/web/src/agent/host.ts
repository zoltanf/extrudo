/**
 * What the agent tools need from the open design (P6-08, ADR-0087 §5): the
 * shell implements `AgentHost` in `AppShell`, the way it wires the native
 * menus, and registers it while the design is open (`agentHosts`). The tools
 * stay plain functions over it, tested with a fake.
 */
import type { Command, DocumentStore, ModelStore, SessionStore } from '@extrudo/core';
import { createStore } from 'zustand/vanilla';
import type { AgentExportFormat } from '../platform/agent';

/** A body as `get_bodies` answers it. */
export interface AgentBody {
  id: string;
  name: string;
  /** mm³ */
  volume: number;
  /** mm */
  box: { min: [number, number, number]; max: [number, number, number] } | undefined;
  visible: boolean;
}

/** One of the app's commands, as `list_commands` lists it. */
export interface AgentCommand {
  id: string;
  label: string;
  group: string;
  unavailable?: string;
  run(): void;
}

export interface AgentHost {
  /** The open design's project id. */
  readonly designId: string;
  readonly store: DocumentStore;
  readonly session: SessionStore;
  readonly model: ModelStore<unknown>;
  /** The shell's `apply`: the commands in one step, and the sketches they touch re-solved. */
  apply(commands: readonly Command<unknown>[]): void;
  /** Resolves once a change can be applied with its sketches solved (the solver is in). */
  ready(): Promise<void>;
  /** The bodies at the marker with their measures (the kernel's, as Print Info's). */
  bodies(): Promise<AgentBody[]>;
  /** A square PNG of the model, `size` px; null when the view isn't drawn. */
  snapshot(size: number): Promise<Blob | null>;
  commands(): readonly AgentCommand[];
  undo(): void;
  redo(): void;
  save(): Promise<void>;
  /** The visible bodies (or all) as a file's bytes. */
  exportModel(format: AgentExportFormat): Promise<Uint8Array>;
}

/** The open design's host, while one is open. */
export const agentHosts = createStore<{ host: AgentHost | undefined }>()(() => ({
  host: undefined,
}));

/** Registers the shell's host; the returned function unregisters it (if still current). */
export function registerAgentHost(host: AgentHost): () => void {
  agentHosts.setState({ host });
  return () => {
    if (agentHosts.getState().host === host) agentHosts.setState({ host: undefined });
  };
}

/** Resolves with the host of design `id` once it is registered; rejects after `timeoutMs`. */
export function waitForHost(id: string, timeoutMs = 30_000): Promise<AgentHost> {
  const current = agentHosts.getState().host;
  if (current?.designId === id) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`The design didn't open within ${timeoutMs / 1000} s.`));
    }, timeoutMs);
    const unsubscribe = agentHosts.subscribe(({ host }) => {
      if (host?.designId !== id) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(host);
    });
  });
}

/**
 * Resolves once the model is computed for the document as it is now (or
 * failed), or after `timeoutMs`, so a change's answer can say how it went.
 */
export function settled(host: AgentHost, timeoutMs = 30_000): Promise<void> {
  const done = () => {
    const model = host.model.getState();
    // A failed recompute is an answer too (it sets no `doc`): say so instead of waiting.
    return (
      model.status === 'failed' ||
      (model.status !== 'computing' && model.doc === host.store.getState().doc)
    );
  };
  if (done()) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    const unsubscribe = host.model.subscribe(() => {
      if (done()) finish();
    });
  });
}
