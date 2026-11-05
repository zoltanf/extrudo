/**
 * The recent-actions log's boot (ADR-0127), called once by each entry (web and
 * desktop) before the app mounts: an edge or dev build keeps the log in
 * browser storage, the start is logged (a reload shows as a new "App
 * started"), a pending write goes out when the page goes away, and the
 * read-only handle `window.__extrudoRecentActions()` returns the report's
 * lines, for a developer's console or an agent driving the page (no string
 * evaluation: it is a plain function the page sets).
 */
import type { BuildInfo } from '../../pwa/build-info';
import { webActionLogStorage } from '../platform/actionLogStorage';
import { BUILD } from '../version';
import {
  type ActionLog,
  type ActionLogStorage,
  actionLines,
  actionLog,
  persistsActions,
} from './actionLog';

declare global {
  interface Window {
    /** The recent-actions log's lines, oldest first (ADR-0127). Read-only: a copy each call. */
    __extrudoRecentActions?: () => string[];
  }
}

export interface ActionLogBoot {
  log?: ActionLog;
  build?: Pick<BuildInfo, 'channel' | 'version' | 'commit'>;
  /** `window` in the app; a plain object in tests. */
  target?: Pick<Window, 'addEventListener' | '__extrudoRecentActions'>;
  storage?: () => ActionLogStorage;
}

export function startActionLog({
  log = actionLog,
  build = BUILD,
  target = window,
  storage = webActionLogStorage,
}: ActionLogBoot = {}): void {
  if (persistsActions(build.channel)) log.persist(storage());
  log.info(
    'app',
    `App started: ${build.version} (${build.channel}${build.commit ? `, ${build.commit}` : ''})`,
  );
  target.addEventListener('pagehide', () => log.flush());
  target.__extrudoRecentActions = () => actionLines(log.entries());
}
