/**
 * The MCP bridge on the desktop (P6-08, ADR-0087 §4): `Platform.agent` over the
 * preload's `agent` channels. Main sends each tool call with an id; this
 * answers it with whatever the app's handler returns, so the app's tools never
 * see the ids or the channel. A handler that throws answers as an error, and a
 * call with no handler yet says the app isn't ready.
 */
import type { AgentBridge, AgentStatus } from '@extrudo/web/platform/agent';
import type { ExtrudoApi } from '../shared/ipc';

export function desktopAgent(api: ExtrudoApi): AgentBridge {
  let status: AgentStatus | undefined;
  const listeners = new Set<() => void>();
  const update = (next: AgentStatus) => {
    status = next;
    for (const listener of listeners) listener();
  };
  api.agent.onStatus(update);
  void api.agent.status().then(
    (first) => status ?? update(first),
    () => {},
  );
  return {
    onRequest(handler) {
      api.agent.onRequest(({ id, tool, args }) => {
        handler(tool, args).then(
          (reply) => api.agent.respond({ id, ...reply }),
          (error: unknown) =>
            api.agent.respond({
              id,
              error: error instanceof Error ? error.message : String(error),
            }),
        );
      });
      return () => api.agent.offRequest();
    },
    setTools: (tools) => api.agent.setTools([...tools]),
    status: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    config: () => api.agent.config(),
    regenerateToken: () => api.agent.regenerateToken(),
  };
}
