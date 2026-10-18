import { describe, expect, it } from 'vitest';
import { agentSetups, clientConfig } from '../agent/clientSetup';
import { agentStateText, skillStateText, validPort } from './SettingsDialog';

const status = {
  enabled: true,
  port: 7474,
  url: 'http://127.0.0.1:7474/mcp',
  listening: true,
  clients: 0,
};

describe('Settings › Agents (MCP) (ADR-0087 §6, amendment 2026-10-18)', () => {
  it('says what the server does', () => {
    expect(agentStateText(status, true)).toBe('Listening on http://127.0.0.1:7474/mcp');
    expect(agentStateText(status, false)).toBe('Off.');
    expect(agentStateText(undefined, true)).toBe('Starting…');
    expect(
      agentStateText(
        { ...status, listening: false, error: 'Port 7474 is in use by another program.' },
        true,
      ),
    ).toBe(
      'Port 7474 is in use by another program. If another program answered on this port, regenerate the token.',
    );
    expect(
      agentStateText(
        { ...status, listening: false, error: "Couldn't listen on port 7474: EACCES" },
        true,
      ),
    ).toBe("Couldn't listen on port 7474: EACCES");
  });

  it('takes a port from 1024 to 65535', () => {
    expect(validPort('7474')).toBe(7474);
    expect(validPort(' 8080 ')).toBe(8080);
    expect(validPort('80')).toBeUndefined();
    expect(validPort('70000')).toBeUndefined();
    expect(validPort('74.5')).toBeUndefined();
    expect(validPort('')).toBeUndefined();
  });

  it('copies a ready-to-paste client config with the token', () => {
    expect(JSON.parse(clientConfig({ url: 'http://127.0.0.1:7474/mcp', token: 'abc' }))).toEqual({
      mcpServers: {
        extrudo: {
          type: 'http',
          url: 'http://127.0.0.1:7474/mcp',
          headers: { Authorization: 'Bearer abc' },
        },
      },
    });
  });

  it('writes a setup per agent, each holding the URL and the token', () => {
    const config = { url: 'http://127.0.0.1:7474/mcp', token: 'abc123' };
    const setups = agentSetups(config);
    expect(setups.map((s) => s.id)).toEqual(['claude-code', 'codex', 'opencode', 'json', 'prompt']);
    for (const s of setups) {
      expect(s.text).toContain(config.url);
      expect(s.text).toContain('Bearer abc123');
      expect(s.how.length).toBeGreaterThan(10);
    }
    const byId = Object.fromEntries(setups.map((s) => [s.id, s.text]));
    expect(byId['claude-code']).toBe(
      'claude mcp add --transport http extrudo http://127.0.0.1:7474/mcp --header "Authorization: Bearer abc123"',
    );
    expect(byId.codex).toBe(
      '[mcp_servers.extrudo]\nurl = "http://127.0.0.1:7474/mcp"\nhttp_headers = { "Authorization" = "Bearer abc123" }',
    );
    expect(JSON.parse(byId.opencode as string)).toEqual({
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        extrudo: {
          type: 'remote',
          url: config.url,
          enabled: true,
          headers: { Authorization: 'Bearer abc123' },
        },
      },
    });
    expect(byId.json).toBe(clientConfig(config));
    expect(setups.filter((s) => s.skillTarget).map((s) => s.id)).toEqual([
      'claude-code',
      'codex',
      'opencode',
    ]);
    expect(byId.prompt).toContain('skill://extrudo/SKILL.md');
  });

  it('says where the skill is', () => {
    expect(skillStateText(undefined, false)).toMatch(/save it into the agent's skills folder/);
    expect(skillStateText(undefined, true)).toBe('Looking…');
    expect(skillStateText({ dir: '~/.claude/skills/extrudo', state: 'missing' }, true)).toBe(
      'Not installed. Install skill puts it in ~/.claude/skills/extrudo.',
    );
    expect(skillStateText({ dir: '~/.codex/skills/extrudo', state: 'stale' }, true)).toBe(
      'Installed in ~/.codex/skills/extrudo: an older version. Update skill replaces it.',
    );
    expect(skillStateText({ dir: '~/.codex/skills/extrudo', state: 'current' }, true)).toBe(
      'Installed in ~/.codex/skills/extrudo, up to date.',
    );
  });
});
