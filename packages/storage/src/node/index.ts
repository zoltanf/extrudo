/**
 * The Node-fs `ProjectStore` (P6-01, ADR-0075 §2): the desktop build's
 * storage, over a directory Electron owns (`app.getPath('userData')/projects`).
 * It reuses the one `createProjectStore` with a `ProjectIndex` over
 * `<dir>/index.json` and a `FileStore` over `<dir>/projects/<id>/…`; the lock
 * is a per-process mutex, since one app instance owns the directory
 * (`app.requestSingleInstanceLock()`).
 *
 * This is the `@extrudo/storage/node` entry, kept apart so the browser bundle
 * never pulls in `node:fs`.
 */
import { join } from 'node:path';
import {
  createPluginStore,
  PLUGINS_DIR,
  type PluginStore,
  type PluginStoreOptions,
} from '../plugins';
import { createProjectStore, localLock, type ProjectStoreOptions } from '../project-store';
import type { ProjectStore } from '../types';
import { nodeFiles } from './fs-files';
import { nodeIndex } from './fs-index';
import { nodePluginIndex } from './plugin-index';

export type NodeProjectStoreOptions = Partial<ProjectStoreOptions>;

export function createNodeProjectStore(
  dir: string,
  options: NodeProjectStoreOptions = {},
): ProjectStore {
  return createProjectStore({
    index: options.index ?? nodeIndex(join(dir, 'index.json')),
    files: options.files ?? nodeFiles(dir),
    lock: options.lock ?? localLock(),
    ...(options.appVersion !== undefined && { appVersion: options.appVersion }),
    ...(options.now !== undefined && { now: options.now }),
    ...(options.newId !== undefined && { newId: options.newId }),
  });
}

/**
 * The desktop's installed plugins (P6-03 slice 2): files under
 * `<dir>/plugins/<id>/…` and the index `<dir>/plugins/index.json`, written
 * atomically. `dir` is `userData`, so the plugins sit beside the projects.
 */
export function createNodePluginStore(dir: string, options: PluginStoreOptions = {}): PluginStore {
  return createPluginStore(
    nodeFiles(dir),
    nodePluginIndex(join(dir, PLUGINS_DIR, 'index.json')),
    options,
  );
}

export { nodeFiles } from './fs-files';
export { nodeIndex, writeAtomic } from './fs-index';
export { nodePluginIndex } from './plugin-index';
