import { describe, expect, it } from 'vitest';
import type { ExtrudoApi, McpStatus } from '../shared/ipc';
import type { McpRequest, McpResponse } from '../shared/mcp';
import { desktopAgent } from './agent';

function fakeAgentApi() {
  let request: ((request: McpRequest) => void) | undefined;
  let status: ((status: McpStatus) => void) | undefined;
  const responses: McpResponse[] = [];
  const tools: unknown[] = [];
  const agent: ExtrudoApi['agent'] = {
    onRequest: (handler) => {
      request = handler;
    },
    offRequest: () => {
      request = undefined;
    },
    respond: (response) => responses.push(response),
    setTools: (list) => tools.push(list),
    onStatus: (handler) => {
      status = handler;
    },
    offStatus: () => {},
    status: async () => ({ enabled: true, port: 7474, url: 'u', listening: true, clients: 0 }),
    config: async () => ({ url: 'u', token: 't' }),
    regenerateToken: async () => ({ url: 'u', token: 't2' }),
    skillState: async () => undefined,
    installSkill: async () => undefined,
  };
  return {
    api: { agent } as ExtrudoApi,
    send: (r: McpRequest) => request?.(r),
    pushStatus: (s: McpStatus) => status?.(s),
    responses,
    tools,
    listening: () => request !== undefined,
  };
}

describe('desktopAgent (ADR-0087 §4)', () => {
  it("answers main's calls by id, an exception as an error", async () => {
    const fake = fakeAgentApi();
    const agent = desktopAgent(fake.api);
    const off = agent.onRequest(async (tool) => {
      if (tool === 'boom') throw new Error('Kaput.');
      return { result: { content: [{ type: 'text', text: tool }] } };
    });
    fake.send({ id: 7, tool: 'get_design', args: {} });
    fake.send({ id: 8, tool: 'boom', args: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.responses).toEqual([
      { id: 7, result: { content: [{ type: 'text', text: 'get_design' }] } },
      { id: 8, error: 'Kaput.' },
    ]);
    off();
    // Still listening: a call with no handler is answered, not lost.
    expect(fake.listening()).toBe(true);
    fake.send({ id: 9, tool: 'get_design', args: {} });
    expect(fake.responses.at(-1)).toEqual({
      id: 9,
      error: "Extrudo isn't ready yet: try again in a moment.",
    });
  });

  it('follows the status and passes the tool list and Settings asks', async () => {
    const fake = fakeAgentApi();
    const agent = desktopAgent(fake.api);
    let changes = 0;
    agent.subscribe(() => {
      changes += 1;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(agent.status()?.clients).toBe(0);
    fake.pushStatus({ enabled: true, port: 7474, url: 'u', listening: true, clients: 1 });
    expect(agent.status()?.clients).toBe(1);
    expect(changes).toBe(2);
    agent.setTools([]);
    expect(fake.tools).toEqual([[]]);
    expect(await agent.regenerateToken()).toEqual({ url: 'u', token: 't2' });
  });
});
