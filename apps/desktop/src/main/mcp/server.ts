/**
 * The desktop MCP server (P6-08, ADR-0087 §1): Streamable HTTP through the
 * SDK's low-level `Server`, on a Node `http` server bound to `127.0.0.1` only.
 * It knows no tool: the list comes from the renderer (`tools()`), every call
 * goes to `handle(tool, args)`, and main forwards it to the renderer. It
 * serves the shipped skill as resources (SEP-2640) when given one.
 *
 * Every request passes `admit` first (Host, Origin, body size, token); then
 * the body is read with the 1 MB cap and handed to the session's transport.
 * Each client gets its own session (an SDK `Server` + transport pair);
 * `clients()` counts the sessions with a request in the last 30 s or a stream
 * open, which is what the top bar's indicator shows.
 *
 * Free of Electron: the tests start it on a free port with a fake handler and
 * talk to it with the SDK's own client.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from '@extrudo/core';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  isInitializeRequest,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { McpToolDefinition, McpToolResult } from '../../shared/mcp';
import { admit, MAX_BODY_BYTES } from './admit';
import type { Skill } from './skill';

/** The one address the server ever binds. */
export const MCP_HOST = '127.0.0.1';
export const MCP_PATH = '/mcp';
export const DEFAULT_MCP_PORT = 7474;
/** A client counts as connected this long after its last request. */
export const ACTIVE_MS = 30_000;
/** More sessions than this and the oldest idle one is dropped. */
const MAX_SESSIONS = 16;

/** The SEP-2640 extension's identifier in `capabilities.extensions`. */
export const SKILLS_EXTENSION = 'io.modelcontextprotocol/skills';

export type ToolDefinition = McpToolDefinition;
export type ToolResult = McpToolResult;

export interface McpServerOptions {
  port: number;
  /** Read on every request, so a regenerated token applies at once. */
  token: () => string;
  /** The tools as the renderer last sent them. */
  tools: () => readonly ToolDefinition[];
  handle(tool: string, args: Record<string, unknown>): Promise<ToolResult>;
  skill?: Skill;
  instructions?: string;
  version: string;
  /** Called whenever `clients()` may have changed (a session opened or closed, a request). */
  onActivity?: () => void;
  now?: () => number;
}

export interface RunningMcpServer {
  address(): AddressInfo;
  url(): string;
  /** Sessions with a request in the last 30 s or a stream open. */
  clients(): number;
  /** Tells every session the tool list changed. */
  toolsChanged(): void;
  close(): Promise<void>;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  server: Server;
  last: number;
  streams: number;
}

const SkillsListSchema = z.object({
  method: z.literal('skills/list'),
  params: z.optional(z.object({ cursor: z.optional(z.string()) }).loose()),
});
const SkillsGetSchema = z.object({
  method: z.literal('skills/get'),
  params: z.object({ uri: z.string() }).loose(),
});
const DirectoryReadSchema = z.object({
  method: z.literal('resources/directory/read'),
  params: z.object({ uri: z.string(), cursor: z.optional(z.string()) }).loose(),
});

function refuse(res: ServerResponse, status: number, error: string): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error }));
}

/** The body, at most `MAX_BODY_BYTES`; undefined once it went over (the request was answered 413). */
async function readBody(req: IncomingMessage, res: ServerResponse): Promise<unknown | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      refuse(res, 413, 'Request body too large.');
      req.destroy();
      return undefined;
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    refuse(res, 400, 'The body is not JSON.');
    return undefined;
  }
}

const header = (req: IncomingMessage, name: string): string | undefined => {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

function newProtocolServer(options: McpServerOptions): Server {
  const { skill } = options;
  const server = new Server(
    { name: 'extrudo', version: options.version },
    {
      capabilities: {
        tools: { listChanged: true },
        ...(skill && {
          resources: {},
          extensions: { [SKILLS_EXTENSION]: { directoryRead: true } },
        }),
      },
      ...(options.instructions && { instructions: options.instructions }),
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [...options.tools()] }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (!options.tools().some((tool) => tool.name === name)) {
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
    return { ...(await options.handle(name, args ?? {})) };
  });
  if (skill) {
    const unknown = (uri: string) =>
      new McpError(ErrorCode.InvalidParams, `Unknown resource: ${uri}`);
    server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: skill.resources() }));
    server.setRequestHandler(ReadResourceRequestSchema, (request) => {
      const file = skill.read(request.params.uri);
      if (!file) throw unknown(request.params.uri);
      return { contents: [{ uri: request.params.uri, mimeType: file.mimeType, text: file.text }] };
    });
    server.setRequestHandler(SkillsListSchema, () => ({ skills: [skill.entry] }));
    server.setRequestHandler(SkillsGetSchema, (request) => {
      if (request.params.uri !== skill.uri) throw unknown(request.params.uri);
      return { skill: skill.entry };
    });
    server.setRequestHandler(DirectoryReadSchema, (request) => {
      const children = skill.directory(request.params.uri);
      if (!children) throw unknown(request.params.uri);
      return { resources: children };
    });
  }
  return server;
}

