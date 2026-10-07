/**
 * The preload (P6-01, ADR-0075 §1): the only place `ipcRenderer` is touched.
 * It publishes the typed bridge from `shared/bridge.ts` on `window.extrudo`
 * through `contextBridge`, so the renderer's `desktopPlatform()` has the API
 * and no direct access to Electron. Bundled as CommonJS (a sandboxed preload
 * cannot be ESM).
 */
import { contextBridge, ipcRenderer } from 'electron';
import { createApi } from '../shared/bridge';

contextBridge.exposeInMainWorld('extrudo', createApi(ipcRenderer));
