import { z } from '@extrudo/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMcpServer, MCP_HOST, type RunningMcpServer, type ToolDefinition } from './server';
import { createSkill } from './skill';
import { connectClient, post } from './testing';

const token = 'c'.repeat(64);
const tools: ToolDefinition[] = [
  {
    name: 'echo',
    description: 'Says the text back.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
];
const skill = createSkill([
  {
    path: 'SKILL.md',
    text: '---\nname: extrudo\ndescription: Model in Extrudo.\n---\n\n# Extrudo\n',
  },
  { path: 'references/api.md', text: '# API\n' },
]);

let server: RunningMcpServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const start = (extra: { now?: () => number } = {}) =>
  createMcpServer({
    port: 0,
    token: () => token,
    tools: () => tools,
    handle: async (tool, args) => ({
      content: [{ type: 'text', text: `${tool}: ${String(args.text)}` }],
    }),
    version: '0.0.0-test',
    skill,
    instructions: 'Read skill://extrudo/SKILL.md before modelling.',
    ...extra,
  });

describe('the MCP server (ADR-0087 §1–2)', () => {
  it('binds 127.0.0.1 only', async () => {
    server = await start();
    expect(server.address().address).toBe(MCP_HOST);
    expect(server.address().address).toBe('127.0.0.1');
    expect(server.url()).toBe(`http://127.0.0.1:${server.address().port}/mcp`);
  });

  it('answers 401 without the token or with a wrong one, as one line of JSON', async () => {
    server = await start();
    const none = await post(server.url(), {});
    expect(none.status).toBe(401);
    expect(await none.json()).toEqual({ error: 'Unauthorized.' });
    const wrong = await post(server.url(), { authorization: `Bearer ${'d'.repeat(64)}` });
    expect(wrong.status).toBe(401);
  });

  it('answers 403 to a foreign Origin, even with the token', async () => {
    server = await start();
    const response = await post(server.url(), {
      authorization: `Bearer ${token}`,
      origin: 'https://evil.example',
    });
    expect(response.status).toBe(403);
  });

  it('answers 413 to a body over 1 MB', async () => {
    server = await start();
    const response = await post(
      server.url(),
      { authorization: `Bearer ${token}` },
      JSON.stringify({ padding: 'x'.repeat(1024 * 1024) }),
    );
    expect(response.status).toBe(413);
  });

  it('round-trips a tool call through a real SDK client', async () => {
    server = await start();
    const client = await connectClient(server.url(), token);
    expect(client.getInstructions()).toBe('Read skill://extrudo/SKILL.md before modelling.');
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(['echo']);
    const result = await client.callTool({ name: 'echo', arguments: { text: 'hi' } });
    expect(result.content).toEqual([{ type: 'text', text: 'echo: hi' }]);
    const unknown = await client.callTool({ name: 'nope', arguments: {} });
    expect(unknown.isError).toBe(true);
    expect(server.clients()).toBe(1);
    await client.close();
  });

  it('counts a client while its stream is open and for 30 s after its last request', async () => {
    let time = 1_000_000;
    server = await start({ now: () => time });
    const client = await connectClient(server.url(), token);
    await client.listTools();
    expect(server.clients()).toBe(1);
    await client.close();
    // The stream closed just now: still connected for 30 s, then not.
    await vi.waitFor(() => {
      time += 31_000;
      expect(server?.clients()).toBe(0);
    });
  });

  it('serves the skill per SEP-2640', async () => {
    server = await start();
    const client = await connectClient(server.url(), token);
    expect(client.getServerCapabilities()?.extensions).toEqual({
      'io.modelcontextprotocol/skills': { directoryRead: true },
    });
    const Any = z.object({}).loose();
    const listed = (await client.request({ method: 'skills/list', params: {} }, Any)) as {
      skills: { uri: string; frontmatter: unknown; resources: { uri: string; digest: string }[] }[];
    };
    expect(listed.skills).toHaveLength(1);
    expect(listed.skills[0]?.uri).toBe('skill://extrudo/SKILL.md');
    expect(listed.skills[0]?.frontmatter).toEqual({
      name: 'extrudo',
      description: 'Model in Extrudo.',
    });
    expect(listed.skills[0]?.resources.map((r) => r.uri)).toEqual([
      'skill://extrudo/SKILL.md',
      'skill://extrudo/references/api.md',
    ]);
    const got = (await client.request(
      { method: 'skills/get', params: { uri: 'skill://extrudo/SKILL.md' } },
      Any,
    )) as { skill: unknown };
    expect(got.skill).toEqual(listed.skills[0]);
    const read = await client.readResource({ uri: 'skill://extrudo/SKILL.md' });
    expect(read.contents[0]).toMatchObject({ mimeType: 'text/markdown', text: skill.text });
    const dir = (await client.request(
      { method: 'resources/directory/read', params: { uri: 'skill://extrudo' } },
      Any,
    )) as { resources: { uri: string; mimeType: string }[] };
    expect(dir.resources).toEqual([
      { uri: 'skill://extrudo/references', name: 'references', mimeType: 'inode/directory' },
      expect.objectContaining({ uri: 'skill://extrudo/SKILL.md' }),
    ]);
    await expect(client.readResource({ uri: 'skill://extrudo/nope.md' })).rejects.toThrow(
      'Unknown resource',
    );
    await expect(
      client.request({ method: 'skills/get', params: { uri: 'skill://other/SKILL.md' } }, Any),
    ).rejects.toThrow('Unknown resource');
    await client.close();
  });

  it('refuses connections once closed', async () => {
    server = await start();
    const url = server.url();
    await server.close();
    server = undefined;
    await expect(post(url, { authorization: `Bearer ${token}` })).rejects.toThrow();
  });
});
