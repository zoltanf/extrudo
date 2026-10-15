import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TooltipProvider } from '../design-system';
import type { AgentBridge, AgentStatus } from '../platform';
import { AgentIndicator, connectedText } from './AgentIndicator';

const bridge = (status: AgentStatus | undefined): AgentBridge => ({
  onRequest: () => () => {},
  setTools: () => {},
  status: () => status,
  subscribe: () => () => {},
  config: async () => ({ url: '', token: '' }),
  regenerateToken: async () => ({ url: '', token: '' }),
});

const base: AgentStatus = {
  enabled: true,
  port: 7474,
  url: 'http://127.0.0.1:7474/mcp',
  listening: true,
  clients: 0,
};
const render = (agent: AgentBridge | undefined) =>
  renderToStaticMarkup(
    <TooltipProvider>
      <AgentIndicator agent={agent} />
    </TooltipProvider>,
  );

describe('AgentIndicator (ADR-0087 §6)', () => {
  it('shows while a client is connected, and not otherwise', () => {
    expect(render(undefined)).toBe('');
    expect(render(bridge(base))).toBe('');
    const html = render(bridge({ ...base, clients: 2 }));
    expect(html).toContain('Agent connected');
    expect(html).toContain('data-agent-clients="2"');
  });

  it('names the count', () => {
    expect(connectedText(1)).toBe('1 agent is connected');
    expect(connectedText(3)).toBe('3 agents are connected');
  });
});
