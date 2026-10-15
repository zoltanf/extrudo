/**
 * The top bar's "Agent connected" badge (P6-08, ADR-0087 §6): shown while an
 * MCP client is connected to the desktop app (a stream open, or a request in
 * the last 30 s), so a person always knows something else can change the
 * design. The tooltip names the count. Nothing on the web.
 */
import { Bot } from 'lucide-react';
import { Tooltip } from '../design-system';
import type { AgentBridge } from '../platform';
import { useAgentStatus } from './useAgentBridge';

/** "1 agent is connected" / "2 agents are connected" (the tooltip). */
export const connectedText = (clients: number) =>
  clients === 1 ? '1 agent is connected' : `${clients} agents are connected`;

export function AgentIndicator({ agent }: { agent: AgentBridge | undefined }) {
  const status = useAgentStatus(agent);
  if (!status || status.clients === 0) return null;
  return (
    <Tooltip
      label="Agent connected"
      hint={`${connectedText(status.clients)} through the MCP server, and can read and change this design. Every change it makes is one undo step.`}
    >
      <span
        role="status"
        data-agent-clients={status.clients}
        className="inline-flex items-center gap-1.5 rounded-input px-1.5 py-0.5 text-sm text-accent"
      >
        <Bot size={16} strokeWidth={1.75} aria-hidden="true" />
        Agent connected
      </span>
    </Tooltip>
  );
}
