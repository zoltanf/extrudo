/**
 * What the renderer may ask the session for (ADR-0087 amendment 2026-10-18).
 * Nothing in the app needs a camera, a microphone, a location or a device, so
 * every permission request is denied except writing the clipboard: the Copy
 * buttons (client config, About details, macros, scripts) use
 * `navigator.clipboard.writeText`, which Chromium gates behind
 * `clipboard-sanitized-write`. Reading the clipboard stays denied.
 */
export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write']);

export function allowPermission(permission: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission);
}