/** Starts the server; rejects with the bind error (a port in use) and leaves nothing open. */
export function createMcpServer(options: McpServerOptions): Promise<RunningMcpServer> {
  const now = options.now ?? Date.now;
  const sessions = new Map<string, Session>();
  const activity = () => options.onActivity?.();
  /** The bound port (the option may be 0 in tests): what `Host` must name. */
  let port = options.port;

  function dropSession(id: string): void {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    void session.server.close().catch(() => {});
    activity();
  }

  /** Room for one more session: the oldest idle one goes; false when every one holds a stream. */
  function makeRoom(): boolean {
    if (sessions.size < MAX_SESSIONS) return true;
    let oldest: [string, Session] | undefined;
    for (const entry of sessions) {
      if (entry[1].streams === 0 && (!oldest || entry[1].last < oldest[1].last)) oldest = entry;
    }
    if (!oldest) return false;
    dropSession(oldest[0]);
    return true;
  }

  async function onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const admission = admit(
      {
        host: header(req, 'host'),
        origin: header(req, 'origin'),
        authorization: header(req, 'authorization'),
        contentLength: header(req, 'content-length'),
      },
      { port, token: options.token() },
    );
    if (!admission.ok) return refuse(res, admission.status, admission.error);
    const path = new URL(req.url ?? '/', `http://${MCP_HOST}`).pathname;
    if (path !== MCP_PATH) return refuse(res, 404, 'Not found.');

    const body = req.method === 'POST' ? await readBody(req, res) : null;
    if (body === undefined) return;

    const sessionId = header(req, 'mcp-session-id');
    let session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) {
      if (sessionId) return refuse(res, 404, 'Unknown session.');
      if (req.method !== 'POST' || !isInitializeRequest(body)) {
        return refuse(res, 400, 'Start a session with an initialize request.');
      }
      if (!makeRoom()) return refuse(res, 503, 'Too many sessions.');
      const server = newProtocolServer(options);
      const fresh: Session = {
        server,
        last: now(),
        streams: 0,
        transport: new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          onsessioninitialized: (id) => {
            sessions.set(id, fresh);
            activity();
          },
        }),
      };
      fresh.transport.onclose = () => {
        if (fresh.transport.sessionId) dropSession(fresh.transport.sessionId);
      };
      await server.connect(fresh.transport);
      session = fresh;
    }
    const current = session;
    current.last = now();
    if (req.method === 'GET') {
      current.streams += 1;
      res.on('close', () => {
        current.streams -= 1;
        current.last = now();
        activity();
      });
    }
    activity();
    await current.transport.handleRequest(req, res, body ?? undefined);
  }

  const http = createServer((req, res) => {
    onRequest(req, res).catch((error: unknown) => {
      console.warn('MCP request failed:', error);
      if (!res.headersSent) refuse(res, 500, 'Internal error.');
      else res.end();
    });
  });

  return new Promise((resolve, reject) => {
    const failed = (error: Error) => {
      http.close();
      reject(error);
    };
    http.once('error', failed);
    http.listen(options.port, MCP_HOST, () => {
      http.off('error', failed);
      http.on('error', (error) => console.warn('MCP server error:', error));
      const address = () => http.address() as AddressInfo;
      port = address().port;
      resolve({
        address,
        url: () => `http://${MCP_HOST}:${address().port}${MCP_PATH}`,
        clients() {
          const since = now() - ACTIVE_MS;
          let count = 0;
          for (const session of sessions.values()) {
            if (session.streams > 0 || session.last >= since) count += 1;
          }
          return count;
        },
        toolsChanged() {
          for (const session of sessions.values()) {
            void session.server.sendToolListChanged().catch(() => {});
          }
        },
        async close() {
          for (const id of [...sessions.keys()]) dropSession(id);
          await new Promise<void>((done) => {
            http.close(() => done());
            http.closeAllConnections();
          });
        },
      });
    });
  });
}
