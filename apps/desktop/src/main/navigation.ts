/**
 * Where the one window may navigate (P6-01's review). The renderer parses
 * untrusted content (a `.scad`, a script, a font), so a compromised renderer
 * must not be able to turn the window into a browser: a top-level navigation
 * to another origin would load the attacker's page with this app's preload
 * attached (the preload publishes the whole privileged bridge in every
 * document). Only `app://` (the packaged renderer) and, in development,
 * `ELECTRON_RENDERER_URL`'s own origin are allowed. Kept free of Electron so
 * the rule is unit-tested without a binary.
 */

/** Whether the window may navigate to `url` (its origin equals the dev server's, or `app://`). */
export function isAllowedNavigation(url: string, devUrl?: string): boolean {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  if (target.protocol === 'app:') return true;
  if (devUrl) {
    try {
      if (new URL(devUrl).origin === target.origin) return true;
    } catch {
      // A malformed dev URL allows nothing extra.
    }
  }
  return false;
}
