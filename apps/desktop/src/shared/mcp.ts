/**
 * The MCP bridge's payloads (P6-08, ADR-0087 §4), shared by main, the preload
 * and the renderer, with the checks main runs on what the renderer sends: the
 * tool list (`extrudo:mcp:tools`) and each answer (`extrudo:mcp:respond`). A
 * malformed one is dropped with a warning, like a malformed menu model.
 */

/** A tool as the renderer describes it: an MCP `tools/list` entry. */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: { type: 'object'; [key: string]: unknown };
}

export type McpToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

/** A tool's answer: MCP's `CallToolResult`. */
export interface McpToolResult {
  content: McpToolContent[];
  isError?: boolean;
}

/** The formats an agent may export (the `export` tool). */
export const AGENT_EXPORT_FORMATS = ['stl', '3mf', 'step'] as const;
export type AgentExportFormat = (typeof AGENT_EXPORT_FORMATS)[number];

/** An exported file main writes under `userData/agent-exports`; the renderer never names a path. */
export interface McpExportFile {
  /** The design's name, made safe for a file name by main. */
  design: string;
  format: AgentExportFormat;
  bytes: Uint8Array;
}

/** Main → renderer: one tool call. */
export interface McpRequest {
  id: number;
  tool: string;
  args: Record<string, unknown>;
}

/** Renderer → main: the answer to request `id`. */
export type McpResponse =
  | { id: number; result: McpToolResult; file?: McpExportFile }
  | { id: number; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;

export function isToolDefinitionList(value: unknown): value is McpToolDefinition[] {
  return (
    Array.isArray(value) &&
    value.length <= 200 &&
    value.every(
      (tool) =>
        isRecord(tool) &&
        typeof tool.name === 'string' &&
        TOOL_NAME.test(tool.name) &&
        typeof tool.description === 'string' &&
        isRecord(tool.inputSchema) &&
        tool.inputSchema.type === 'object',
    )
  );
}

function isContent(value: unknown): value is McpToolContent {
  if (!isRecord(value)) return false;
  if (value.type === 'text') return typeof value.text === 'string';
  if (value.type === 'image') {
    return typeof value.data === 'string' && value.mimeType === 'image/png';
  }
  return false;
}

export function isToolResult(value: unknown): value is McpToolResult {
  return (
    isRecord(value) &&
    Array.isArray(value.content) &&
    value.content.every(isContent) &&
    (value.isError === undefined || typeof value.isError === 'boolean')
  );
}

function isExportFile(value: unknown): value is McpExportFile {
  return (
    isRecord(value) &&
    typeof value.design === 'string' &&
    (AGENT_EXPORT_FORMATS as readonly unknown[]).includes(value.format) &&
    value.bytes instanceof Uint8Array
  );
}

export function isToolResponse(value: unknown): value is McpResponse {
  if (!isRecord(value) || !Number.isSafeInteger(value.id)) return false;
  if ('error' in value) return typeof value.error === 'string';
  return isToolResult(value.result) && (value.file === undefined || isExportFile(value.file));
}
