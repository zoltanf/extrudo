import { describe, expect, it } from 'vitest';
import { clientConfig } from '../platform';
import { agentStateText, validPort } from './SettingsDialog';

const status = {
  enabled: true,
  port: 7474,
  url: 'http://127.0.0.1:7474/mcp',
  listening: true,
  clients: 0,
};

describe('Settings › Desktop › Agents (ADR-0087 §6)', () => {
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
});
