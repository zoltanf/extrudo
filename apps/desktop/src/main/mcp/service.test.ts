import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHANNELS, type McpStatus } from '../../shared/ipc';
import type { McpRequest } from '../../shared/mcp';
import { createMcpService, type McpService, mcpPreferences } from './service';
import { extrudoSkill, SKILL_INSTRUCTIONS } from './skillFiles';
import { connectClient, freePort, post } from './testing';

const tools = [
  { name: 'get_design', description: 'The open design.', inputSchema: { type: 'object' } },
  { name: 'export', description: 'Exports.', inputSchema: { type: 'object' } },
];

let service: McpService | undefined;
afterEach(async () => {
  await service?.dispose();
  service = undefined;
});

function setup(
  prefs: Record<string, unknown>,
  options: { timeoutMs?: number; window?: boolean } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'extrudo-mcp-'));
  const sent: { channel: string; payload: unknown }[] = [];
  let answer: ((request: McpRequest) => void) | undefined;
  const created = createMcpService({
    preferences: () => prefs,
    tokenFile: join(dir, 'mcp-token'),
    exportsDir: join(dir, 'agent-exports'),
    version: '0.0.0-test',
    send: (channel, payload) => {
      if (options.window === false) return false;
      sent.push({ channel, payload });
      if (channel === CHANNELS.mcpRequest) queueMicrotask(() => answer?.(payload as McpRequest));
      return true;
    },
    log: { warn: () => {} },
    ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
  });
  service = created;
  created.setTools(tools);
  const statuses = () =>
    sent.filter((s) => s.channel === CHANNELS.mcpStatus).map((s) => s.payload as McpStatus);
  return {
    service: created,
    sent,
    statuses,
    onRequest: (handler: (request: McpRequest) => void) => {
      answer = handler;
    },
  };
}

const refused = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = createServer().listen(port, '127.0.0.1', () => {
      socket.close(() => resolve(true));
    });
    socket.once('error', () => resolve(false));
  });

describe('mcpPreferences (ADR-0087 §3)', () => {
  it('is on at 7474 by default and keeps a bad port at the default', () => {
    expect(mcpPreferences({})).toEqual({ enabled: true, port: 7474 });
    expect(mcpPreferences({ 'mcp.enabled': false, 'mcp.port': 8123 })).toEqual({
      enabled: false,
      port: 8123,
    });
    expect(mcpPreferences({ 'mcp.port': 80 }).port).toBe(7474);
    expect(mcpPreferences({ 'mcp.port': 70000 }).port).toBe(7474);
    expect(mcpPreferences({ 'mcp.port': '9000' }).port).toBe(7474);
  });
});

