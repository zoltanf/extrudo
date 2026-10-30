/**
 * What the renderer may ask the session for (ADR-0087 amendment 2026-10-18).
 * Nothing in the app needs a camera, a microphone or a location, so every
 * permission request is denied except writing the clipboard (devices are
 * separate: only a 3D mouse, `isSpaceMouse`): the Copy
 * buttons (client config, About details, macros, scripts) use
 * `navigator.clipboard.writeText`, which Chromium gates behind
 * `clipboard-sanitized-write`. Reading the clipboard stays denied.
 */
export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write']);

export function allowPermission(permission: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission);
}

/**
 * HID devices the renderer may open (ADR-0114): 3D mice only. 3Dconnexion's own vendor ID,
 * and the older devices made under Logitech's, whose product IDs 3Dconnexion was given in the
 * 0xc6xx block. The web app asks for the same devices (`viewport/spaceMouse.ts`).
 */
export function isSpaceMouse(device: { vendorId: number; productId: number }): boolean {
  if (device.vendorId === 0x256f) return true;
  return device.vendorId === 0x046d && device.productId >> 8 === 0xc6;
}
