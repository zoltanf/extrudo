/**
 * Main's MCP service (P6-08, ADR-0087 §3–4): the preferences that switch the
 * server on and pick its port, the token, the server's lifecycle, and the
 * bridge to the renderer. Main never touches the document: a tool call becomes
 * one `extrudo:mcp:request` to the renderer and waits (60 s at most) for its
 * `extrudo:mcp:respond`. The tool list is the renderer's (`extrudo:mcp:tools`).
 *
 * Electron-free (the window is an injected `send`), so it is unit-tested.
 */
import { CHANNELS, type McpConfig, type McpStatus } from '../../shared/ipc';
import { isToolDefinitionList, isToolResponse } from '../../shared/mcp';
import { createAgentExports } from './exports';
import {
  createMcpServer,
  DEFAULT_MCP_PORT,
  type RunningMcpServer,
  type ToolDefinition,
  type ToolResult,
} from './server';
import type { Skill } from './skill';
import { readOrCreateToken, regenerateToken } from './token';

/** A tool call the renderer hasn't answered in this long fails. */
export const REQUEST_TIMEOUT_MS = 60_000;
/** Calls waiting for the renderer at once; more are refused. */
const MAX_PENDING = 64;
/** How often the connected count is looked at again (it decays after 30 s). */
const STATUS_POLL_MS = 5_000;

export const MCP_ENABLED_KEY = 'mcp.enabled';
export const MCP_PORT_KEY = 'mcp.port';

/** The server's switch and port from the preference map; a bad port is the default. */
export function mcpPreferences(values: Record<string, unknown>): {
  enabled: boolean;
  port: number;
} {
  const port = values[MCP_PORT_KEY];
  return {
    enabled: values[MCP_ENABLED_KEY] !== false,
    port:
      typeof port === 'number' && Number.isInteger(port) && port >= 1024 && port <= 65535
        ? port
        : DEFAULT_MCP_PORT,
  };
}

export interface McpServiceOptions {
  preferences: () => Record<string, unknown>;
  tokenFile: string;
  /** `userData/agent-exports`: where an export tool writes. */
  exportsDir: string;
  /** Sends to the renderer; false when there is no window to send to. */
  send(channel: string, payload: unknown): boolean;
  version: string;
  skill?: Skill;
  instructions?: string;
  timeoutMs?: number;
  log?: Pick<Console, 'warn'>;
}

export interface McpService {
  /** Reads the preferences and starts, stops or restarts the server to match. */
  configure(): Promise<void>;
  setTools(list: unknown): void;
  respond(payload: unknown): void;
  status(): McpStatus;
  /** The URL and token, for Settings' Copy client config (whether or not it listens). */
  config(): McpConfig;
  regenerateToken(): McpConfig;
  /** The renderer (re)loaded: pending calls can't be answered any more. */
  rendererReset(): void;
  dispose(): Promise<void>;
}

const textError = (text: string): ToolResult => ({
  content: [{ type: 'text', text }],
  isError: true,
});

