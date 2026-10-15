import pkg from '../package.json' with { type: 'json' };
import type { BuildInfo } from '../pwa/build-info';

/** The app version, written into saved documents (`meta.appVersion`). */
export const APP_VERSION: string = pkg.version;

declare const __EXTRUDO_BUILD__: BuildInfo | undefined;

/** The build's version, channel and commit (`pwa/build-info.ts`); a `dev` stand-in under Vitest. */
export const BUILD: BuildInfo =
  typeof __EXTRUDO_BUILD__ === 'undefined'
    ? {
        version: APP_VERSION,
        channel: 'dev',
        commit: '',
        dirty: false,
        date: '',
        engines: { occt: '', planegcs: '', openscad: '' },
      }
    : __EXTRUDO_BUILD__;
