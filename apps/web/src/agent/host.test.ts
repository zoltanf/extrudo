import { Design } from '@extrudo/api';
import { createDocumentStore, createModelStore, createSessionStore } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { type AgentHost, agentHosts, registerAgentHost, settled, waitForHost } from './host';

function host(designId: string): AgentHost {
  return {
    designId,
    store: createDocumentStore(Design.create({ name: designId }).toJSON()),
    session: createSessionStore(),
    model: createModelStore<unknown>(),
    apply: () => {},
    ready: async () => {},
    bodies: async () => [],
    interference: async () => [],
    snapshot: async () => null,
    commands: () => [],
    undo: () => {},
    redo: () => {},
    save: async () => {},
    exportModel: async () => new Uint8Array(),
  };
}

describe('the agent host registry (ADR-0087 §5)', () => {
  it('registers the open design and forgets it on unmount, unless replaced', () => {
    const a = host('a');
    const off = registerAgentHost(a);
    expect(agentHosts.getState().host).toBe(a);
    const b = host('b');
    const offB = registerAgentHost(b);
    off();
    expect(agentHosts.getState().host).toBe(b);
    offB();
    expect(agentHosts.getState().host).toBeUndefined();
  });

  it('waits for a design to open, and gives up after the timeout', async () => {
    const waiting = waitForHost('c', 1000);
    const c = host('c');
    const off = registerAgentHost(c);
    await expect(waiting).resolves.toBe(c);
    off();
    await expect(waitForHost('never', 10)).rejects.toThrow("didn't open");
  });

  it('settles once the model is computed for the current document', async () => {
    const h = host('d');
    let done = false;
    const waiting = settled(h, 5000).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    h.model.getState().computed({ features: {}, bodies: {}, doc: h.store.getState().doc });
    await waiting;
    expect(done).toBe(true);
  });

  it('settles at once when the recompute failed', async () => {
    const h = host('e');
    h.model.getState().failed('The kernel crashed.');
    await expect(settled(h, 60_000)).resolves.toBeUndefined();
  });
});
