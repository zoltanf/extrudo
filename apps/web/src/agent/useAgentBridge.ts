/**
 * Answers the desktop MCP server's tool calls (P6-08, ADR-0087 §4–5): mounted
 * once at the app's root, so `list_designs` and `open_design` work from the
 * home screen too. It sends main the tool list, and runs each call with
 * `runTool` against the open design's host (`agentHosts`). Nothing happens on
 * the web, where the platform has no agent bridge.
 */
import { createDocument } from '@extrudo/core';
import { useEffect, useSyncExternalStore } from 'react';
import type { AgentBridge, AgentStatus, Platform } from '../platform';
import { createProject } from '../project/actions';
import { navigate, projectHref } from '../routes';
import { APP_VERSION } from '../version';
import { agentHosts, waitForHost } from './host';
import { toolDefinitions } from './schemas';
import { type AgentContext, createPacer, runTool } from './tools';

/** Screenshots at most one a second, exports one every 2 s (ADR-0087 §6). */
const SCREENSHOT_MS = 1000;
const EXPORT_MS = 2000;

export function agentContext(platform: Platform): AgentContext {
  return {
    host: () => agentHosts.getState().host,
    designs: () => platform.projects.list(),
    create: (name) =>
      createProject(
        platform,
        createDocument({ appVersion: APP_VERSION, ...(name !== undefined && { name }) }),
      ),
    async open(id) {
      if (agentHosts.getState().host?.designId !== id) navigate(projectHref(id));
      return waitForHost(id);
    },
    screenshotTurn: createPacer(SCREENSHOT_MS),
    exportTurn: createPacer(EXPORT_MS),
  };
}

export function useAgentBridge(platform: Platform): void {
  useEffect(() => {
    const agent = platform.agent;
    if (!agent) return;
    agent.setTools(toolDefinitions());
    const ctx = agentContext(platform);
    return agent.onRequest((tool, args) => runTool(tool, args, ctx));
  }, [platform]);
}

const NO_BRIDGE = () => () => {};

/** The server's status, re-rendering on change; undefined on the web or before main said. */
export function useAgentStatus(agent: AgentBridge | undefined): AgentStatus | undefined {
  const read = () => agent?.status();
  return useSyncExternalStore(agent ? agent.subscribe : NO_BRIDGE, read, read);
}
