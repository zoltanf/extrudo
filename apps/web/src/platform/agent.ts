/**
 * The desktop MCP server's seam in the app (P6-08, ADR-0087 §4). Main hosts
 * the server and forwards each tool call here; the app answers it with the
 * tools in `../agent/`. Absent on the web, which has no server.
 */

/** A tool as the server lists it (MCP `tools/list`). */
export interface AgentToolDefinition {
  name: string;
  description: string;
  inputSchema: { type: 'object'; [key: string]: unknown };
}

export type AgentContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: 'image/png' };

/** A tool's answer (MCP `CallToolResult`). */
export interface AgentToolResult {
  content: AgentContent[];
  isError?: boolean;
}

export type AgentExportFormat = 'stl' | '3mf' | 'step';

/** A tool's answer, with the file an `export` made: main writes it and adds the path. */
export interface AgentReply {
  result: AgentToolResult;
  file?: { design: string; format: AgentExportFormat; bytes: Uint8Array };
}

/** The server's state, as main reports it. */
export interface AgentStatus {
  enabled: boolean;
  port: number;
  url: string;
  listening: boolean;
  /** Clients with a stream open or a request in the last 30 s. */
  clients: number;
  /** Why it isn't listening although enabled. */
  error?: string;
}

/** What Settings' Copy client config puts on the clipboard. */
export interface AgentConfig {
  url: string;
  token: string;
}

export interface AgentBridge {
  /** Answers main's tool calls; one handler at a time. Returns the unsubscribe. */
  onRequest(
    handler: (tool: string, args: Record<string, unknown>) => Promise<AgentReply>,
  ): () => void;
  /** The tools main lists to clients. */
  setTools(tools: readonly AgentToolDefinition[]): void;
  /** The latest status, or undefined before main said. */
  status(): AgentStatus | undefined;
  /** Calls back on every status change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  config(): Promise<AgentConfig>;
  regenerateToken(): Promise<AgentConfig>;
}

/** A client config for `mcpServers` (Claude Code, Claude Desktop and others). */
export function clientConfig({ url, token }: AgentConfig): string {
  return JSON.stringify(
    {
      mcpServers: {
        extrudo: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } },
      },
    },
    null,
    2,
  );
}
