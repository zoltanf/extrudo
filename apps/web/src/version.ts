import pkg from '../package.json' with { type: 'json' };

/** The app version, written into saved documents (`meta.appVersion`). */
export const APP_VERSION: string = pkg.version;