describe('the MCP service (ADR-0087 §3–4)', () => {
  it('listens when enabled, closes the port when switched off, and moves with the port', async () => {
    const port = await freePort();
    const prefs: Record<string, unknown> = { 'mcp.port': port };
    const { service, statuses } = setup(prefs);
    await service.configure();
    expect(service.status()).toMatchObject({ enabled: true, listening: true, port, clients: 0 });
    expect(service.status().url).toBe(`http://127.0.0.1:${port}/mcp`);
    expect(await refused(port)).toBe(false);

    prefs['mcp.enabled'] = false;
    await service.configure();
    expect(service.status()).toMatchObject({ enabled: false, listening: false });
    // The socket is free again: nothing listens on it.
    expect(await refused(port)).toBe(true);
    await expect(post(`http://127.0.0.1:${port}/mcp`, {})).rejects.toThrow();

    const other = await freePort();
    prefs['mcp.enabled'] = true;
    prefs['mcp.port'] = other;
    await service.configure();
    expect(service.status()).toMatchObject({ listening: true, port: other });
    expect(statuses().at(-1)).toMatchObject({ listening: true, port: other });
  });

  it('reports a port in use as the error', async () => {
    const port = await freePort();
    const blocker = createServer().listen(port, '127.0.0.1');
    await new Promise((resolve) => blocker.once('listening', resolve));
    const { service } = setup({ 'mcp.port': port });
    await service.configure();
    expect(service.status()).toMatchObject({
      listening: false,
      error: `Port ${port} is in use by another program.`,
    });
    await new Promise((resolve) => blocker.close(resolve));
  });

  it('forwards a tool call to the renderer and answers its response', async () => {
    const port = await freePort();
    const { service, onRequest } = setup({ 'mcp.port': port });
    onRequest((request) =>
      service.respond({
        id: request.id,
        result: {
          content: [{ type: 'text', text: `${request.tool} ${JSON.stringify(request.args)}` }],
        },
      }),
    );
    await service.configure();
    const client = await connectClient(service.config().url, service.config().token);
    const result = await client.callTool({ name: 'get_design', arguments: { full: true } });
    expect(result.content).toEqual([{ type: 'text', text: 'get_design {"full":true}' }]);
    // A renderer error is a tool error, not a protocol one.
    onRequest((request) => service.respond({ id: request.id, error: 'No design is open.' }));
    const failed = await client.callTool({ name: 'get_design', arguments: {} });
    expect(failed).toMatchObject({ isError: true, content: [{ text: 'No design is open.' }] });
    await client.close();
  });

  it('writes an exported file under agent-exports and answers the path', async () => {
    const port = await freePort();
    const { service, onRequest } = setup({ 'mcp.port': port });
    onRequest((request) =>
      service.respond({
        id: request.id,
        result: { content: [{ type: 'text', text: 'Exported.' }] },
        file: { design: 'Box', format: 'stl', bytes: new Uint8Array([1]) },
      }),
    );
    await service.configure();
    const client = await connectClient(service.config().url, service.config().token);
    const result = (await client.callTool({ name: 'export', arguments: { format: 'stl' } })) as {
      content: { text: string }[];
    };
    const path = result.content[1]?.text.replace('Written to ', '') ?? '';
    expect(basename(path)).toBe('Box-1.stl');
    expect(path).toContain('agent-exports');
    await client.close();
  });

  it('fails a call the renderer never answers, and one with no window', async () => {
    const port = await freePort();
    const { service } = setup({ 'mcp.port': port }, { timeoutMs: 200 });
    await service.configure();
    const client = await connectClient(service.config().url, service.config().token);
    const late = await client.callTool({ name: 'get_design', arguments: {} });
    expect(late).toMatchObject({
      isError: true,
      content: [{ text: "Extrudo didn't answer get_design within 0.2 s." }],
    });
    await client.close();
    await service.dispose();

    const closed = setup({ 'mcp.port': await freePort() }, { window: false });
    await closed.service.configure();
    const other = await connectClient(closed.service.config().url, closed.service.config().token);
    const answer = await other.callTool({ name: 'get_design', arguments: {} });
    expect(answer).toMatchObject({
      isError: true,
      content: [{ text: "Extrudo's window isn't open." }],
    });
    await other.close();
  });

  it('answers get_skill itself, with the SKILL.md it serves', async () => {
    const port = await freePort();
    const dir = mkdtempSync(join(tmpdir(), 'extrudo-mcp-'));
    service = createMcpService({
      preferences: () => ({ 'mcp.port': port }),
      tokenFile: join(dir, 'mcp-token'),
      exportsDir: join(dir, 'agent-exports'),
      version: '0',
      send: () => true,
      skill: extrudoSkill(),
      instructions: SKILL_INSTRUCTIONS,
      log: { warn: () => {} },
    });
    service.setTools([
      { name: 'get_skill', description: 'The skill.', inputSchema: { type: 'object' } },
    ]);
    await service.configure();
    const client = await connectClient(service.config().url, service.config().token);
    const result = (await client.callTool({ name: 'get_skill', arguments: {} })) as {
      content: { text: string }[];
    };
    const read = await client.readResource({ uri: 'skill://extrudo/SKILL.md' });
    expect(result.content[0]?.text).toBe((read.contents[0] as { text: string }).text);
    expect(client.getInstructions()).toBe(SKILL_INSTRUCTIONS);
    await client.close();
  });

  it('ignores a malformed tool list and response', async () => {
    const { service } = setup({ 'mcp.enabled': false });
    service.setTools([{ name: 'Bad Name', description: '', inputSchema: { type: 'object' } }]);
    service.respond({ id: 'x' });
    expect(service.status().enabled).toBe(false);
  });

  it('regenerates the token: the old one is refused at once', async () => {
    const port = await freePort();
    const { service } = setup({ 'mcp.port': port });
    await service.configure();
    const old = service.config().token;
    const fresh = service.regenerateToken().token;
    expect(fresh).not.toBe(old);
    const url = service.config().url;
    expect((await post(url, { authorization: `Bearer ${old}` })).status).toBe(401);
    const client = await connectClient(url, fresh);
    await client.close();
  });
});
