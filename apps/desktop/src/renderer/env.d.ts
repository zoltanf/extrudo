import type { ExtrudoApi } from '../shared/ipc';

declare global {
  interface Window {
    readonly extrudo: ExtrudoApi;
  }
}