export function createMcpService(options: McpServiceOptions): McpService {
  const log = options.log ?? console;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let token = readOrCreateToken(options.tokenFile);
  let tools: readonly ToolDefinition[] = [];
  let running: RunningMcpServer | undefined;
  let runningPort: number | undefined;
  let error: string | undefined;
  let lastSent = '';
  let nextId = 1;
  let queue: Promise<void> = Promise.resolve();
  const exportsWriter = createAgentExports(options.exportsDir);
  const pending = new Map<
    number,
    { resolve: (result: ToolResult) => void; timer: NodeJS.Timeout }
  >();

  const status = (): McpStatus => {
    const { enabled, port } = mcpPreferences(options.preferences());
    return {
      enabled,
      port,
      url: running ? running.url() : `http://127.0.0.1:${port}/mcp`,
      listening: running !== undefined,
      clients: running ? running.clients() : 0,
      ...(error !== undefined && { error }),
    };
  };

  const emit = () => {
    const next = status();
    const key = JSON.stringify(next);
    if (key === lastSent) return;
    if (options.send(CHANNELS.mcpStatus, next)) lastSent = key;
  };

  const poll = setInterval(() => {
    if (running) emit();
  }, STATUS_POLL_MS);
  poll.unref?.();

  function handle(tool: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (pending.size >= MAX_PENDING) {
      return Promise.resolve(
        textError('Too many calls are waiting for Extrudo: try again shortly.'),
      );
    }
    // The skill is main's: it serves it as resources, so it answers get_skill too.
    if (tool === 'get_skill' && options.skill) {
      return Promise.resolve({ content: [{ type: 'text', text: options.skill.text }] });
    }
    const id = nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve(textError(`Extrudo didn't answer ${tool} within ${timeoutMs / 1000} s.`));
      }, timeoutMs);
      pending.set(id, { resolve, timer });
      if (!options.send(CHANNELS.mcpRequest, { id, tool, args })) {
        clearTimeout(timer);
        pending.delete(id);
        resolve(textError("Extrudo's window isn't open."));
      }
    });
  }

  async function stop(): Promise<void> {
    const server = running;
    running = undefined;
    runningPort = undefined;
    if (server) await server.close();
  }

  async function apply(): Promise<void> {
    const { enabled, port } = mcpPreferences(options.preferences());
    if (!enabled) {
      error = undefined;
      await stop();
      return;
    }
    if (running && runningPort === port) return;
    await stop();
    try {
      running = await createMcpServer({
        port,
        token: () => token,
        tools: () => tools,
        handle,
        version: options.version,
        ...(options.skill && { skill: options.skill }),
        ...(options.instructions && { instructions: options.instructions }),
        onActivity: emit,
      });
      runningPort = port;
      error = undefined;
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      error =
        code === 'EADDRINUSE'
          ? `Port ${port} is in use by another program.`
          : `Couldn't listen on port ${port}: ${(cause as Error).message.split('\n')[0]}`;
      log.warn(`MCP server: ${error}`);
    }
  }

  return {
    configure() {
      // One change at a time: a quick on-off-on must not race two binds.
      queue = queue
        .then(apply)
        .then(emit)
        .catch((cause: unknown) => log.warn('MCP server:', cause));
      return queue;
    },
    setTools(list) {
      if (!isToolDefinitionList(list)) {
        log.warn('Ignoring a malformed MCP tool list from the renderer.');
        return;
      }
      tools = list;
      running?.toolsChanged();
    },
    respond(payload) {
      if (!isToolResponse(payload)) {
        log.warn('Ignoring a malformed MCP response from the renderer.');
        return;
      }
      const waiting = pending.get(payload.id);
      if (!waiting) return;
      pending.delete(payload.id);
      clearTimeout(waiting.timer);
      if ('error' in payload) {
        waiting.resolve(textError(payload.error));
        return;
      }
      const { file } = payload;
      if (!file) {
        waiting.resolve(payload.result);
        return;
      }
      exportsWriter
        .write(file)
        .then((path) =>
          waiting.resolve({
            ...payload.result,
            content: [...payload.result.content, { type: 'text', text: `Written to ${path}` }],
          }),
        )
        .catch((cause: unknown) => waiting.resolve(textError((cause as Error).message)));
    },
    status,
    config: () => ({ url: status().url, token }),
    regenerateToken() {
      token = regenerateToken(options.tokenFile);
      return { url: status().url, token };
    },
    rendererReset() {
      for (const [id, waiting] of pending) {
        clearTimeout(waiting.timer);
        waiting.resolve(textError('Extrudo reloaded before it answered.'));
        pending.delete(id);
      }
      lastSent = '';
      emit();
    },
    async dispose() {
      clearInterval(poll);
      await stop();
    },
  };
}
