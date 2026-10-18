/**
 * How to connect each popular coding agent to the desktop MCP server
 * (ADR-0087 amendment 2026-10-18): the texts Settings › Agents (MCP) shows
 * and copies, each holding the server's URL and the install's token. Pure, so
 * it is unit-tested; the dialog only picks one and copies it.
 */
import type { AgentConfig } from '../platform/agent';

export type AgentSetupId = 'claude-code' | 'codex' | 'opencode' | 'json' | 'prompt';

export interface AgentSetup {
  id: AgentSetupId;
  /** The agent, for the picker. */
  label: string;
  /** What to do with the text, one line. */
  how: string;
  /** The text to copy. */
  text: string;
  /** The agent has a global skills folder main knows: Install skill goes there. */
  skillTarget?: boolean;
  /** What the agent needs before it sees an installed skill. */
  skillNote?: string;
}

const bearer = (token: string) => `Bearer ${token}`;

/** The `mcpServers` entry Claude Code, Claude Desktop, Cursor and others take. */
export function clientConfig({ url, token }: AgentConfig): string {
  return JSON.stringify(
    {
      mcpServers: {
        extrudo: { type: 'http', url, headers: { Authorization: bearer(token) } },
      },
    },
    null,
    2,
  );
}

/** The setups in the order the picker shows them; Claude Code first. */
export function agentSetups(config: AgentConfig): readonly AgentSetup[] {
  const { url, token } = config;
  return [
    {
      id: 'claude-code',
      label: 'Claude Code',
      how: 'Run this in a terminal (add --scope project to share it with a project).',
      text: `claude mcp add --transport http extrudo ${url} --header "Authorization: ${bearer(token)}"`,
      skillTarget: true,
    },
    {
      id: 'codex',
      label: 'Codex CLI',
      how: 'Add this to ~/.codex/config.toml.',
      text: [
        '[mcp_servers.extrudo]',
        `url = ${JSON.stringify(url)}`,
        `http_headers = { "Authorization" = ${JSON.stringify(bearer(token))} }`,
      ].join('\n'),
      skillTarget: true,
      skillNote: 'Codex sees the skill once skills are enabled and it is restarted.',
    },
    {
      id: 'opencode',
      label: 'opencode',
      how: 'Merge this into opencode.json (in the project, or ~/.config/opencode/).',
      text: JSON.stringify(
        {
          $schema: 'https://opencode.ai/config.json',
          mcp: {
            extrudo: {
              type: 'remote',
              url,
              enabled: true,
              headers: { Authorization: bearer(token) },
            },
          },
        },
        null,
        2,
      ),
      skillTarget: true,
    },
    {
      id: 'json',
      label: 'Other (mcpServers JSON)',
      how: "Paste this into the client's MCP settings (Claude Desktop, Cursor and others take this shape).",
      text: clientConfig(config),
    },
    {
      id: 'prompt',
      label: 'Tell the agent',
      how: 'Paste this into the agent: it adds the server itself.',
      text: [
        `Add the MCP server "extrudo" to your configuration: Streamable HTTP at ${url}, sending the header "Authorization: ${bearer(token)}".`,
        'It runs on this computer while Extrudo is open.',
        'Then read skill://extrudo/SKILL.md (or call its get_skill tool) before modelling.',
      ].join(' '),
    },
  ];
}
